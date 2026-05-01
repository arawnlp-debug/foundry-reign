// scripts/sheets/threat-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { ThreatRoller } from "../helpers/threat-roller.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";
import { reignDialog } from "../helpers/dialog-util.js";
import { HIT_LOCATIONS_SET } from "../helpers/config.js";
import { postOREChat } from "../helpers/chat.js";
import { parseORE } from "../helpers/ore-engine.js";
// Static imports — no dynamic imports needed
import { applyCreatureVenom, applyOffensiveMoraleAttack, applyScatteredDamageToTarget } from "../combat/damage.js";

// Creature pool cap (RAW: creatures not subject to PC 10d cap; use mob cap of 15)
const CREATURE_POOL_CAP = 15;

// Skills that pair with Sense (not Body or Coordination)
const SENSE_SKILLS = new Set(["hearing","sight","scrutinize","stealth","smell"]);
// Skills that pair with Coordination
const COORD_SKILLS = new Set(["dodge","climb","swim","coordination","acrobatics"]);

/**
 * Normalise a creature skill value to structured format.
 * Handles both the legacy flat format (number, "ED", "MD") and the new
 * structured format { value, expert, master } so code works before and
 * after migration.
 */
function normalizeCreatureSkill(val) {
  if (val && typeof val === "object" && !Array.isArray(val)) return val;
  if (val === "ED") return { value: 0, expert: true, master: false };
  if (val === "MD") return { value: 0, expert: false, master: true };
  return { value: typeof val === "number" ? val : (parseInt(val) || 0), expert: false, master: false };
}

export class ReignThreatSheet extends ScrollPreserveMixin(HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["reign", "sheet", "actor", "threat"],
    position: { width: 540, height: "auto" },
    window: { resizable: true, minimizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      // Mob
      rollThreat:             this.prototype._onRollThreat,
      rollMorale:             this.prototype._onRollMorale,
      receiveMoraleAttack:    this.prototype._onReceiveMoraleAttack,
      eliminateMinions:       this.prototype._onEliminateMinions,
      // Creature mode toggle
      toggleCreatureMode:     this.prototype._onToggleCreatureMode,
      // Locations
      addCreatureLocation:    this.prototype._onAddCreatureLocation,
      removeCreatureLocation: this.prototype._onRemoveCreatureLocation,
      // Attacks
      addCreatureAttack:      this.prototype._onAddCreatureAttack,
      removeCreatureAttack:   this.prototype._onRemoveCreatureAttack,
      // Skills
      addCreatureSkill:       this.prototype._onAddCreatureSkill,
      removeCreatureSkill:    this.prototype._onRemoveCreatureSkill,
      editCreatureSkill:      this.prototype._onEditCreatureSkill,
      // Creature rolling
      rollCreatureSkill:      this.prototype._onRollCreatureSkill,
      rollCreatureAttack:     this.prototype._onRollCreatureAttack,
      // G4.2 Elephant
      elephantTrumpet:        this.prototype._onElephantTrumpet,
      elephantTrunkGrab:      this.prototype._onElephantTrunkGrab,
      // G4.3 Boa
      boaDropAndGrab:         this.prototype._onBoaDropAndGrab,
      boaConstrict:           this.prototype._onBoaConstrict,
      boaReleaseTarget:       this.prototype._onBoaReleaseTarget,
      // G4.4 Rhino
      rhinoBuildCharge:       this.prototype._onRhinoBuildCharge,
      rhinoGoreCharge:        this.prototype._onRhinoGoreCharge,
      // G4.5 Venom
      rollVenom:              this.prototype._onRollVenom,
      // Portrait
      editImage:              this.prototype._onEditImage
    }
  };

  static PARTS = {
    sheet: { template: "systems/reign/templates/actor/threat-sheet.hbs" }
  };

  // =====================================================
  // PORTRAIT
  // =====================================================

  async _onEditImage(event, target) {
    event.preventDefault();
    try {
      const fp = new foundry.applications.apps.FilePicker.implementation({
        type: "image",
        current: this.document.img,
        callback: path => this.document.update({ img: path })
      });
      return fp.browse();
    } catch(err) {
      ui.notifications.error(`Action failed: ${err.message}`);
      console.error(err);
    }
  }

  // =====================================================
  // LIFECYCLE
  // =====================================================

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const html = this.element;

    // ── Wound boxes: event delegation from the root element. The root persists across
    // re-renders, so this binds once and survives. Same pattern as character sheet.
    html.addEventListener("contextmenu", ev => {
      if (ev.target.closest(".cs-wound-box")) ev.preventDefault();
    });
    html.addEventListener("mousedown", ev => {
      const box = ev.target.closest(".cs-wound-box");
      if (!box) return;
      ev.preventDefault();
      this._handleCreatureHealthClick(ev, box);
    });

    // ── Edit-row toggle (config cog button) — Hit Locations
    html.addEventListener("click", ev => {
      const btn = ev.target.closest("[data-action-local='toggleEdit']");
      if (!btn) return;
      const idx = btn.dataset.index;
      const row = html.querySelector(`[data-edit-index="${idx}"]`);
      if (!row) return;
      const open = !row.hidden;
      row.hidden = open;
      btn.querySelector("i").className = open ? "fas fa-cog" : "fas fa-times";
      btn.title = open ? "Configure location" : "Close";
    });

    // ── Edit-row toggle (config cog button) — Attacks
    html.addEventListener("click", ev => {
      const btn = ev.target.closest("[data-action-local='toggleAttackEdit']");
      if (!btn) return;
      const idx = btn.dataset.attackIndex;
      const row = html.querySelector(`[data-attack-edit-index="${idx}"]`);
      if (!row) return;
      const open = !row.hidden;
      row.hidden = open;
      btn.querySelector("i").className = open ? "fas fa-cog" : "fas fa-times";
      btn.title = open ? "Configure attack" : "Close";
    });

    // ── Heights input: parse comma string to number array on change/blur
    html.addEventListener("change", ev => {
      const input = ev.target.closest(".cs-heights-input");
      if (!input) return;
      const idx = parseInt(input.dataset.heightsIndex);
      if (isNaN(idx)) return;
      const locs = foundry.utils.deepClone(this.document.system.customLocations || []);
      if (idx >= locs.length) return;
      const raw = input.value;
      locs[idx].rollHeights = raw === "redirect only" || raw.trim() === ""
        ? []
        : raw.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 10);
      this.document.update({ "system.customLocations": locs });
    });
  }

  // FIX: ArrayField form submissions lose fields that aren't named form inputs.
  // When submitOnChange fires, form data contains only the named inputs for each
  // array element (e.g. name, woundBoxes, ar for locations). Fields like rollHeights,
  // shock, killing have no form inputs and would be replaced with schema defaults.
  // Fix: merge form data on top of the current document data for each array element.
  _prepareSubmitData(event, form, formData) {
    const data = super._prepareSubmitData(event, form, formData);

    // ── Merge customLocations: preserve rollHeights, shock, killing ──
    this._mergeArrayFormData(data, "system.customLocations",
      this.document.system.customLocations || []);

    // ── Merge creatureAttacks: preserve fields not in config panel ──
    this._mergeArrayFormData(data, "system.creatureAttacks",
      this.document.system.creatureAttacks || []);

    // ── Parse rollHeights comma-string to number array ──
    const locs = this.document.system.customLocations || [];
    locs.forEach((loc, i) => {
      const key = `system.customLocations.${i}.rollHeights`;
      if (key in data) {
        const raw = String(data[key]);
        data[key] = raw === "redirect only" || raw.trim() === ""
          ? []
          : raw.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 10);
      }
    });

    return data;
  }

  /**
   * For an ArrayField at `prefix`, find all dotted keys in `data` that modify
   * individual elements (e.g. prefix.0.name, prefix.1.ar) and fill in any
   * missing sub-fields from `currentArray` so the update doesn't wipe them.
   */
  _mergeArrayFormData(data, prefix, currentArray) {
    // Collect which array indices appear in the form data
    const touchedIndices = new Set();
    const indexPattern = new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.(\\d+)\\.`);
    for (const key of Object.keys(data)) {
      const m = key.match(indexPattern);
      if (m) touchedIndices.add(parseInt(m[1]));
    }
    if (touchedIndices.size === 0) return;

    // For each touched index, ensure every field from the current doc data
    // is present in the form data (form values win, doc values fill gaps)
    for (const idx of touchedIndices) {
      const current = currentArray[idx];
      if (!current) continue;
      const src = current.toObject ? current.toObject() : foundry.utils.deepClone(current);
      for (const [field, val] of Object.entries(src)) {
        const dotKey = `${prefix}.${idx}.${field}`;
        if (!(dotKey in data)) data[dotKey] = val;
      }
    }
  }

  // =====================================================
  // WOUND BOX CLICK
  // =====================================================

  async _handleCreatureHealthClick(event, box) {
    // FIX: read data-loc-index directly from the box element (no closest() ambiguity)
    const idx    = parseInt(box.dataset.locIndex);
    const boxIdx = parseInt(box.dataset.boxIndex);
    if (isNaN(idx) || isNaN(boxIdx)) return;

    const locs = foundry.utils.deepClone(this.document.system.customLocations || []);
    if (idx >= locs.length) return;
    const loc = locs[idx];

    const max     = loc.woundBoxes || 5;
    let shock     = loc.shock   || 0;
    let killing   = loc.killing || 0;

    if (event.shiftKey) {
      // Triage: remove damage right-to-left (killing first, then shock)
      if (killing > 0) killing--;
      else if (shock > 0) shock--;
    } else if (event.button === 2) {
      // Right-click: add Killing directly
      if (killing < max) {
        if (shock + killing >= max && shock > 0) shock--;
        killing++;
      }
    } else {
      // Left-click: add Shock; if full, convert oldest Shock to Killing
      if (shock + killing < max) {
        shock++;
      } else if (shock > 0 && killing < max) {
        shock--;
        killing++;
      }
    }

    loc.shock   = shock;
    loc.killing = killing;
    await this.document.update({ "system.customLocations": locs });
  }

  // =====================================================
  // MOB ACTION HANDLERS (existing — unchanged)
  // =====================================================

  async _onRollThreat(event, target) {
    event.preventDefault();
    try { await ThreatRoller.rollThreat(this.document, target.dataset); }
    catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onRollMorale(event, target) {
    event.preventDefault();
    try { await ThreatRoller.rollMorale(this.document); }
    catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onReceiveMoraleAttack(event, target) {
    event.preventDefault();
    try {
      const content = `<form class="reign-dialog-form">
        <div class="form-group">
          <label>Morale Attack Value:</label>
          <input type="number" name="maValue" value="3" min="1" max="10" />
        </div>
        <div class="form-group">
          <label>Source:</label>
          <input type="text" name="maSource" value="Morale Attack" />
        </div>
      </form>`;
      const result = await reignDialog("Receive Morale Attack", content,
        (e, b, d) => {
          const f = d.element.querySelector("form") || d.element;
          return { maValue: parseInt(f.querySelector('[name="maValue"]')?.value) || 0,
                   maSource: f.querySelector('[name="maSource"]')?.value || "Morale Attack" };
        }, { defaultLabel: "Apply" });
      if (!result || result.maValue < 1) return;
      await ThreatRoller.receiveMoraleAttack(this.document, result.maValue, result.maSource);
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onEliminateMinions(event, target) {
    event.preventDefault();
    try {
      const actor = this.document;
      const currentGroup = actor.system.magnitude?.value || 0;
      if (currentGroup <= 0) return ui.notifications.warn(`${actor.name} has no active fighters remaining.`);
      const content = `<form class="reign-dialog-form">
        <p>Currently <strong>${currentGroup}</strong> / ${actor.system.magnitude?.max || currentGroup} active.</p>
        <div class="form-group">
          <label>Fighters to Remove:</label>
          <input type="number" name="removeCount" value="1" min="1" max="${currentGroup}" />
        </div>
        <div class="form-group">
          <label>Reason:</label>
          <input type="text" name="reason" value="Manual Removal" />
        </div>
      </form>`;
      const result = await reignDialog("Eliminate Fighters", content,
        (e, b, d) => {
          const f = d.element.querySelector("form") || d.element;
          return { count: parseInt(f.querySelector('[name="removeCount"]')?.value) || 0,
                   reason: f.querySelector('[name="reason"]')?.value || "Manual Removal" };
        }, { defaultLabel: "Remove" });
      if (!result || result.count < 1) return;
      await ThreatRoller.eliminateMinions(actor, result.count, result.reason);
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  // =====================================================
  // CREATURE MODE TOGGLE
  // =====================================================

  async _onToggleCreatureMode(event, target) {
    event.preventDefault();
    const newMode = !this.document.system.creatureMode;
    await this.document.update({ "system.creatureMode": newMode });
  }

  // =====================================================
  // LOCATION MANAGEMENT
  // =====================================================

  async _onAddCreatureLocation(event, target) {
    event.preventDefault();
    const locs = foundry.utils.deepClone(this.document.system.customLocations || []);
    locs.push({ key: `loc${locs.length}`, name: "New Location", rollHeights: [], woundBoxes: 5, ar: 0, shock: 0, killing: 0 });
    await this.document.update({ "system.customLocations": locs });
  }

  async _onRemoveCreatureLocation(event, target) {
    event.preventDefault();
    const idx = parseInt(target.dataset.index);
    const locs = foundry.utils.deepClone(this.document.system.customLocations || []);
    if (isNaN(idx) || idx < 0 || idx >= locs.length) return;
    locs.splice(idx, 1);
    await this.document.update({ "system.customLocations": locs });
  }

  // =====================================================
  // ATTACK MANAGEMENT
  // =====================================================

  async _onAddCreatureAttack(event, target) {
    event.preventDefault();
    const attacks = foundry.utils.deepClone(this.document.system.creatureAttacks || []);
    attacks.push({ name: "New Attack", attribute: "body", skill: "", damage: "Width Shock", notes: "", isSlow: 0 });
    await this.document.update({ "system.creatureAttacks": attacks });
  }

  async _onRemoveCreatureAttack(event, target) {
    event.preventDefault();
    const idx = parseInt(target.dataset.attackIndex);
    const attacks = foundry.utils.deepClone(this.document.system.creatureAttacks || []);
    if (isNaN(idx) || idx < 0 || idx >= attacks.length) return;
    attacks.splice(idx, 1);
    await this.document.update({ "system.creatureAttacks": attacks });
  }

  // =====================================================
  // SKILL MANAGEMENT
  // =====================================================

  async _onAddCreatureSkill(event, target) {
    event.preventDefault();
    const existingSkills = this.document.system.creatureSkills || {};

    // Build option lists excluding already-added skills
    const COMBAT_SKILLS = ["fight","bite","claw","kick","ram","constrict","trample","grapple","dodge","parry","athletics","climb","swim","run","stealth"];
    const PERCEPTION_SKILLS = ["hearing","sight","scrutinize","smell"];
    const allPredefined = [...COMBAT_SKILLS, ...PERCEPTION_SKILLS];
    const available = allPredefined.filter(k => !(k in existingSkills));

    const optionsHtml = available.map(k => {
      const label = k.charAt(0).toUpperCase() + k.slice(1);
      return `<option value="${k}">${label}</option>`;
    }).join("");

    const content = `
      <form class="reign-dialog-form">
        <div class="form-group">
          <label>Skill</label>
          <select name="skillKey" id="cs-add-skill-select">
            ${optionsHtml}
            <option value="__custom__">— Custom —</option>
          </select>
        </div>
        <div class="form-group" id="cs-custom-skill-group" style="display:none;">
          <label>Custom Skill Name</label>
          <input type="text" name="customKey" placeholder="e.g. tailSwipe"/>
        </div>
        <div class="form-group">
          <label>Dice</label>
          <input type="number" name="skillValue" value="2" min="0" max="10" style="width:60px;"/>
        </div>
        <div class="reign-grid-2col reign-gap-small">
          <div class="form-group">
            <label><input type="checkbox" name="hasEd"/> Expert Die (ED)</label>
          </div>
          <div class="form-group">
            <label><input type="checkbox" name="hasMd"/> Master Die (MD)</label>
          </div>
        </div>
        <p class="reign-text-small reign-text-muted">RAW: You cannot have both ED and MD in the same pool. If both are checked, only MD applies.</p>
      </form>`;

    const result = await reignDialog("Add Creature Skill", content,
      (e, b, d) => {
        const f = d.element.querySelector("form");
        let key = f.querySelector('[name="skillKey"]')?.value;
        if (key === "__custom__") key = f.querySelector('[name="customKey"]')?.value?.trim().replace(/\s+/g, "");
        const numVal = parseInt(f.querySelector('[name="skillValue"]')?.value) || 0;
        const hasEd = f.querySelector('[name="hasEd"]')?.checked || false;
        const hasMd = f.querySelector('[name="hasMd"]')?.checked || false;
        return {
          key,
          value: { value: numVal, expert: hasMd ? false : hasEd, master: hasMd }
        };
      },
      {
        defaultLabel: "Add Skill",
        render: (context, el) => {
          const select = el.querySelector("#cs-add-skill-select");
          const customGroup = el.querySelector("#cs-custom-skill-group");
          select?.addEventListener("change", () => {
            customGroup.style.display = select.value === "__custom__" ? "" : "none";
          });
        }
      }
    );

    if (!result || !result.key) return;
    if (result.key in existingSkills) return ui.notifications.warn(`Skill "${result.key}" already exists.`);

    const update = { [`system.creatureSkills.${result.key}`]: result.value };
    await this.document.update(update);
  }

  async _onRemoveCreatureSkill(event, target) {
    event.preventDefault();
    const key = target.dataset.skillKey;
    if (!key) return;
    // ObjectField keys are removed by setting them to -=null via Foundry's delete syntax
    await this.document.update({ [`system.creatureSkills.-=${key}`]: null });
  }

  async _onEditCreatureSkill(event, target) {
    event.preventDefault();
    const key = target.dataset.skillKey;
    if (!key) return;
    const rawVal = this.document.system.creatureSkills?.[key];
    const sk = normalizeCreatureSkill(rawVal);
    const label = key.replace(/([A-Z])/g, " $1").trim();
    const labelCap = label.charAt(0).toUpperCase() + label.slice(1);

    const content = `
      <form class="reign-dialog-form">
        <div class="reign-dialog-callout">
          <strong>${labelCap}</strong>
        </div>
        <div class="form-group">
          <label>Dice</label>
          <input type="number" name="skillValue" value="${sk.value}" min="0" max="10" style="width:60px;" autofocus/>
        </div>
        <div class="reign-grid-2col reign-gap-small">
          <div class="form-group">
            <label><input type="checkbox" name="hasEd" ${sk.expert ? "checked" : ""}/> Expert Die (ED)</label>
          </div>
          <div class="form-group">
            <label><input type="checkbox" name="hasMd" ${sk.master ? "checked" : ""}/> Master Die (MD)</label>
          </div>
        </div>
        <p class="reign-text-small reign-text-muted">RAW: You cannot have both ED and MD in the same pool. If both are checked, only MD applies.</p>
      </form>`;

    const result = await reignDialog(`Edit Skill — ${labelCap}`, content,
      (e, b, d) => {
        const f = d.element.querySelector("form");
        const numVal = parseInt(f.querySelector('[name="skillValue"]')?.value) || 0;
        const hasEd = f.querySelector('[name="hasEd"]')?.checked || false;
        const hasMd = f.querySelector('[name="hasMd"]')?.checked || false;
        return { value: numVal, expert: hasMd ? false : hasEd, master: hasMd };
      },
      { defaultLabel: "Save" }
    );

    if (result === null || result === undefined) return;
    await this.document.update({ [`system.creatureSkills.${key}`]: result });
  }

  // =====================================================
  // CREATURE ROLLING — FIX BUG-001 (MD), BUG-007 (cap 15)
  // =====================================================

  /**
   * Silent roll helper — no dialog. Used by special-ability handlers (Boa, Rhino)
   * that have their own scripted flow with custom chat cards.
   * Returns { results, parsed, pool, roll }.
   */
  async _rollCreaturePoolSilent(actor, attrKey, skillKey) {
    const attrs    = actor.system.creatureAttributes || {};
    const skills   = actor.system.creatureSkills     || {};
    const sk       = normalizeCreatureSkill(skills[skillKey]);
    const isMd     = sk.master;
    const isEd     = sk.expert;
    const numVal   = sk.value;
    const attrVal  = parseInt(attrs[attrKey]) || 0;

    const specialCount = (isMd || isEd) ? 1 : 0;
    const pool       = Math.min(attrVal + numVal + specialCount, CREATURE_POOL_CAP);
    const normalPool = Math.max(pool - specialCount, 0);

    const roll = normalPool > 0 ? new Roll(`${normalPool}d10`) : null;
    if (roll) await roll.evaluate();
    let results = roll ? roll.dice[0].results.map(r => r.result) : [];

    // ED face is set elsewhere (RAW: pre-assigned). Default to 10 when not specified.
    if (isEd) results = [...results, 10];

    // MD: even on special-ability rolls, the player chooses the face. Prompt the user.
    if (isMd) {
      const sortedDisplay = [...results].sort((a, b) => b - a).join(", ") || "(none)";
      const mdContent = `
        <form class="reign-dialog-form">
          <p class="reign-text-large reign-mb-small reign-mt-0"><strong>Roll so far:</strong> ${sortedDisplay}</p>
          <p class="reign-text-small reign-text-muted reign-mb-medium">Assign the Master Die a face value (1–10).</p>
          <div class="form-group">
            <label>MD face:</label>
            <input type="number" name="mdFace" value="10" min="1" max="10" autofocus/>
          </div>
        </form>`;
      const mdFace = await reignDialog(
        "Assign Master Die",
        mdContent,
        (e, b, d) => parseInt(d.element.querySelector('[name="mdFace"]')?.value) || 10,
        { defaultLabel: "Finalize" }
      );
      if (mdFace !== null && mdFace !== undefined) results = [...results, mdFace];
    }

    return { results, parsed: parseORE(results), pool, roll };
  }

  /**
   * Opens a roll dialog for a creature pool, builds the breakdown,
   * rolls the dice (injecting MD value 10 directly), and posts via postOREChat.
   *
   * The dialog allows GMs to adjust bonus/penalty, override MD/ED, set multi-actions,
   * and add a difficulty target — same controls as the character roller.
   */
  async _rollCreaturePool(actor, attrKey, skillKey, labelOverride = null, itemData = null) {
    const attrs    = actor.system.creatureAttributes || {};
    const skills   = actor.system.creatureSkills     || {};
    const sk       = normalizeCreatureSkill(skills[skillKey]);
    const isMd     = sk.master;
    const isEd     = sk.expert;
    const numVal   = sk.value;
    const attrVal  = parseInt(attrs[attrKey]) || 0;

    const attrLabel  = attrKey.charAt(0).toUpperCase() + attrKey.slice(1);
    const skillLabel = skillKey ? (skillKey.charAt(0).toUpperCase() + skillKey.slice(1).replace(/([A-Z])/g, " $1").trim()) : "";

    // Build display string for the base pool breakdown
    const skillParts = [];
    if (skillKey) {
      if (numVal > 0) skillParts.push(`${skillLabel} ${numVal}`);
      if (isMd) skillParts.push("MD");
      else if (isEd) skillParts.push("ED");
      if (numVal === 0 && !isMd && !isEd) skillParts.push(`${skillLabel} 0`);
    }
    const poolDesc = `${attrLabel} ${attrVal}${skillParts.length ? ` + ${skillParts.join(" + ")}` : ""}`;

    // Roll dialog content — minimal, focused on what creatures need
    const content = `
      <form class="reign-dialog-form">
        <div class="reign-dialog-callout">
          <strong>${labelOverride || skillLabel}</strong>
          <div class="reign-text-muted reign-text-small">
            Base pool: ${poolDesc}
          </div>
        </div>
        <div class="reign-grid-2col reign-gap-small">
          <div class="form-group">
            <label>Bonus dice (+)</label>
            <input type="number" name="bonus" value="0" min="0" max="10"/>
          </div>
          <div class="form-group">
            <label>Penalty dice (−)</label>
            <input type="number" name="penalty" value="0" min="0" max="10"/>
          </div>
          <div class="form-group">
            <label>Multi-actions</label>
            <input type="number" name="multiActions" value="1" min="1" max="5"/>
          </div>
          <div class="form-group">
            <label>Difficulty (Height ≥)</label>
            <input type="number" name="difficulty" value="0" min="0" max="10"/>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="forceMd" ${isMd ? "checked" : ""}/>
              Master Die (MD)
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="forceEd" ${isEd ? "checked" : ""}/>
              Expert Die (ED)
            </label>
          </div>
          <div class="form-group" style="grid-column: span 2;">
            <label>ED face (1–10)</label>
            <input type="number" name="edFace" value="10" min="1" max="10"/>
          </div>
        </div>
      </form>`;

    const opts = await reignDialog(
      `Roll ${labelOverride || skillLabel}`,
      content,
      (e, b, d) => {
        const f = d.element.querySelector("form");
        return {
          bonus:        parseInt(f.querySelector('[name="bonus"]')?.value)        || 0,
          penalty:      parseInt(f.querySelector('[name="penalty"]')?.value)      || 0,
          multiActions: Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1),
          difficulty:   parseInt(f.querySelector('[name="difficulty"]')?.value)   || 0,
          forceMd:      f.querySelector('[name="forceMd"]')?.checked || false,
          forceEd:      f.querySelector('[name="forceEd"]')?.checked || false,
          edFace:       parseInt(f.querySelector('[name="edFace"]')?.value) || 10
        };
      },
      { defaultLabel: "Roll" }
    );

    if (!opts) return; // cancelled

    const useMd = opts.forceMd;
    const useEd = opts.forceEd;
    const specialCount = (useMd || useEd) ? 1 : 0;

    // Pool calculation — track each modifier for the breakdown display
    const breakdown = [];
    let pool = 0;
    breakdown.push({ label: attrLabel,                  value: `+${attrVal}`,  isPenalty: false });
    pool += attrVal;
    if (skillKey && numVal > 0) {
      breakdown.push({ label: skillLabel,               value: `+${numVal}`,   isPenalty: false });
      pool += numVal;
    }
    if (useMd) breakdown.push({ label: "Master Die",     value: "+1 (auto-10)",isPenalty: false });
    if (useEd) breakdown.push({ label: `Expert Die (face ${opts.edFace})`, value: "+1", isPenalty: false });
    pool += specialCount;
    if (opts.bonus > 0) {
      breakdown.push({ label: "Bonus",                   value: `+${opts.bonus}`, isPenalty: false });
      pool += opts.bonus;
    }
    if (opts.penalty > 0) {
      breakdown.push({ label: "Penalty",                 value: `−${opts.penalty}`, isPenalty: true });
      pool -= opts.penalty;
    }
    if (opts.multiActions > 1) {
      const maPenalty = opts.multiActions - 1;
      breakdown.push({ label: `Multi-action (${opts.multiActions})`, value: `−${maPenalty}`, isPenalty: true });
      pool -= maPenalty;
    }

    // Apply creature pool cap
    const wasCapped = pool > CREATURE_POOL_CAP;
    if (wasCapped) {
      breakdown.push({ label: "Capped",                  value: `→${CREATURE_POOL_CAP}d`, isPenalty: true });
      pool = CREATURE_POOL_CAP;
    }
    pool = Math.max(pool, 0);

    // Roll: normal pool minus any special dice (which are injected separately)
    const normalPool = Math.max(pool - specialCount, 0);
    const roll = normalPool > 0 ? new Roll(`${normalPool}d10`) : null;
    if (roll) await roll.evaluate();
    let results = roll ? roll.dice[0].results.map(r => r.result) : [];

    // ED: face is set in the dialog before the roll (static modifier) — inject directly
    if (useEd) results = [...results, opts.edFace];

    // RAW: Master Dice are SET ASIDE from the pool. After the rest of the roll resolves,
    // the player chooses what face to assign — typically picking a face that matches
    // existing dice to make a wider set. Auto-assigning 10 is incorrect.
    // Prompt the GM for the MD face value, showing the current roll for context.
    if (useMd) {
      const sortedDisplay = [...results].sort((a, b) => b - a).join(", ") || "(none)";
      const mdContent = `
        <form class="reign-dialog-form">
          <p class="reign-text-large reign-mb-small reign-mt-0"><strong>Roll so far:</strong> ${sortedDisplay}</p>
          <p class="reign-text-small reign-text-muted reign-mb-medium">
            Assign the Master Die a face value (1–10). Typically chosen to match existing dice and form the widest set.
          </p>
          <div class="form-group">
            <label>Master Die face:</label>
            <input type="number" name="mdFace" value="10" min="1" max="10" autofocus/>
          </div>
        </form>`;

      const mdFace = await reignDialog(
        "Assign Master Die",
        mdContent,
        (e, b, d) => parseInt(d.element.querySelector('[name="mdFace"]')?.value) || 10,
        { defaultLabel: "Finalize Roll" }
      );

      // If GM cancels the MD dialog, abort the entire roll cleanly
      if (mdFace === null || mdFace === undefined) return;
      results = [...results, mdFace];

      // Update the breakdown so the chat card reflects the actual MD face used
      const mdEntry = breakdown.find(b => b.label === "Master Die");
      if (mdEntry) mdEntry.value = `+1 (face ${mdFace})`;
    }

    // Clean label for title — just the action name
    const cleanLabel = labelOverride || skillLabel;

    await postOREChat(
      actor, cleanLabel, pool, results,
      useEd ? opts.edFace : 0,
      useMd ? 1 : 0,
      itemData,
      {
        multiActions: opts.multiActions,
        difficulty:   opts.difficulty,
        wasCapped,
        poolBreakdown: breakdown,
        isAttack:  !!itemData,
        isDefense: false
      },
      roll
    );
  }

  async _onRollCreatureSkill(event, target) {
    event.preventDefault();
    try {
      const actor    = this.document;
      const skillKey = target.dataset.skillKey;
      const attrKey  = SENSE_SKILLS.has(skillKey) ? "sense"
                     : COORD_SKILLS.has(skillKey) ? "coordination" : "body";
      await this._rollCreaturePool(actor, attrKey, skillKey);
    } catch (err) {
      ui.notifications.error(`Roll failed: ${err.message}`); console.error(err);
    }
  }

  async _onRollCreatureAttack(event, target) {
    event.preventDefault();
    try {
      const actor = this.document;
      const idx   = parseInt(target.dataset.attackIndex);
      const atk   = actor.system.creatureAttacks?.[idx];
      if (!atk) return ui.notifications.warn("Attack definition not found.");

      const itemData = {
        name: atk.name, type: "weapon",
        system: {
          damage:    atk.damage,
          pool: "", range: "",
          qualities: { armorPiercing: 0, slow: atk.isSlow || 0, area: 0, massive: false }
        }
      };

      await this._rollCreaturePool(
        actor, atk.attribute || "body", atk.skill || "", atk.name, itemData
      );
      // No auto-venom — explicit Roll Venom button only.
    } catch (err) {
      ui.notifications.error(`Attack roll failed: ${err.message}`); console.error(err);
    }
  }

  // =====================================================
  // G4.2: ELEPHANT
  // =====================================================

  async _onElephantTrumpet(event, target) {
    event.preventDefault();
    try {
      if (this.document.getFlag("reign", "elephantTrumpetUsed"))
        return ui.notifications.warn("Already used this combat.");

      const content = `<form class="reign-dialog-form">
        <p class="reign-text-small reign-text-muted">RAW Ch13: Once per combat. MA 4 vs familiar opponents; MA 10 vs those who have never seen an elephant.</p>
        <div class="form-group">
          <label>Morale Attack Strength:</label>
          <select name="maValue">
            <option value="4">4 — Familiar opponents</option>
            <option value="10">10 — Never seen an elephant</option>
          </select>
        </div>
      </form>`;
      const maValue = await reignDialog("Elephant Rears and Trumpets!", content,
        (e, b, d) => parseInt(d.element.querySelector('[name="maValue"]')?.value) || 4,
        { defaultLabel: "Apply Morale Attack" });
      if (!maValue) return;
      await applyOffensiveMoraleAttack(maValue, "Elephant Rears and Trumpets!");
      await this.document.setFlag("reign", "elephantTrumpetUsed", true);
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onElephantTrunkGrab(event, target) {
    event.preventDefault();
    try {
      const targets = game.user.targets;
      if (!targets.size) return ui.notifications.warn("Select a target token first.");
      const targetNames = [...targets].map(t => foundry.utils.escapeHTML(t.name)).join(", ");
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.document }),
        content: `<div class="reign-chat-card">
          <h3>🐘 Trunk Grab — ${foundry.utils.escapeHTML(this.document.name)}</h3>
          <p><strong>Target:</strong> ${targetNames}</p>
          <p>Roll <strong>Body + Grapple</strong>. On a hit: target is <strong>Pinned</strong>. Apply Pinned status manually.</p>
          <p class="reign-text-small">Each subsequent round: 3 Shock to Torso automatically while held.<br>
          Escape: <strong>Body + Fight or Coordination + Grapple</strong> vs elephant's <strong>Body + Fight</strong> (contested). (RAW Ch13.)</p>
        </div>`
      });
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  // =====================================================
  // G4.3: BOA CONSTRICTOR
  // =====================================================

  async _onBoaDropAndGrab(event, target) {
    event.preventDefault();
    try {
      const actor   = this.document;
      const targets = game.user.targets;
      if (!targets.size) return ui.notifications.warn("Select a target token first.");

      const { results, parsed, pool, roll } = await this._rollCreaturePoolSilent(actor, "body", "constrict");
      const hasSet = parsed.sets.length > 0;
      const targetList = [...targets];

      if (hasSet) {
        await actor.update({
          "system.creatureFlags.constrictActive":   true,
          "system.creatureFlags.constrictTargetId": targetList[0]?.actor?.id || ""
        });
        for (const t of targetList) {
          if (t.actor) await t.actor.toggleStatusEffect("restrained", { active: true });
        }
      }

      const diceDisplay = results.map(r => `<span class="reign-die reign-die-plain">${r}</span>`).join(" ");
      const targetNames = targetList.map(t => foundry.utils.escapeHTML(t.name)).join(", ");
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="reign-chat-card">
          <h3>🐍 Drop & Grab — ${foundry.utils.escapeHTML(actor.name)}</h3>
          <p><strong>Target:</strong> ${targetNames}</p>
          <div class="dice-tray wrap">${diceDisplay}</div>
          <p>${hasSet
            ? `<strong class="reign-text-danger">Set ${parsed.sets[0].width}×${parsed.sets[0].height} — TARGET IS PINNED!</strong>`
            : `<span class="reign-text-muted">No set — grab fails.</span>`}</p>
          ${hasSet ? `<p class="reign-text-small">Each round: roll <em>Constrict</em> from the Special Abilities panel.</p>` : ""}
        </div>`
      });
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onBoaConstrict(event, target) {
    event.preventDefault();
    try {
      const actor = this.document;
      if (!actor.system.creatureFlags?.constrictActive)
        return ui.notifications.warn("Constrict not active. Use Drop & Grab first.");

      // FIX BUG-003: use stored constrictTargetId, not game.user.targets
      const targetId    = actor.system.creatureFlags.constrictTargetId;
      const targetActor = targetId ? game.actors.get(targetId) : null;

      const { results, parsed, pool } = await this._rollCreaturePoolSilent(actor, "body", "constrict");
      const hasSet = parsed.sets.length > 0;
      const dmgWidth = hasSet ? parsed.sets[0].width : 0;

      if (hasSet && targetActor) {
        await applyScatteredDamageToTarget(
          parsed.sets[0].width, parsed.sets[0].height,
          `${dmgWidth} Shock`, 0, false, dmgWidth, actor,
          { ignoreFlexibleArmor: true, targetActorId: targetId }
        );
      }

      const diceDisplay = results.map(r => `<span class="reign-die reign-die-plain">${r}</span>`).join(" ");
      const bodyVal     = actor.system.creatureAttributes?.body || "?";
      const constSkill  = normalizeCreatureSkill(actor.system.creatureSkills?.constrict);
      const constVal    = constSkill.value || "?";
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="reign-chat-card">
          <h3>🐍 Constrict — ${foundry.utils.escapeHTML(actor.name)}</h3>
          <div class="dice-tray wrap">${diceDisplay}</div>
          <p>${hasSet
            ? `<strong class="reign-text-danger">Area Shock ×${dmgWidth}</strong> applied (ignores chain/leather AR).`
            : `<span class="reign-text-muted">No set — no effect this round.</span>`}</p>
          <p class="reign-text-small">Escape: <strong>Body+Fight or Coordination+Grapple</strong> vs Difficulty equal to the boa's Body (${bodyVal}) or Constrict (${constVal}), whichever is higher. (RAW Ch6 — Pin escape.)</p>
        </div>`
      });
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onBoaReleaseTarget(event, target) {
    event.preventDefault();
    try {
      const actor     = this.document;
      const targetId  = actor.system.creatureFlags?.constrictTargetId;
      const targetActor = targetId ? game.actors.get(targetId) : null;
      await actor.update({
        "system.creatureFlags.constrictActive":   false,
        "system.creatureFlags.constrictTargetId": ""
      });
      if (targetActor) await targetActor.toggleStatusEffect("restrained", { active: false });
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  // =====================================================
  // G4.4: RHINO CHARGE
  // =====================================================

  async _onRhinoBuildCharge(event, target) {
    event.preventDefault();
    try {
      const actor = this.document;
      const { results, parsed, pool } = await this._rollCreaturePoolSilent(actor, "body", "run");
      const newWidth = parsed.sets.length > 0 ? parsed.sets[0].width : 0;
      const prevWidest = actor.system.creatureFlags?.chargeRunWidest || 0;
      const bestWidth  = Math.max(prevWidest, newWidth);
      if (newWidth > prevWidest) await actor.update({ "system.creatureFlags.chargeRunWidest": bestWidth });

      const BONUS = { 2: "+1 Killing", 3: "+2 Shock, +1 Killing", 4: "+3 Shock, +2 Killing" };
      const bonusLabel = bestWidth >= 4 ? BONUS[4] : (BONUS[bestWidth] || "No bonus yet (need Width 2+)");
      const diceDisplay = results.map(r => `<span class="reign-die reign-die-plain">${r}</span>`).join(" ");

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="reign-chat-card">
          <h3>🦏 Building Charge — ${foundry.utils.escapeHTML(actor.name)}</h3>
          <div class="dice-tray wrap">${diceDisplay}</div>
          <p>Run roll: <strong>${newWidth > 0 ? `${newWidth}×${parsed.sets[0].height}` : "No set"}</strong>
             | Best Width: <strong>${bestWidth}</strong></p>
          <p>Current bonus: <strong>${bonusLabel}</strong></p>
        </div>`
      });
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  async _onRhinoGoreCharge(event, target) {
    event.preventDefault();
    try {
      const actor       = this.document;
      const chargeWidth = actor.system.creatureFlags?.chargeRunWidest || 0;
      const { results, parsed, pool } = await this._rollCreaturePoolSilent(actor, "body", "fight");
      await actor.update({ "system.creatureFlags.chargeRunWidest": 0 });

      const diceDisplay = results.map(r => `<span class="reign-die reign-die-plain">${r}</span>`).join(" ");
      if (!parsed.sets.length) {
        return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="reign-chat-card"><h3>🦏 Gore — Missed!</h3><div class="dice-tray wrap">${diceDisplay}</div><p>No set. Charge is spent.</p></div>` });
      }

      const hit = parsed.sets[0];
      let bonusShock = 0, bonusKilling = 0;
      if      (chargeWidth >= 4) { bonusShock = 3; bonusKilling = 2; }
      else if (chargeWidth >= 3) { bonusShock = 2; bonusKilling = 1; }
      else if (chargeWidth >= 2) { bonusKilling = 1; }

      const baseKilling  = hit.width + 1;
      const totalKilling = baseKilling + bonusKilling;
      const dmgStr       = `${totalKilling} Killing${bonusShock > 0 ? ` + ${bonusShock} Shock` : ""}`;
      const chargeStr    = chargeWidth > 0 ? ` + Charge (Width ${chargeWidth})` : "";

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="reign-chat-card">
          <h3>🦏 Gore with Charge — ${foundry.utils.escapeHTML(actor.name)}</h3>
          <div class="dice-tray wrap">${diceDisplay}</div>
          <p>Hit: <strong>${hit.width}×${hit.height}</strong>${chargeStr}</p>
          <p>Damage: <strong>${dmgStr}</strong></p>
          <div class="reign-action-buttons">
            <button class="reign-btn-primary apply-dmg-btn"
              data-width="${hit.width}" data-height="${hit.height}"
              data-dmg-string="${totalKilling} Killing"
              data-ap="0" data-massive="false" data-area-dice="0">Apply Damage</button>
          </div>
        </div>`
      });
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  // =====================================================
  // G4.5: VENOM — explicit manual trigger only (not auto)
  // =====================================================

  async _onRollVenom(event, target) {
    event.preventDefault();
    try {
      const targets     = game.user.targets;
      const targetActor = targets.size > 0 ? [...targets][0].actor : null;
      await applyCreatureVenom(this.document, targetActor);
    } catch (err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
  }

  // =====================================================
  // DATA PREPARATION
  // =====================================================

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor  = this.document;
    context.system = this.document.system;

    // Mob context
    const companyList = {};
    game.actors.filter(a => a.type === "company").sort((a,b) => a.name.localeCompare(b.name))
      .forEach(c => { companyList[c.id] = c.name; });
    context.companies    = companyList;
    context.groupSize    = this.document.system.magnitude?.value || 0;
    context.maxGroup     = this.document.system.magnitude?.max   || 0;
    context.threatRating = this.document.system.threatLevel || 1;
    context.isDestroyed  = context.groupSize <= 0;
    context.effectivePool = Math.min(context.groupSize, 15);
    context.poolCapped    = context.groupSize > 15;
    context.groupPercent  = context.maxGroup > 0
      ? Math.round((context.groupSize / context.maxGroup) * 100) : 0;

    context.isCreatureMode = !!this.document.system.creatureMode;
    if (!context.isCreatureMode) return context;

    const locs  = this.document.system.customLocations || [];
    const attrs = this.document.system.creatureAttributes || {};

    // ── Location colour palette
    const LOC_COLORS = ["blood","brass","emerald","blue","purple","teal","ash","amber"];

    // ── Die-face heat map
    const faceMapRaw = {};
    for (let f = 1; f <= 10; f++) faceMapRaw[f] = null;

    // ── Enriched location data
    context.creatureLocations = locs.map((loc, idx) => {
      const shock   = loc.shock   || 0;
      const killing = loc.killing || 0;
      const max     = loc.woundBoxes || 5;
      const color   = LOC_COLORS[idx % LOC_COLORS.length];

      for (const h of (loc.rollHeights || [])) {
        faceMapRaw[h] = faceMapRaw[h] === null
          ? { key: loc.key, name: loc.name, color }
          : { key: "shared", name: "↔ overlap", color: "ash" };
      }

      // Status — use RAW-adjacent terms
      let statusLabel = "—", statusClass = "status-healthy";
      if (killing >= max && max > 0)                           { statusLabel = "Destroyed"; statusClass = "status-destroyed"; }
      else if (killing > 0 && killing >= Math.ceil(max / 2))  { statusLabel = "Critical";  statusClass = "status-killing"; }
      else if (killing > 0)                                    { statusLabel = "Wounded";   statusClass = "status-killing"; }
      else if (shock >= max && max > 0)                        { statusLabel = "Full";      statusClass = "status-shock"; }
      else if (shock > 0)                                      { statusLabel = "Shocked";   statusClass = "status-shock"; }

      // Wound boxes — killing fills from LEFT, shock from right of killing
      const boxes = Array.from({ length: max }, (_, i) => ({
        index: i,
        state: i < killing ? "killing" : (i < killing + shock ? "shock" : "")
      }));

      const heights = (loc.rollHeights || []).slice().sort((a,b) => a-b);
      return {
        ...loc, index: idx, color,
        heightPips: heights,
        heightLabel: heights.length > 0 ? heights.join(", ") : "redirect only",
        isRedirectOnly: heights.length === 0,
        boxes, statusLabel, statusClass,
        isDestroyed: killing >= max && max > 0
      };
    });

    context.faceMap = Array.from({ length: 10 }, (_, i) => {
      const face = i + 1;
      const hit  = faceMapRaw[face];
      return { face, locName: hit?.name || "—", color: hit?.color || "empty", hasLoc: !!hit };
    });

    // ── Special mechanics
    const flags = this.document.system.creatureFlags || {};
    context.hasFreeGobble      = (flags.freeGobbleDicePerRound || 0) > 0;
    context.hasVenom           = (flags.venomPotency || 0) > 0;
    context.moraleAttackUsed   = !!this.document.getFlag("reign", "elephantTrumpetUsed");
    context.constrictActive    = !!flags.constrictActive;
    context.hasConstrict       = !!flags.hasConstrict;
    context.constrictTargetName = flags.constrictTargetId
      ? (game.actors.get(flags.constrictTargetId)?.name || "Unknown") : null;
    // FIX BUG-004: charge only for creatures with explicit flag, not all 'run' creatures
    context.hasCharge          = !!flags.hasChargeAccumulation;
    context.chargeWidth        = flags.chargeRunWidest || 0;
    context.isHumanoidCreature = locs.length === 6 && locs.every(l => HIT_LOCATIONS_SET.has(l.key));

    // ── Skill display — FIX UX-007/008/011: sort, correct attr pairing, camelCase labels
    const COMBAT_SKILL_ORDER = ["fight","bite","claw","kick","ram","constrict","trample","grapple","dodge","parry","athletics","climb","swim","run","stealth"];
    const rawSkills = this.document.system.creatureSkills || {};

    const buildSkillEntry = (key, rawVal) => {
      const sk    = normalizeCreatureSkill(rawVal);
      const isMd  = sk.master;
      const isEd  = sk.expert;
      const numVal = sk.value;
      const attrKey = SENSE_SKILLS.has(key) ? "sense"
                    : COORD_SKILLS.has(key) ? "coordination" : "body";
      const attrVal = parseInt(attrs[attrKey]) || 0;
      // FIX UX-011: convert camelCase keys to spaced labels
      const label = key.replace(/([A-Z])/g, " $1").trim();

      // Build display value: show dice count and/or ED/MD
      let displayVal = String(numVal);
      if (isMd) displayVal = numVal > 0 ? `${numVal}+MD` : "MD";
      else if (isEd) displayVal = numVal > 0 ? `${numVal}+ED` : "ED";

      return {
        key, label: label.charAt(0).toUpperCase() + label.slice(1),
        value: displayVal,
        numVal, isMd, isEd,
        badge: isMd ? "reign-badge-md" : isEd ? "reign-badge-ed" : "",
        isSense: SENSE_SKILLS.has(key),
        attrKey, attrLabel: attrKey.charAt(0).toUpperCase() + attrKey.slice(1),
        attrVal,
        totalPool: attrVal + numVal + ((isMd || isEd) ? 1 : 0),
        sortOrder: COMBAT_SKILL_ORDER.indexOf(key) >= 0
          ? COMBAT_SKILL_ORDER.indexOf(key) : 999
      };
    };

    context.creatureSkillDisplay = Object.entries(rawSkills)
      .map(([key, val]) => buildSkillEntry(key, val))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

    // Pre-split into combat and perception arrays — robust against any HBS template
    // scoping issues with boolean iteration filters.
    context.combatSkills     = context.creatureSkillDisplay.filter(s => !s.isSense);
    context.perceptionSkills = context.creatureSkillDisplay.filter(s =>  s.isSense);

    return context;
  }
}