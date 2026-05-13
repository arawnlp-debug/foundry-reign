// scripts/apps/spell-tracker.js
// ════════════════════════════════════════════════════════════════════════════
//  ACTIVE SPELL TRACKER — Scene-Level Sorcery Management
//  Reign: Realities of Lords and Leaders (Foundry VTT V14)
//
//  Tracks active spell effects across a scene. Spells are auto-captured when
//  a spell roll fires (Width ≥ Intensity) via the createChatMessage hook,
//  reading metadata already serialised into message.flags.reign.itemData by
//  postOREChat. Manual addition is also available. State is persisted to
//  world flags. GM-only.
// ════════════════════════════════════════════════════════════════════════════

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";
import { parseORE }            from "../helpers/ore-engine.js";
import { CharacterRoller }     from "../helpers/character-roller.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FLAG_SCOPE = "reign";
const FLAG_KEY   = "activeSpells";

/**
 * RAW Realms p.147 — Detection radius by spell Intensity.
 * Index matches Intensity (1–10). Index 0 unused.
 */
const DETECTION_RADIUS = [
  "—", "—", "5 ft", "10 ft", "50 ft",
  "1,000 ft", "1 mile", "10 miles", "25 miles", "50 miles", "100 miles"
];

// ─── Utility ──────────────────────────────────────────────────────────────────

function getDetectionRadius(intensity) {
  return DETECTION_RADIUS[Math.min(10, Math.max(1, parseInt(intensity) || 1))] ?? "—";
}

/**
 * CSS class token for intensity tier badges.
 * Mirrors the character sheet's intensityClass helper.
 */
function intensityTierClass(intensity) {
  const i = parseInt(intensity) || 1;
  if (i <= 2) return "st-int-low";
  if (i <= 4) return "st-int-mid";
  if (i <= 6) return "st-int-high";
  return "st-int-extreme";
}

/** Current world month, derived from the highest company chronicle entry. */
function _getWorldMonth() {
  let month = 0;
  for (const c of game.actors.filter(a => a.type === "company")) {
    for (const entry of (c.system.chronicle || [])) {
      if (entry.month > month) month = entry.month;
    }
  }
  return month || 1;
}

/** Generates a stable unique entry id. */
function _makeId() {
  return `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Storage ──────────────────────────────────────────────────────────────────
//  Uses game.settings (world scope) — NOT game.world.setFlag, which doesn't
//  exist (game.world is plain metadata, not a Document instance).
//  The setting is registered in the Hooks.once("init") block at the bottom.

function _loadSpells() {
  try {
    const data = game.settings.get(FLAG_SCOPE, FLAG_KEY);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function _saveSpells(spells) {
  await game.settings.set(FLAG_SCOPE, FLAG_KEY, spells);
}

// ─── Data annotation ─────────────────────────────────────────────────────────

/**
 * Annotate a raw stored entry with derived display properties.
 * Called during _prepareContext so the template receives clean data.
 */
function _annotate(entry) {
  return {
    ...entry,
    intensityClass:  intensityTierClass(entry.intensity),
    detectionRadius: getDetectionRadius(entry.intensity),
    isActive:        entry.status === "active",
    isExpired:       entry.status === "expired",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  SpellTracker — ApplicationV2
// ═════════════════════════════════════════════════════════════════════════════

export class SpellTracker extends ScrollPreserveMixin(HandlebarsApplicationMixin(ApplicationV2)) {

  static DEFAULT_OPTIONS = {
    id: "reign-spell-tracker",
    classes: ["reign", "spell-tracker", "app-v2"],
    tag: "div",
    window: {
      title:     "Active Spell Tracker",
      icon:      "fas fa-hat-wizard",
      resizable: true,
      width:     560,
      height:    500,
    },
    actions: {
      addSpell:       SpellTracker.prototype._onAddSpell,
      removeSpell:    SpellTracker.prototype._onRemoveSpell,
      toggleStatus:   SpellTracker.prototype._onToggleStatus,
      toggleDetected: SpellTracker.prototype._onToggleDetected,
      rollDetection:  SpellTracker.prototype._onRollDetection,
      clearExpired:   SpellTracker.prototype._onClearExpired,
    }
  };

  static PARTS = {
    main: { template: "systems/reign/templates/apps/spell-tracker.hbs" }
  };

  // ─── Sync ────────────────────────────────────────────────────────────────

  /** Re-render every open SpellTracker window. */
  static syncAll() {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof SpellTracker) app.render(false);
    }
  }

  // ─── Auto-capture (called from createChatMessage hook) ───────────────────

  /**
   * Inspects a newly created ChatMessage for a fired spell and adds it to the
   * tracker automatically if the GM is active.
   *
   * Relies on message.flags.reign.itemData already being populated by
   * postOREChat() in chat.js — no modifications to that file are required.
   *
   * @param {ChatMessage} message
   */
  static async autoCapture(message) {
    if (!game.user.isGM) return;

    const rFlags   = message.flags?.reign;
    const itemData = rFlags?.itemData;

    // Only care about spell item rolls
    if (itemData?.type !== "spell") return;

    // Attunement spells create no lasting scene effect — skip them
    if (itemData.system?.isAttunementSpell) return;

    // Only capture spells that actually fired (set Width ≥ Intensity RAW)
    const intensity = parseInt(itemData.system?.intensity) || 1;
    const results   = rFlags?.results || [];
    const parsed    = parseORE(results);
    const fired     = parsed.sets.some(s => s.width >= intensity);
    if (!fired) return;

    const spells = await _loadSpells();
    spells.unshift({
      id:          _makeId(),
      spellName:   itemData.name              || "Unknown Spell",
      casterName:  message.speaker?.alias     || "Unknown",
      school:      itemData.system?.school    || "",
      intensity,
      duration:    itemData.system?.duration  || "",
      status:      "active",
      detected:    false,
      worldMonth:  _getWorldMonth(),
      notes:       "",
      capturedAt:  Date.now(),
    });

    await _saveSpells(spells);
    SpellTracker.syncAll();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════════════════════

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const raw     = await _loadSpells();

    context.spells       = raw.map(_annotate);
    context.activeCount  = raw.filter(s => s.status === "active").length;
    context.expiredCount = raw.filter(s => s.status === "expired").length;
    context.isEmpty      = raw.length === 0;
    context.isGM         = game.user.isGM;
    return context;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  POST-RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender(context, options);

    // Notes textareas: save on blur so typing is never interrupted by re-renders.
    this.element.querySelectorAll(".st-notes-input").forEach(ta => {
      ta.addEventListener("blur", () => {
        const id = ta.closest("[data-spell-id]")?.dataset.spellId;
        if (id) this._commitNotes(id, ta.value);
      });
      // Auto-resize: grow the textarea to show all content without scrolling.
      ta.addEventListener("input", () => {
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
      });
      // Initialise height on render
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    });
  }

  /**
   * Persists notes for a single entry without triggering a full re-render.
   * Keeps the textarea focused and the cursor in place.
   */
  async _commitNotes(spellId, notes) {
    const spells = await _loadSpells();
    const entry  = spells.find(s => s.id === spellId);
    if (!entry) return;
    entry.notes = notes;
    await _saveSpells(spells);
    // Deliberately no syncAll — the live textarea already reflects the value.
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Add (manual) ────────────────────────────────────────────────────────

  async _onAddSpell(event, target) {
    event.preventDefault();

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Add Active Spell", classes: ["reign-dialog-window"] },
      position: { width: 420, height: "auto" },
      content: `
        <div class="reign-dialog-form">
          <div class="form-group">
            <label>Spell Name</label>
            <input type="text" id="st-name" placeholder="e.g. Aqueous Divination" style="width:100%"/>
          </div>
          <div class="form-group">
            <label>Caster</label>
            <input type="text" id="st-caster" placeholder="Character name" style="width:100%"/>
          </div>
          <div class="form-group">
            <label>School</label>
            <input type="text" id="st-school" placeholder="e.g. Water Sight (optional)" style="width:100%"/>
          </div>
          <div class="form-group">
            <label>Intensity (1–10)</label>
            <input type="number" id="st-intensity" value="1" min="1" max="10" style="width:80px"/>
          </div>
          <div class="form-group">
            <label>Duration</label>
            <input type="text" id="st-duration" placeholder="e.g. Width hours (optional)" style="width:100%"/>
          </div>
        </div>`,
      ok: {
        label: "Add Spell",
        callback: (ev, btn, dialog) => ({
          spellName:  dialog.querySelector("#st-name")?.value?.trim()      || "Unknown Spell",
          casterName: dialog.querySelector("#st-caster")?.value?.trim()    || "Unknown",
          school:     dialog.querySelector("#st-school")?.value?.trim()    || "",
          intensity:  parseInt(dialog.querySelector("#st-intensity")?.value) || 1,
          duration:   dialog.querySelector("#st-duration")?.value?.trim()  || "",
        })
      },
      rejectClose: false,
    });

    if (!result) return;

    const intensity = Math.min(10, Math.max(1, result.intensity));
    const spells    = await _loadSpells();
    spells.unshift({
      id:          _makeId(),
      spellName:   result.spellName,
      casterName:  result.casterName,
      school:      result.school,
      intensity,
      duration:    result.duration,
      status:      "active",
      detected:    false,
      worldMonth:  _getWorldMonth(),
      notes:       "",
      capturedAt:  Date.now(),
    });

    await _saveSpells(spells);
    this.render(false);
  }

  // ─── Remove ──────────────────────────────────────────────────────────────

  async _onRemoveSpell(event, target) {
    event.preventDefault();
    const id = target.closest("[data-spell-id]")?.dataset.spellId;
    if (!id) return;

    const spells = await _loadSpells();
    await _saveSpells(spells.filter(s => s.id !== id));
    this.render(false);
  }

  // ─── Status toggle (Active ↔ Expired) ────────────────────────────────────

  async _onToggleStatus(event, target) {
    event.preventDefault();
    const id = target.closest("[data-spell-id]")?.dataset.spellId;
    if (!id) return;

    const spells = await _loadSpells();
    const entry  = spells.find(s => s.id === id);
    if (!entry) return;

    entry.status = entry.status === "active" ? "expired" : "active";
    await _saveSpells(spells);
    this.render(false);
  }

  // ─── Detected flag toggle ────────────────────────────────────────────────

  async _onToggleDetected(event, target) {
    event.preventDefault();
    const id = target.closest("[data-spell-id]")?.dataset.spellId;
    if (!id) return;

    const spells = await _loadSpells();
    const entry  = spells.find(s => s.id === id);
    if (!entry) return;

    entry.detected = !entry.detected;
    await _saveSpells(spells);
    this.render(false);
  }

  // ─── Roll Detection (Sense + Eerie) ──────────────────────────────────────

  /**
   * Opens a Sense + Eerie detection roll for a chosen character.
   * Uses the existing isEerieDetection path in CharacterRoller.rollCharacter —
   * the same path triggered by the "Roll Sense + Eerie" button on spell chat cards.
   *
   * If a character token is currently selected on canvas, it is used directly.
   * Otherwise a picker dialog lets the GM choose from available characters.
   */
  async _onRollDetection(event, target) {
    event.preventDefault();
    const id = target.closest("[data-spell-id]")?.dataset.spellId;
    if (!id) return;

    const spells = await _loadSpells();
    const entry  = spells.find(s => s.id === id);
    if (!entry) return;

    // Resolve actor: prefer the currently selected canvas token.
    let actor = canvas?.tokens?.controlled?.[0]?.actor;
    if (!actor || actor.type !== "character") {
      actor = await this._pickCharacter();
    }

    if (!actor) return; // Cancelled

    await CharacterRoller.rollCharacter(actor, {
      type:                 "skill",
      key:                  "eerie",
      label:                `Sense + Eerie — ${entry.spellName}`,
      isEerieDetection:     true,
      eerieSpellName:       entry.spellName,
      eerieDetectionRadius: getDetectionRadius(entry.intensity),
    });
  }

  /**
   * Shows a character picker dialog when no token is selected on canvas.
   * @returns {Actor|null}
   */
  async _pickCharacter() {
    const characters = game.actors.filter(a => a.type === "character");
    if (characters.length === 0) {
      ui.notifications.warn("No character actors available.");
      return null;
    }

    const opts = characters
      .map(a => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`)
      .join("");

    const actorId = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Roll Detection — Select Character", classes: ["reign-dialog-window"] },
      position: { width: 340, height: "auto" },
      content: `
        <div class="reign-dialog-form">
          <p class="reign-text-sm reign-text-muted">
            Who makes the Sense + Eerie roll? Select a token on canvas first to skip this step.
          </p>
          <div class="form-group">
            <label>Character</label>
            <select id="st-det-actor" style="width:100%">${opts}</select>
          </div>
        </div>`,
      ok: {
        label: "Roll",
        callback: (ev, btn, dialog) => dialog.querySelector("#st-det-actor")?.value,
      },
      rejectClose: false,
    });

    return actorId ? game.actors.get(actorId) ?? null : null;
  }

  // ─── Clear expired ───────────────────────────────────────────────────────

  async _onClearExpired(event, target) {
    event.preventDefault();

    const spells  = await _loadSpells();
    const expired = spells.filter(s => s.status === "expired");

    if (expired.length === 0) {
      return ui.notifications.info("No expired spell entries to clear.");
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window:  { title: "Clear Expired Spells", classes: ["reign-dialog-window"] },
      position: { height: "auto" },
      content: `<div class="reign-dialog-form">
        <p>Remove <strong>${expired.length}</strong> expired spell entr${expired.length === 1 ? "y" : "ies"}?</p>
        <p class="reign-text-small reign-text-muted">Active entries will not be affected.</p>
      </div>`,
      rejectClose: false,
    });

    if (!confirmed) return;

    await _saveSpells(spells.filter(s => s.status === "active"));
    this.render(false);
  }
}

// ─── Setting Registration ─────────────────────────────────────────────────────

/**
 * Register the world-scoped setting for spell tracker data.
 * Must happen during init — before any get/set calls in ready or later hooks.
 */
Hooks.once("init", () => {
  game.settings.register(FLAG_SCOPE, FLAG_KEY, {
    name:    "Active Spell Tracker Data",
    hint:    "Internal storage for the Active Spell Tracker. Do not edit manually.",
    scope:   "world",
    config:  false,
    type:    Array,
    default: [],
  });
});

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Auto-capture fired spells from chat messages.
 * Reads metadata from message.flags.reign.itemData, which postOREChat() in
 * chat.js already populates for every item roll — no changes to that file
 * are required.
 *
 * Fires on all clients but only executes for the GM.
 */
Hooks.on("createChatMessage", (message) => {
  SpellTracker.autoCapture(message);
});
