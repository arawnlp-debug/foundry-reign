// scripts/helpers/base-roller.js
//
// ITEM-19: Shared roller lifecycle utilities.
//
// Extracts three genuinely duplicated patterns from the four roller classes:
//   1. Dice rolling (Roll Nd10 → evaluate → extract results)
//   2. Master Die assignment dialog (show results, prompt face values)
//   3. Roll-then-optionally-prompt-MD-then-finalize orchestration
//
// Each roller extends this class and inherits the static helpers via JS class
// inheritance. Rollers continue to own their own pre-roll preparation, dialog
// content, pool calculation, and post-roll processing — none of which is
// forced into a shared template.

import { reignDialog } from "./dialog-util.js";

export class BaseORERoller {

  /* ───────────────────────────────────────────────────────────────────────
   * rollDice(count)
   *
   * Rolls `count` d10s via Foundry's Roll API and returns both the Roll
   * instance (for Dice So Nice / audit trail) and the flat results array.
   *
   * Returns { roll: null, results: [] } when count < 1 so callers never
   * need to guard against that edge case.
   * ─────────────────────────────────────────────────────────────────────── */
  static async rollDice(count) {
    if (count < 1) return { roll: null, results: [] };
    const roll = new Roll(`${count}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];
    return { roll, results };
  }

  /* ───────────────────────────────────────────────────────────────────────
   * promptMasterDice(existingResults, mdCount, title?)
   *
   * Opens a dialog showing the dice rolled so far and prompts the player
   * to assign face values (1-10) for each Master Die.
   *
   * Returns an array of chosen face values, or null if the player cancels.
   *
   * The dialog is intentionally minimal — it does not modify the results
   * array; the caller is responsible for pushing the returned faces.
   * ─────────────────────────────────────────────────────────────────────── */
  static async promptMasterDice(existingResults, mdCount, title = "Assign Master Dice") {
    const sorted = [...existingResults].sort((a, b) => b - a);
    let mdHtml = `<form class="reign-dialog-form">
      <p class="reign-text-large reign-mb-small reign-mt-0"><strong>Your Roll so far:</strong> ${sorted.length > 0 ? sorted.join(", ") : "None"}</p>
      <p class="reign-text-small reign-text-muted reign-mb-medium">Assign a face value to your Master Dic${mdCount > 1 ? "e" : ""}.</p>
      <div class="dialog-grid dialog-grid-2">`;
    for (let i = 0; i < mdCount; i++) {
      mdHtml += `<div class="form-group"><label>MD ${i + 1} Face:</label><input type="number" id="mdFace${i}" value="10" min="1" max="10"/></div>`;
    }
    mdHtml += `</div></form>`;

    return reignDialog(
      title,
      mdHtml,
      (e, b, d) => {
        const faces = [];
        for (let i = 0; i < mdCount; i++) {
          faces.push(parseInt(d.element.querySelector(`#mdFace${i}`)?.value) || 10);
        }
        return faces;
      },
      { defaultLabel: "Finalize Sets" }
    );
  }

  /* ───────────────────────────────────────────────────────────────────────
   * finalizeWithMasterDice(poolMath, finalizer, mdTitle?)
   *
   * Orchestrates the complete post-dialog roll sequence:
   *   1. Roll normalDiceCount d10s
   *   2. Append Expert Die / Called Shot results
   *   3. If Master Dice are present, prompt for face assignment
   *   4. Call the finalizer callback with the complete results
   *
   * The finalizer signature matches the existing pattern across all rollers:
   *   async (results, mdCount, edCount, edFace, rollInstance) => void
   *
   * If the player cancels the MD dialog, the finalizer is never called
   * and the method returns silently (existing behaviour).
   *
   * @param {object} poolMath - Output of calculateOREPool (or compatible shape).
   *   Required fields: normalDiceCount, actualEd, finalEdFace, actualCs,
   *   finalCalledShot, actualMd.
   * @param {Function} finalizer - Async callback invoked with final results.
   * @param {string} [mdTitle="Assign Master Dice"] - Dialog title for MD prompt.
   * ─────────────────────────────────────────────────────────────────────── */
  static async finalizeWithMasterDice(poolMath, finalizer, mdTitle = "Assign Master Dice") {
    const { roll, results } = await this.rollDice(poolMath.normalDiceCount);

    if (poolMath.actualEd > 0) results.push(poolMath.finalEdFace);
    if (poolMath.actualCs > 0) results.push(poolMath.finalCalledShot);

    if (poolMath.actualMd > 0) {
      const mdFaces = await this.promptMasterDice(results, poolMath.actualMd, mdTitle);
      if (!mdFaces) return; // Player cancelled — do not finalize
      results.push(...mdFaces);
      await finalizer(results, poolMath.actualMd, poolMath.actualEd, poolMath.finalEdFace, roll);
    } else {
      await finalizer(results, 0, poolMath.actualEd, poolMath.finalEdFace, roll);
    }
  }
}
