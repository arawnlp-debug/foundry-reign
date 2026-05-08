// scripts/combat/company-damage.js

/**
 * Applies damage to a specific Quality of all targeted Company actors.
 *
 * BATCH G / ITEM-16 changes:
 *   - Returns a structured result array instead of posting steal messages
 *     inline; the caller (company-roller.js) folds these into the unified
 *     action resolution card.
 *   - Separates two distinct RAW collapse conditions into discrete ceremonies:
 *       (a) Sovereignty Dissolution — Sovereignty alone reaches zero.
 *       (b) Total Conquest candidate — two or more Qualities at zero, including
 *           Sovereignty or Territory. Requires GM adjudication because RAW
 *           mandates the same-month timing requirement (Rules Ch5), which
 *           cannot be tracked automatically without data-model changes.
 *
 * RAW invariants preserved:
 *   - Width does not determine damage amount; each successful attack deals
 *     exactly 1 point of damage.
 *   - Steal mechanics (Raiding / Annexation) only trigger on overflow — when
 *     temporary damage breaks the Quality's permanent ceiling.
 *
 * @param {number}     width         Width of the winning set (currently unused
 *                                   in damage calculation — kept for signature
 *                                   stability and future extensibility).
 * @param {string}     qualityKeyRaw Key of the targeted Quality (e.g. "might").
 * @param {Actor|null} attackerActor The attacking Company actor, or null.
 * @returns {Array<CompanyDamageResult>} One entry per targeted token.
 *
 * @typedef  {Object}  CompanyDamageResult
 * @property {string}  targetName     Escaped name of the target company.
 * @property {string}  qualityKey     Normalised key (lowercase).
 * @property {string}  qualityLabel   Title-cased label for display.
 * @property {boolean} isOverflow     True when permanent damage was dealt.
 * @property {number}  newValue       New permanent Quality value after overflow.
 * @property {boolean} stealTriggered True when the Steal mechanic activated.
 * @property {boolean} stealIsTrivial True when steal triggered but the attacker
 *                                    was already >= the target (no gain).
 */
export async function applyCompanyDamageToTarget(width, qualityKeyRaw, attackerActor = null) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) {
    ui.notifications.warn("Please target a Company token first!");
    return [];
  }

  const qualityKey   = String(qualityKeyRaw || "").toLowerCase();
  const qualityLabel = qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1);
  const results      = [];

  for (const target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "company") continue;

    if (!qualityKey || !targetActor.system?.qualities?.[qualityKey]) {
      ui.notifications.warn(`Invalid company quality: ${qualityKeyRaw}`);
      continue;
    }

    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
    const qualityData    = targetActor.system.qualities[qualityKey];

    const currentValue = qualityData.value  || 0;
    const currentDmg   = qualityData.damage || 0;

    const updates = {};
    let stealTriggered = false;
    let stealIsTrivial = false;

    // ── RAW: each successful attack deals exactly 1 point of damage ──────
    let newDmg    = currentDmg + 1;
    let newValue  = currentValue;
    let overflow  = 0;

    // RAW: "These losses are temporary until the Quality hits zero.
    //       The attack that knocks it to zero makes the loss permanent."
    if (newDmg > currentValue) {
      overflow  = newDmg - currentValue;
      newValue  = Math.max(0, currentValue - overflow);
      newDmg    = newValue; // Cap temp damage to the newly reduced permanent ceiling.

      // ── RAW: Steal mechanic (Raiding & Annexation) ────────────────────
      // Activates only on overflow (permanent loss) and only for
      // Treasure and Territory (the two "Stealable" qualities).
      if (
        attackerActor &&
        attackerActor.type === "company" &&
        (qualityKey === "treasure" || qualityKey === "territory")
      ) {
        const attackerVal = attackerActor.system.qualities[qualityKey].value;

        if (attackerVal < currentValue) {
          // Attacker gains +1 permanently (target was strictly larger before hit).
          await attackerActor.update({ [`system.qualities.${qualityKey}.value`]: attackerVal + 1 });
          stealTriggered = true;
          stealIsTrivial = false;
        } else {
          // Overflow still occurred but attacker cannot assimilate the spoils.
          stealTriggered = true;
          stealIsTrivial = true;
        }
      }
    }

    updates[`system.qualities.${qualityKey}.damage`] = newDmg;
    if (overflow > 0) {
      updates[`system.qualities.${qualityKey}.value`] = newValue;
    }

    // ── Snapshot quality state BEFORE the update ─────────────────────────
    // Conquest-reward tiers compare against pre-damage permanent totals.
    let zeroCount   = 0;
    let criticalZero = false;
    let targetSize  = 0;

    for (const [k, q] of Object.entries(targetActor.system.qualities)) {
      targetSize += q.value;
      const valToCheck = (k === qualityKey) ? newValue : q.value;
      if (valToCheck === 0) {
        zeroCount++;
        if (k === "territory" || k === "sovereignty") criticalZero = true;
      }
    }

    await targetActor.update(updates);

    // Notifications (fallback for contexts without the resolution card).
    if (overflow > 0) {
      ui.notifications.warn(
        `Dealt 1 damage to ${safeTargetName}. Defenses broke! Permanent ${qualityLabel} reduced to ${newValue}!`
      );
    } else {
      ui.notifications.info(
        `Dealt 1 temporary damage to ${safeTargetName}'s ${qualityLabel}.`
      );
    }

    results.push({ targetName: safeTargetName, qualityKey, qualityLabel, isOverflow: overflow > 0, newValue, stealTriggered, stealIsTrivial });

    // ── COLLAPSE CEREMONIES ───────────────────────────────────────────────
    //
    // Two distinct RAW collapse conditions (Rules Ch5):
    //
    // (a) TOTAL CONQUEST CANDIDATE
    //     Two or more Qualities have reached zero, including Sovereignty or
    //     Territory. RAW requires both to fall in the same calendar month —
    //     a per-month timing requirement the system cannot verify
    //     automatically (doing so would require data-model changes deferred
    //     to a later batch). A GM adjudication card is posted instead of
    //     auto-declaring conquest or awarding rewards.
    //
    // (b) SOVEREIGNTY DISSOLUTION
    //     Sovereignty alone reaches zero. The Company collapses from within.
    //     This is dissolution, not conquest — no Quality rewards apply.
    //
    // Total Conquest is evaluated first because it subsumes the Sovereignty
    // condition when both are satisfied simultaneously.

    const isTotalConquestCandidate = zeroCount >= 2 && criticalZero;
    const isSovereigntyDissolution = !isTotalConquestCandidate && qualityKey === "sovereignty" && newValue === 0;

    if (isTotalConquestCandidate) {
      await _postTotalConquestCard(safeTargetName, targetSize, attackerActor);
    } else if (isSovereigntyDissolution) {
      await _postDissolutionCard(safeTargetName, targetSize, attackerActor);
    }
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
//  COLLAPSE CEREMONY HELPERS (module-private)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Posts the Total Conquest GM adjudication card.
 *
 * RAW: "If you reduce two of a Company's Qualities to zero in one month,
 * including either Sovereignty or Territory, you have completely overwhelmed
 * and subsumed that entire Company." (Rules Ch5)
 *
 * Because the system does not track when within a month each Quality reached
 * zero, the GM must confirm whether the same-month timing requirement is met
 * before applying conquest rewards.
 *
 * @param {string}     safeTargetName  Escaped target company name.
 * @param {number}     targetSize      Sum of the target's permanent Quality values (pre-damage snapshot).
 * @param {Actor|null} attackerActor   Attacking Company actor, or null.
 */
async function _postTotalConquestCard(safeTargetName, targetSize, attackerActor) {
  let sizeHtml = "";

  if (attackerActor && attackerActor.type === "company") {
    let attackerSize = 0;
    for (const q of Object.values(attackerActor.system.qualities)) {
      attackerSize += q.value;
    }
    const safeAttackerName = foundry.utils.escapeHTML(attackerActor.name);

    let tierHtml;
    if (targetSize <= attackerSize / 2) {
      tierHtml = `<p class="reign-text-muted reign-text-sm reign-mb-0">
                    <strong>Tier:</strong> Half or less of conqueror's size →
                    <em>No permanent Quality increase.</em>
                  </p>`;
    } else if (targetSize < attackerSize) {
      tierHtml = `<p class="reign-text-success reign-text-sm reign-mb-0">
                    <strong>Tier:</strong> More than half but smaller →
                    <em>Raise any <strong>one</strong> Quality by 1 permanently.</em>
                  </p>`;
    } else {
      tierHtml = `<p class="reign-text-info reign-text-sm reign-mb-0">
                    <strong>Tier:</strong> Equal to or larger →
                    <em>Raise any <strong>two</strong> Qualities by 1 each permanently.</em>
                  </p>`;
    }

    sizeHtml = `
      <div class="reign-callout reign-mb-small">
        <p class="reign-text-sm reign-mb-0">
          <strong>${safeTargetName}:</strong> ${targetSize} total Qualities
        </p>
        <p class="reign-text-sm reign-mb-0">
          <strong>${safeAttackerName}:</strong> ${attackerSize} total Qualities
        </p>
        ${tierHtml}
      </div>`;
  } else {
    sizeHtml = `
      <div class="reign-callout reign-mb-small">
        <p class="reign-text-sm reign-mb-0">
          <strong>${safeTargetName} total Qualities:</strong> ${targetSize}
        </p>
        <p class="reign-text-muted reign-text-sm reign-mb-0">
          Compare to the conqueror's total to determine the reward tier (Rules Ch5).
        </p>
      </div>`;
  }

  const content = `
    <div class="reign-chat-card reign-card-critical">
      <h3 class="reign-text-warning reign-header-fancy">
        <i class="fas fa-balance-scale"></i> Total Conquest? — GM Adjudication
      </h3>
      <p>
        <strong>${safeTargetName}</strong> has two or more Qualities at zero,
        including Sovereignty or Territory.
      </p>
      <p class="reign-text-sm reign-text-muted reign-mb-small">
        RAW requires both Qualities to have reached zero <em>in the same month</em>
        (Rules Ch5). If that timing is confirmed, this is Total Conquest and the
        losing Company is subsumed.
      </p>
      ${sizeHtml}
      <div class="reign-callout reign-callout-info">
        <p class="reign-text-sm reign-mb-0">
          <strong>On confirmation:</strong> apply the reward tier above to the
          conqueror's permanent Qualities. The conquered Company is dissolved.
        </p>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: attackerActor ? ChatMessage.getSpeaker({ actor: attackerActor }) : null,
    content,
  });
}

/**
 * Posts the Sovereignty Dissolution ceremony card.
 *
 * RAW: "If you can reduce Sovereignty to zero, the Company collapses."
 * (Rules Ch5). This condition is distinct from Total Conquest — the Company
 * dissolves from within rather than being subsumed. No Quality rewards apply
 * to an attacker unless a separate Total Conquest condition is also met.
 *
 * @param {string}     safeTargetName  Escaped target company name.
 * @param {number}     targetSize      Sum of the target's permanent Quality values.
 * @param {Actor|null} attackerActor   Attacking Company actor, or null.
 */
async function _postDissolutionCard(safeTargetName, targetSize, attackerActor) {
  const content = `
    <div class="reign-chat-card reign-card-danger">
      <h3 class="reign-text-danger reign-header-fancy">
        <i class="fas fa-crown"></i> The Company Falls
      </h3>
      <p>
        <strong>${safeTargetName}</strong> has lost all Sovereignty.
      </p>
      <p class="reign-text-sm reign-mb-small">
        Without an identity to hold them together, the people scatter.
        The Company is dissolved (Rules Ch5).
      </p>
      <div class="reign-callout reign-callout-danger">
        <p class="reign-text-sm reign-text-muted reign-mb-0">
          <em>This is dissolution, not conquest. No permanent Quality rewards
          apply unless a separate Total Conquest condition is also confirmed
          by the GM.</em>
        </p>
      </div>
    </div>`;

  await ChatMessage.create({
    speaker: attackerActor ? ChatMessage.getSpeaker({ actor: attackerActor }) : null,
    content,
  });
}
