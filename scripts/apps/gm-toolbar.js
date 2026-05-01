// scripts/apps/gm-toolbar.js
// ════════════════════════════════════════════════════════════════════════════
//  REIGN GM TOOLBAR — Frameless HUD Shell (Tier 1)
//  Persistent top-centre bar with contextual drop-down panel.
//  GM-only. Two-layer architecture:
//    Layer 1 — Persistent Bar: World Month, Combat Phase, Party Vitals (Tier 2), Section Toggles
//    Layer 2 — Context Panel: Quick Roll (default), future Token Peek / Contest / Reference
// ════════════════════════════════════════════════════════════════════════════

import { postOREChat, generateOREChatHTML } from "../helpers/chat.js";
import { calculateOREPool, CharacterRoller } from "../helpers/character-roller.js";
import { parseORE } from "../helpers/ore-engine.js";
import { ThreatRoller } from "../helpers/threat-roller.js";
import { FactionDashboard } from "./faction-dashboard.js";
import { openHazardRoller } from "../combat/hazards.js";
import { WealthRoller } from "../helpers/wealth-roller.js";
import { reignDialog } from "../helpers/dialog-util.js";
import { skillAttrMap } from "../helpers/config.js";

const { renderTemplate } = foundry.applications.handlebars;

// ─── Constants ───────────────────────────────────────────────────────────────

const TEMPLATE_PATH = "systems/reign/templates/apps/gm-toolbar.hbs";
const TOOLBAR_ID    = "reign-gm-toolbar";

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Derive the current world month from the highest chronicle entry across all companies. */
function _getWorldMonth() {
  let month = 0;
  for (const c of game.actors.filter(a => a.type === "company")) {
    for (const entry of (c.system.chronicle || [])) {
      if (entry.month > month) month = entry.month;
    }
  }
  return month || 1;
}

/** Get a compact combat summary for the persistent bar. */
function _getCombatSummary() {
  const combat = game.combat;
  if (!combat?.started) return null;
  const phase = combat.getFlag("reign", "phase") || "declaration";
  const round = combat.round || 1;
  const total = combat.combatants.size;
  const declared = combat.combatants.filter(c => c.getFlag("reign", "declared")).length;
  const currentName = combat.combatant?.name || "—";
  return { phase, round, total, declared, currentName, isDeclaring: phase === "declaration" };
}

/** Scan selected token for best attribute+skill pool to pre-populate Quick Roll. */
function _getTokenPoolHint() {
  const token = canvas?.tokens?.controlled?.[0];
  if (!token?.actor) return null;
  const actor = token.actor;
  if (actor.type !== "character" && actor.type !== "threat") return null;

  if (actor.type === "threat") {
    // Threat: pool = magnitude for mobs, or first attack for creatures
    if (actor.system.creatureMode) {
      const attacks = actor.system.creatureAttacks || [];
      if (attacks.length > 0) {
        const atk = attacks[0];
        const attrVal = actor.system.creatureAttributes?.[atk.attribute] || 0;
        const skillRaw = actor.system.creatureSkills?.[atk.skill];
        // Support both legacy (number/"ED"/"MD") and structured ({value, expert, master}) formats
        let skillVal = 0;
        if (skillRaw && typeof skillRaw === "object") {
          skillVal = (skillRaw.value || 0) + ((skillRaw.expert || skillRaw.master) ? 1 : 0);
        } else {
          skillVal = (skillRaw === "MD" || skillRaw === "ED") ? 1 : (parseInt(skillRaw) || 0);
        }
        return { label: `${actor.name}: ${atk.name || "Attack"}`, pool: attrVal + skillVal, actorName: actor.name };
      }
    }
    const mag = actor.system.magnitude?.value || 0;
    return { label: `${actor.name}: Mob Attack`, pool: mag, actorName: actor.name };
  }

  // Character: find highest attribute+skill combination
  const attrs = actor.system.attributes || {};
  const skills = actor.system.skills || {};
  let bestPool = 0;
  let bestLabel = "";

  for (const [aKey, aData] of Object.entries(attrs)) {
    const aVal = parseInt(aData.value) || 0;
    for (const [sKey, sData] of Object.entries(skills)) {
      const sVal = parseInt(sData.value) || 0;
      if (aVal + sVal > bestPool) {
        bestPool = aVal + sVal;
        bestLabel = `${aKey.charAt(0).toUpperCase() + aKey.slice(1)} + ${sKey.charAt(0).toUpperCase() + sKey.slice(1)}`;
      }
    }
  }
  return bestPool > 0 ? { label: `${actor.name}: ${bestLabel}`, pool: bestPool, actorName: actor.name } : null;
}

const HEALTH_LOCS = ["head", "torso", "armR", "armL", "legR", "legL"];

/** Build vitals data for PCs + threats on the active scene.
 *  PCs always shown. Threats shown only when they have a token on canvas.
 *  Sorted by combat turn order during encounters, alphabetically otherwise. */
function _getPartyVitals() {
  const combat = game.combat?.started ? game.combat : null;
  const sceneTokens = canvas?.tokens?.placeables || [];

  // ── Gather PCs ──
  let pcs = game.actors.filter(a => a.type === "character" && (
    a.hasPlayerOwner || game.users.some(u => u.character?.id === a.id)
  ));
  if (pcs.length === 0) pcs = game.actors.filter(a => a.type === "character");

  // ── Gather threats with tokens on canvas ──
  const threatActorIds = new Set();
  const threats = [];
  for (const token of sceneTokens) {
    const actor = token.actor;
    if (!actor || actor.type !== "threat") continue;
    if (threatActorIds.has(actor.id)) continue; // Dedupe linked tokens
    threatActorIds.add(actor.id);
    threats.push(actor);
  }

  // ── Build entries ──
  const entries = [];

  for (const actor of pcs) {
    entries.push(_buildCharacterVital(actor, combat));
  }

  for (const actor of threats) {
    entries.push(_buildThreatVital(actor, combat));
  }

  // ── Sort ──
  if (combat) {
    // During combat: order by combatant turn order (from the sorted tracker)
    const turnOrder = combat.turns?.map(c => c.actorId) || [];
    entries.sort((a, b) => {
      const idxA = turnOrder.indexOf(a.id);
      const idxB = turnOrder.indexOf(b.id);
      // Combatants first (in turn order), non-combatants last (alphabetical)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  } else {
    // Out of combat: PCs alphabetical, then threats alphabetical
    entries.sort((a, b) => {
      if (a.isPC !== b.isPC) return a.isPC ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return entries;
}

/** Build a vitals entry for a character actor. */
function _buildCharacterVital(actor, combat) {
  const health = actor.system.health || {};
  const effMax  = actor.system.effectiveMax || {};

  let worstState = "healthy";
  for (const loc of HEALTH_LOCS) {
    const killing = parseInt(health[loc]?.killing) || 0;
    const shock   = parseInt(health[loc]?.shock)   || 0;
    const max     = parseInt(effMax[loc])           || 5;
    if (killing >= max) { worstState = "critical"; break; }
    if (killing > 0 && worstState !== "critical") worstState = "wounded";
    if (shock > 0 && worstState === "healthy") worstState = "shocked";
  }

  const statuses = Array.from(actor.statuses || []);
  if (statuses.includes("dead"))        worstState = "dead";
  if (statuses.includes("unconscious")) worstState = "dead";

  const conditions = statuses.filter(s => ["dazed","prone","blind","pinned","restrained","bleeding"].includes(s));

  let declared = null;
  if (combat) {
    const combatant = combat.combatants.find(c => c.actorId === actor.id);
    if (combatant) declared = !!combatant.getFlag("reign", "declared");
  }

  return {
    id: actor.id, name: actor.name,
    img: actor.img || "icons/svg/mystery-man.svg",
    worstState, conditions,
    hasConditions: conditions.length > 0,
    declared, inCombat: declared !== null,
    isPC: true, isThreat: false
  };
}

/** Build a vitals entry for a threat actor (mob or creature). */
function _buildThreatVital(actor, combat) {
  const sys = actor.system;
  const isCreature = !!sys.creatureMode;
  let worstState = "healthy";

  if (isCreature) {
    // Creature: scan custom locations like character health
    for (const loc of (sys.customLocations || [])) {
      const killing = loc.killing || 0;
      const shock   = loc.shock || 0;
      const max     = loc.woundBoxes || 5;
      if (killing >= max) { worstState = "critical"; break; }
      if (killing > 0 && worstState !== "critical") worstState = "wounded";
      if (shock > 0 && worstState === "healthy") worstState = "shocked";
    }
  } else {
    // Mob: health state from magnitude ratio
    const mag = parseInt(sys.magnitude?.value) || 0;
    const magMax = parseInt(sys.magnitude?.max) || 1;
    const ratio = mag / magMax;
    if (mag <= 0)        worstState = "dead";
    else if (ratio < 0.25) worstState = "critical";
    else if (ratio < 0.5)  worstState = "wounded";
    else if (ratio < 1)    worstState = "shocked";
    // Check morale
    const morale = parseInt(sys.morale?.value) || 0;
    if (morale <= 0 && mag > 0) worstState = "critical";
  }

  let declared = null;
  if (combat) {
    const combatant = combat.combatants.find(c => c.actorId === actor.id);
    if (combatant) declared = !!combatant.getFlag("reign", "declared");
  }

  return {
    id: actor.id, name: actor.name,
    img: actor.img || "icons/svg/mystery-man.svg",
    worstState, conditions: [],
    hasConditions: false,
    declared, inCombat: declared !== null,
    isPC: false, isThreat: true
  };
}

// ─── Condition Definitions ───────────────────────────────────────────────────

const CONDITIONS = [
  { id: "dazed",      icon: "fas fa-dizzy",        label: "Dazed",      effect: "−1d all actions" },
  { id: "prone",      icon: "fas fa-arrow-down",   label: "Prone",      effect: "−1d combat actions" },
  { id: "blind",      icon: "fas fa-eye-slash",    label: "Blind",      effect: "Diff 4 melee / −2d ranged" },
  { id: "pinned",     icon: "fas fa-thumbtack",    label: "Pinned",     effect: "Cannot move" },
  { id: "restrained", icon: "fas fa-lock",         label: "Restrained", effect: "Cannot act" },
  { id: "bleeding",   icon: "fas fa-tint",         label: "Bleeding",   effect: "Ongoing damage" },
  { id: "maimed",     icon: "fas fa-bone",         label: "Maimed",     effect: "Limb destroyed" },
  { id: "unconscious",icon: "fas fa-bed",          label: "Unconscious",effect: "Head filled with Shock" },
  { id: "dead",       icon: "fas fa-skull",        label: "Dead",       effect: "Head/Torso filled with Killing" }
];

const QUALITY_KEYS  = ["might", "treasure", "influence", "territory", "sovereignty"];
const QUALITY_ICONS = { might: "fas fa-fist-raised", treasure: "fas fa-coins", influence: "fas fa-eye", territory: "fas fa-chess-rook", sovereignty: "fas fa-crown" };
const QUALITY_LABELS = { might: "Might", treasure: "Treasure", influence: "Influence", territory: "Territory", sovereignty: "Sovereignty" };

// ─── Token Peek Data ─────────────────────────────────────────────────────────

/** Build peek data for the currently selected token. Returns null if no token. */
function _getTokenPeekData(expandedAttr = null, showSpells = false) {
  const token = canvas?.tokens?.controlled?.[0];
  if (!token?.actor) return null;
  const actor = token.actor;
  const type = actor.type;
  const statuses = new Set(actor.statuses || []);
  const inCombat = !!game.combat?.started;

  const base = {
    actorId: actor.id,
    tokenId: token.id,
    name: actor.name,
    img: actor.img || "icons/svg/mystery-man.svg",
    type,
    isCharacter: type === "character",
    isThreat: type === "threat",
    isCompany: type === "company"
  };

  // ── CHARACTER ──
  if (type === "character") {
    const sys = actor.system;
    const ATTR_KEYS = ["body", "coordination", "sense", "knowledge", "command", "charm"];
    const attrs = ATTR_KEYS.map(k => ({
      key: k, label: k.slice(0, 3).toUpperCase(), value: parseInt(sys.attributes?.[k]?.value) || 0,
      isExpanded: expandedAttr === k
    }));

    // Reverse skill map: attribute → skills under it
    const skillsByAttr = {};
    for (const aKey of ATTR_KEYS) skillsByAttr[aKey] = [];
    for (const [sKey, aKey] of Object.entries(skillAttrMap)) {
      const sData = sys.skills?.[sKey];
      const val = parseInt(sData?.value) || 0;
      const hasEd = !!sData?.expert;
      const hasMd = !!sData?.master;
      skillsByAttr[aKey]?.push({
        key: sKey,
        label: sKey.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        value: val, hasEd, hasMd,
        pool: (parseInt(sys.attributes?.[aKey]?.value) || 0) + val
      });
    }
    // Add custom skills (keyed by user-defined IDs)
    for (const [csKey, csData] of Object.entries(sys.customSkills || {})) {
      const csAttr = csData.attribute || "body";
      const csVal = parseInt(csData.value) || 0;
      if (skillsByAttr[csAttr]) {
        skillsByAttr[csAttr].push({
          key: `custom_${csKey}`, label: csData.name || csKey, value: csVal,
          hasEd: !!csData.expert, hasMd: !!csData.master,
          pool: (parseInt(sys.attributes?.[csAttr]?.value) || 0) + csVal,
          isCustom: true
        });
      }
    }
    // Sort each group: highest value first, then alphabetical
    for (const aKey of ATTR_KEYS) {
      skillsByAttr[aKey].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    }

    // Expanded attribute skills (for dropdown)
    const expandedSkills = expandedAttr && skillsByAttr[expandedAttr] ? skillsByAttr[expandedAttr] : null;

    // ALL equipped weapons (not just first)
    const weapons = (actor.items || []).filter(i => i.type === "weapon" && i.system.equipped).map(w => ({
      id: w.id, name: w.name,
      damage: w.system.damage || "Width Shock",
      pool: w.system.pool || ""
    }));

    // Equipped shields
    const shields = (actor.items || []).filter(i => i.type === "shield" && i.system.equipped).map(s => ({
      name: s.name,
      parryBonus: parseInt(s.system.parryBonus) || 0,
      size: s.system.shieldSize || "small"
    }));
    const totalShieldBonus = shields.reduce((sum, s) => sum + s.parryBonus, 0);

    // Armor by location (for hover tooltip)
    const effArmor = sys.effectiveArmor || {};
    const armorLocStr = ["head", "torso", "armR", "armL", "legR", "legL"]
      .map(k => {
        const ar = effArmor[k] || 0;
        const labels = { head: "Head", torso: "Torso", armR: "R.Arm", armL: "L.Arm", legR: "R.Leg", legL: "L.Leg" };
        return `${labels[k]}: AR${ar}`;
      }).join("  ·  ");

    // Armor weight
    const armors = (actor.items || []).filter(i => i.type === "armor" && i.system.equipped);
    const armorWeight = armors.length > 0 ? armors.reduce((w, a) => {
      const aw = a.system.armorWeight || a.system.derivedWeight || "light";
      return aw === "heavy" ? "heavy" : (aw === "medium" && w !== "heavy" ? "medium" : w);
    }, "light") : "none";

    // Techniques & Disciplines
    const techniques = (actor.items || []).filter(i => i.type === "technique").map(t => ({
      name: t.name, effect: t.system.effect || ""
    }));
    const disciplines = (actor.items || []).filter(i => i.type === "discipline").map(d => ({
      name: d.name, effect: d.system.effect || ""
    }));

    // Sorcery & Spells
    const sorceryVal = parseInt(sys.esoterica?.sorcery) || 0;
    const sorceryEd = !!sys.esoterica?.expert;
    const sorceryMd = !!sys.esoterica?.master;
    const spells = (actor.items || []).filter(i => i.type === "spell").map(s => ({
      name: s.name,
      intensity: parseInt(s.system.intensity) || 1,
      school: s.system.school || "",
      duration: s.system.duration || "",
      attReq: !!s.system.attunementRequired
    })).sort((a, b) => a.intensity - b.intensity);

    // Conditions
    const conditions = CONDITIONS.map(c => ({ ...c, active: statuses.has(c.id) }));

    // Combat pools
    let combatPools = null;
    if (inCombat) {
      const body = parseInt(sys.attributes?.body?.value) || 0;
      const coord = parseInt(sys.attributes?.coordination?.value) || 0;
      const fight = parseInt(sys.skills?.fight?.value) || 0;
      const dodge = parseInt(sys.skills?.dodge?.value) || 0;
      const parry = parseInt(sys.skills?.parry?.value) || 0;
      combatPools = {
        attack: body + fight, dodge: coord + dodge,
        parry: body + parry + totalShieldBonus,
        hasShield: shields.length > 0
      };
    }

    base.attrs = attrs;
    base.expandedAttr = expandedAttr;
    base.expandedSkills = expandedSkills;
    base.hasExpandedSkills = !!expandedSkills;
    base.weapons = weapons;
    base.hasWeapons = weapons.length > 0;
    base.shields = shields;
    base.hasShields = shields.length > 0;
    base.armorWeight = armorWeight;
    base.armorLocStr = armorLocStr;
    base.wealth = parseInt(sys.wealth?.value) || 0;
    base.techniques = techniques;
    base.hasTechniques = techniques.length > 0;
    base.disciplines = disciplines;
    base.hasDisciplines = disciplines.length > 0;
    base.sorceryVal = sorceryVal;
    base.sorceryEd = sorceryEd;
    base.sorceryMd = sorceryMd;
    base.hasSorcery = sorceryVal > 0 || spells.length > 0;
    base.spells = spells;
    base.hasSpells = spells.length > 0;
    base.showSpells = showSpells;
    base.conditions = conditions;
    base.combatPools = combatPools;
    base.hasCombatPools = !!combatPools;
  }

  // ── THREAT ──
  if (type === "threat") {
    const sys = actor.system;
    const isCreature = !!sys.creatureMode;
    const magVal = parseInt(sys.magnitude?.value) || 0;
    const magMax = parseInt(sys.magnitude?.max) || magVal;
    const morVal = parseInt(sys.morale?.value) || 0;
    const morMax = parseInt(sys.morale?.max) || morVal;

    base.isCreature = isCreature;
    base.magnitude = { value: magVal, max: magMax, pct: magMax > 0 ? Math.round((magVal / magMax) * 100) : 0 };
    base.morale = { value: morVal, max: morMax, pct: morMax > 0 ? Math.round((morVal / morMax) * 100) : 0 };
    base.threatRating = parseInt(sys.threatLevel) || 1;
    base.damageFormula = sys.damageFormula || "Width Shock";

    if (isCreature) {
      base.creatureLocs = (sys.customLocations || []).map(loc => {
        const max = loc.woundBoxes || 5;
        const killing = loc.killing || 0;
        const shock = loc.shock || 0;
        let state = "healthy";
        if (killing >= max) state = "critical";
        else if (killing > 0) state = "wounded";
        else if (shock > 0) state = "shocked";
        return { name: loc.name, state, shock, killing, max, ar: loc.ar || 0 };
      });
      base.creatureAttacks = (sys.creatureAttacks || []).map(atk => ({
        name: atk.name || "Attack",
        damage: atk.damage || "Width Shock",
        index: (sys.creatureAttacks || []).indexOf(atk)
      }));
    }
  }

  // ── COMPANY ──
  if (type === "company") {
    const sys = actor.system;
    const pledges = sys.pledges || {};
    base.qualities = QUALITY_KEYS.map(key => {
      const q = sys.qualities?.[key] || {};
      const val = parseInt(q.value) || 0;
      const dmg = parseInt(q.damage) || 0;
      const uses = parseInt(q.uses) || 0;
      const eff = Math.max(0, val - dmg - uses);
      return {
        key, label: QUALITY_LABELS[key], icon: QUALITY_ICONS[key],
        value: val, damage: dmg, uses, effective: eff,
        isDamaged: dmg > 0, isUsed: uses > 0
      };
    });
    base.pledges = {
      bonus: parseInt(pledges.bonus) || 0,
      ed: parseInt(pledges.ed) || 0,
      md: parseInt(pledges.md) || 0
    };
    base.hasPledges = (base.pledges.bonus + base.pledges.ed + base.pledges.md) > 0;
  }

  return base;
}


// ═════════════════════════════════════════════════════════════════════════════
//  GM TOOLBAR CLASS
// ═════════════════════════════════════════════════════════════════════════════

export class GMToolbar {

  // ─── State ──────────────────────────────────────────────────────────────

  /** @type {HTMLElement|null} */
  element = null;

  /** Currently open panel section. null = collapsed. */
  activeSection = null;

  /** Theater mode active. */
  theaterMode = false;

  /** Last Quick Roll configuration for Re-roll. */
  lastRoll = null;

  /** Which attribute's skills are expanded in Token Peek. null = collapsed. */
  peekExpandedAttr = null;

  /** Whether the spell list is expanded in Token Peek. */
  peekShowSpells = false;

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /** Create and inject the toolbar into the DOM. Called once from Hooks.once("ready"). */
  async init() {
    if (!game.user.isGM) return;
    if (document.getElementById(TOOLBAR_ID)) return; // Already injected

    // Pre-load the template
    await foundry.applications.handlebars.loadTemplates([TEMPLATE_PATH]);

    // Build initial HTML
    const html = await this._renderHTML();
    const container = document.createElement("div");
    container.id = TOOLBAR_ID;
    container.innerHTML = html;
    document.body.appendChild(container);
    this.element = container;

    this._bindEvents();
    this._registerHooks();

    console.log("Reign GM Toolbar | Initialised.");
  }

  // ─── Rendering ──────────────────────────────────────────────────────────

  async _renderHTML() {
    const data = this._prepareContext();
    return await renderTemplate(TEMPLATE_PATH, data);
  }

  _prepareContext() {
    const combat = _getCombatSummary();
    const tokenHint = _getTokenPoolHint();
    const vitals = _getPartyVitals();
    const peek = this.activeSection === "tokenpeek" ? _getTokenPeekData(this.peekExpandedAttr, this.peekShowSpells) : null;
    return {
      worldMonth: _getWorldMonth(),
      combat,
      hasCombat: !!combat,
      activeSection: this.activeSection,
      theaterMode: this.theaterMode,
      lastRoll: this.lastRoll,
      hasLastRoll: !!this.lastRoll,
      tokenHint,
      hasTokenHint: !!tokenHint,
      vitals,
      hasVitals: vitals.length > 0,
      peek,
      hasPeek: !!peek,
      // Quick Roll defaults
      qr: {
        label:   this.lastRoll?.label || "",
        pool:    tokenHint?.pool || this.lastRoll?.pool || 4,
        bonus:   0,
        penalty: 0,
        ed:      0,
        md:      false,
        difficulty: 0
      }
    };
  }

  /** Re-render the entire toolbar (cheap — it's a small template). */
  async refresh() {
    if (!this.element) return;
    const html = await this._renderHTML();
    this.element.innerHTML = html;
    this._bindEvents();
  }

  /** Re-render only the persistent bar (combat indicator, month). */
  async refreshBar() {
    if (!this.element) return;
    const barEl = this.element.querySelector(".gt-bar");
    if (!barEl) return this.refresh();
    // Lightweight: just update the dynamic badges
    const combat = _getCombatSummary();
    const combatEl = barEl.querySelector(".gt-combat-indicator");
    if (combatEl) {
      if (combat) {
        combatEl.classList.remove("gt-hidden");
        const phaseIcon = combat.isDeclaring ? "fa-eye" : "fa-bolt";
        const phaseLabel = combat.isDeclaring ? "Declare" : "Resolve";
        const declCount = combat.isDeclaring ? `${combat.declared}/${combat.total} ✓` : "";
        combatEl.innerHTML = `<i class="fas ${phaseIcon}"></i> R${combat.round} · ${phaseLabel} ${declCount}`;
      } else {
        combatEl.classList.add("gt-hidden");
        combatEl.innerHTML = "";
      }
    }
    // World month
    const monthEl = barEl.querySelector(".gt-month-value");
    if (monthEl) monthEl.textContent = _getWorldMonth();
  }

  // ─── Quick Roll Pool Preview ────────────────────────────────────────────

  _updatePoolPreview() {
    const panel = this.element?.querySelector(".gt-panel-quickroll");
    if (!panel) return;
    const preview = panel.querySelector(".gt-qr-preview-value");
    if (!preview) return;

    const poolSize = Math.max(1, parseInt(panel.querySelector('[name="qrPool"]')?.value) || 1);
    const bonus    = parseInt(panel.querySelector('[name="qrBonus"]')?.value) || 0;
    const penalty  = parseInt(panel.querySelector('[name="qrPenalty"]')?.value) || 0;
    const ed       = parseInt(panel.querySelector('[name="qrEd"]')?.value) || 0;
    const md       = panel.querySelector('[name="qrMd"]')?.checked ? 1 : 0;

    const rawTotal = poolSize + bonus;
    const poolMath = calculateOREPool(rawTotal, ed, md, 0, penalty, 1, true);

    if (poolMath.diceToRoll < 1) {
      preview.innerHTML = `<span class="gt-text-danger">Pool too low</span>`;
    } else {
      let display = `${poolMath.normalDiceCount}d10`;
      if (poolMath.actualEd > 0) display += ` + ED(${poolMath.finalEdFace})`;
      if (poolMath.actualMd > 0) display += ` + MD`;
      if (poolMath.wasCapped) display += ` <span class="gt-text-muted">(capped)</span>`;
      preview.innerHTML = display;
    }
  }

  // ─── Event Binding ──────────────────────────────────────────────────────

  _bindEvents() {
    if (!this.element) return;
    const el = this.element;

    // Section toggles
    el.querySelectorAll("[data-gt-action]").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = btn.dataset.gtAction;
        this._handleAction(action, btn);
      });
    });

    // Quick Roll inputs — live preview
    el.querySelectorAll(".gt-panel-quickroll input").forEach(input => {
      input.addEventListener("input", () => this._updatePoolPreview());
      input.addEventListener("change", () => this._updatePoolPreview());
    });

    // Initial pool preview
    if (this.activeSection === "quickroll") {
      this._updatePoolPreview();
    }

    // Vitals portraits — right-click opens sheet
    el.querySelectorAll(".gt-vitals-portrait").forEach(portrait => {
      portrait.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this._handleAction("vitals-open-sheet", portrait);
      });
    });
  }

  // ─── Action Router ──────────────────────────────────────────────────────

  async _handleAction(action, target) {
    switch (action) {

      // ── Section Toggles ──
      case "toggle-quickroll":
        this.activeSection = this.activeSection === "quickroll" ? null : "quickroll";
        await this.refresh();
        break;

      case "toggle-tokenpeek":
        this.activeSection = this.activeSection === "tokenpeek" ? null : "tokenpeek";
        await this.refresh();
        break;

      // ── Theater Mode ──
      case "theater-toggle":
        this.theaterMode = !this.theaterMode;
        document.body.classList.toggle("reign-theater-mode", this.theaterMode);
        target.classList.toggle("gt-active", this.theaterMode);
        break;

      // ── Shortcuts ──
      case "open-factions":
        new FactionDashboard().render(true);
        break;

      case "open-hazards":
        openHazardRoller();
        break;

      case "advance-month":
        await this._advanceMonth();
        break;

      case "retreat-month":
        await this._retreatMonth();
        break;

      case "open-combat-tracker":
        document.querySelector('#sidebar [data-tab="combat"]')?.click();
        break;

      // ── Quick Roll ──
      case "qr-roll":
        await this._executeQuickRoll();
        break;

      case "qr-reroll":
        await this._executeReroll();
        break;

      case "qr-populate-token":
        this._populateFromToken();
        break;

      // ── Party Vitals ──
      case "vitals-select":
        this._selectVitalsToken(target);
        break;

      case "vitals-open-sheet":
        this._openVitalsSheet(target);
        break;

      // ── Token Peek Actions ──
      case "peek-open-sheet":
        this._peekOpenSheet();
        break;

      case "peek-toggle-condition":
        await this._peekToggleCondition(target);
        break;

      case "peek-roll-character":
        await this._peekRollCharacter(target);
        break;

      case "peek-roll-threat":
        await this._peekRollThreat(target);
        break;

      case "peek-roll-morale":
        await this._peekRollMorale();
        break;

      case "peek-roll-quality":
        await this._peekRollQuality(target);
        break;

      case "peek-expand-attr":
        this._peekExpandAttr(target);
        break;

      case "peek-toggle-spells":
        this.peekShowSpells = !this.peekShowSpells;
        await this.refresh();
        break;

      case "peek-roll-skill":
        await this._peekRollSkill(target);
        break;

      case "peek-rest":
        await this._peekRest();
        break;

      case "peek-first-aid":
        await this._peekFirstAid();
        break;

      case "peek-wealth":
        await this._peekWealth();
        break;

      // ── Roll Requests & Contests ──
      case "request-roll":
        await this._openRequestRollDialog();
        break;
    }
  }

  // ─── Quick Roll Execution ───────────────────────────────────────────────

  async _executeQuickRoll() {
    const panel = this.element?.querySelector(".gt-panel-quickroll");
    if (!panel) return;

    const label    = panel.querySelector('[name="qrLabel"]')?.value?.trim() || game.i18n.localize("REIGN.QRDefaultLabel");
    const poolSize = Math.max(1, parseInt(panel.querySelector('[name="qrPool"]')?.value) || 1);
    const bonus    = parseInt(panel.querySelector('[name="qrBonus"]')?.value) || 0;
    const penalty  = parseInt(panel.querySelector('[name="qrPenalty"]')?.value) || 0;
    const ed       = parseInt(panel.querySelector('[name="qrEd"]')?.value) || 0;
    const md       = panel.querySelector('[name="qrMd"]')?.checked ? 1 : 0;
    const diff     = parseInt(panel.querySelector('[name="qrDiff"]')?.value) || 0;

    const rawTotal = poolSize + bonus;
    const poolMath = calculateOREPool(rawTotal, ed, md, 0, penalty, 1, true);

    if (poolMath.diceToRoll < 1) {
      return ui.notifications.warn(game.i18n.localize("REIGN.QRPoolTooLow"));
    }

    // Store for Re-roll
    this.lastRoll = { label, pool: poolSize, bonus, penalty, ed, md, diff };

    // Roll normal dice
    let results = [];
    let actualRoll = null;
    if (poolMath.normalDiceCount > 0) {
      actualRoll = new Roll(`${poolMath.normalDiceCount}d10`);
      await actualRoll.evaluate();
      results = actualRoll.dice[0]?.results.map(r => r.result) || [];
    }

    // Expert Die
    if (poolMath.actualEd > 0) results.push(poolMath.finalEdFace);

    // Master Die — prompt for assignment
    if (poolMath.actualMd > 0) {
      results.sort((a, b) => b - a);
      const mdHtml = `<form class="reign-dialog-form">
        <p class="reign-text-large reign-mb-small reign-mt-0"><strong>Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
        <p class="reign-text-small reign-text-muted reign-mb-medium">Assign the Master Die a face value (1–10).</p>
        <div class="form-group"><label>MD Face:</label><input type="number" id="qrMdFace" value="10" min="1" max="10"/></div>
      </form>`;
      const mdResult = await reignDialog(
        game.i18n.localize("REIGN.AssignMasterDice"),
        mdHtml,
        (e, b, d) => parseInt(d.element.querySelector("#qrMdFace").value) || 10,
        { defaultLabel: game.i18n.localize("REIGN.QRFinalize"), width: 360 }
      );
      if (!mdResult) return;
      results.push(mdResult);
    }

    // Speaker
    const speakerActor = canvas?.tokens?.controlled?.[0]?.actor || game.user.character || null;
    const speaker = speakerActor
      ? ChatMessage.getSpeaker({ actor: speakerActor })
      : ChatMessage.getSpeaker({ user: game.user });

    // Chat card
    const actorType = speakerActor?.type || "character";
    const flavor = await generateOREChatHTML(
      actorType,
      foundry.utils.escapeHTML(label),
      poolMath.diceToRoll,
      results,
      poolMath.actualEd > 0 ? poolMath.finalEdFace : 0,
      poolMath.actualMd,
      null,
      { difficulty: diff }
    );

    const messageData = { speaker, content: flavor };
    if (actualRoll) messageData.rolls = [actualRoll];
    await ChatMessage.create(messageData);

    // Refresh to show Re-roll button
    await this.refresh();
  }

  async _executeReroll() {
    if (!this.lastRoll) return;
    const lr = this.lastRoll;

    // Populate inputs with last roll values and execute
    const panel = this.element?.querySelector(".gt-panel-quickroll");
    if (panel) {
      const setVal = (name, val) => { const el = panel.querySelector(`[name="${name}"]`); if (el) el.value = val; };
      const setChecked = (name, val) => { const el = panel.querySelector(`[name="${name}"]`); if (el) el.checked = val; };
      setVal("qrLabel", lr.label);
      setVal("qrPool", lr.pool);
      setVal("qrBonus", lr.bonus);
      setVal("qrPenalty", lr.penalty);
      setVal("qrEd", lr.ed);
      setChecked("qrMd", lr.md);
      setVal("qrDiff", lr.diff);
    }
    await this._executeQuickRoll();
  }

  _populateFromToken() {
    const hint = _getTokenPoolHint();
    if (!hint) return ui.notifications.info("Select a token to pre-populate the pool.");
    const panel = this.element?.querySelector(".gt-panel-quickroll");
    if (!panel) return;
    const poolInput = panel.querySelector('[name="qrPool"]');
    const labelInput = panel.querySelector('[name="qrLabel"]');
    if (poolInput) poolInput.value = hint.pool;
    if (labelInput) labelInput.value = hint.label;
    this._updatePoolPreview();
  }

  // ─── Party Vitals Actions ──────────────────────────────────────────────

  /** Click portrait: select and pan to the PC's token on canvas. */
  _selectVitalsToken(target) {
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!actorId) return;
    const token = canvas?.tokens?.placeables.find(t => t.actor?.id === actorId);
    if (token) {
      token.control({ releaseOthers: true });
      canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    } else {
      // No token on canvas — open sheet instead
      game.actors.get(actorId)?.sheet?.render(true);
    }
  }

  /** Right-click / double-click portrait: open the character sheet. */
  _openVitalsSheet(target) {
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!actorId) return;
    game.actors.get(actorId)?.sheet?.render(true);
  }

  // ─── Token Peek Actions ─────────────────────────────────────────────────

  /** Get the actor from the currently selected token (used by all peek actions). */
  _peekActor() {
    return canvas?.tokens?.controlled?.[0]?.actor || null;
  }

  _peekOpenSheet() {
    this._peekActor()?.sheet?.render(true);
  }

  async _peekToggleCondition(target) {
    const actor = this._peekActor();
    const condId = target.dataset.conditionId;
    if (!actor || !condId) return;
    await actor.toggleStatusEffect(condId);
  }

  async _peekRollCharacter(target) {
    const actor = this._peekActor();
    if (!actor || actor.type !== "character") return;
    const rollType = target.dataset.rollType; // "attack", "dodge", "parry", or a skill key
    const dataset = {};

    if (rollType === "attack") {
      // Roll with best equipped weapon
      const weapon = (actor.items || []).find(i => i.type === "weapon" && i.system.equipped);
      if (weapon) {
        dataset.type = "item";
        dataset.itemId = weapon.id;
      } else {
        dataset.type = "skill";
        dataset.key = "fight";
      }
    } else if (rollType === "dodge") {
      dataset.type = "skill";
      dataset.key = "dodge";
    } else if (rollType === "parry") {
      dataset.type = "skill";
      dataset.key = "parry";
    } else {
      dataset.type = "skill";
      dataset.key = rollType || "fight";
    }

    await CharacterRoller.rollCharacter(actor, dataset);
  }

  /** Click an attribute label → expand/collapse its skills dropdown. */
  _peekExpandAttr(target) {
    const attrKey = target.dataset.attrKey;
    this.peekExpandedAttr = this.peekExpandedAttr === attrKey ? null : attrKey;
    this.refresh();
  }

  /** Click a skill in the dropdown → roll it via CharacterRoller. */
  async _peekRollSkill(target) {
    const actor = this._peekActor();
    if (!actor || actor.type !== "character") return;
    const skillKey = target.dataset.skillKey;
    if (!skillKey) return;
    const dataset = { type: "skill", key: skillKey };
    await CharacterRoller.rollCharacter(actor, dataset);
  }

  async _peekRollThreat(target) {
    const actor = this._peekActor();
    if (!actor || actor.type !== "threat") return;
    await ThreatRoller.rollThreat(actor, {});
  }

  async _peekRollMorale() {
    const actor = this._peekActor();
    if (!actor || actor.type !== "threat") return;
    await ThreatRoller.rollMorale(actor);
  }

  async _peekRollQuality(target) {
    const actor = this._peekActor();
    if (!actor || actor.type !== "company") return;
    const qualityKey = target.dataset.quality;
    if (!qualityKey) return;

    const q = actor.system.qualities?.[qualityKey];
    const pool = Math.max(0, (q?.value || 0) - (q?.damage || 0) - (q?.uses || 0));
    const qLabel = QUALITY_LABELS[qualityKey];

    if (pool < 1) return ui.notifications.warn(`${actor.name}'s ${qLabel} has no effective dice.`);

    const roll = new Roll(`${pool}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];

    const breakdown = [{ label: qLabel, value: `${q.value}`, isPenalty: false }];
    if (q.damage > 0) breakdown.push({ label: "Damage", value: `−${q.damage}`, isPenalty: true });
    if (q.uses > 0) breakdown.push({ label: "Actions Used", value: `−${q.uses}`, isPenalty: true });

    await postOREChat(actor, `${qLabel} (${actor.name})`, pool, results, 0, 0, null, {
      poolBreakdown: breakdown
    });
  }

  // ─── Character Utility Actions ──────────────────────────────────────────

  /** Rest & Recover — delegates to the character sheet's dialog workflow. */
  async _peekRest() {
    const actor = this._peekActor();
    if (!actor || actor.type !== "character") return;
    // The sheet's _onRestAndRecover method handles all dialogs, rolls, and chat output.
    // It only uses this.document internally, so calling it on the sheet instance works
    // even if the sheet isn't rendered.
    const sheet = actor.sheet;
    await sheet._onRestAndRecover({ preventDefault: () => {} }, null);
  }

  /** First Aid — opens the Knowledge + Healing roll dialog via CharacterRoller,
   *  which properly handles ED/MD assignment. The resulting chat card has the
   *  "Apply First Aid" button for applying healing to a targeted token. */
  async _peekFirstAid() {
    const actor = this._peekActor();
    if (!actor || actor.type !== "character") return;
    await CharacterRoller.rollCharacter(actor, { key: "healing", type: "skill", label: "Healing (First Aid)" });
  }

  /** Wealth Check — opens the purchase dialog for the selected character. */
  async _peekWealth() {
    const actor = this._peekActor();
    if (!actor || actor.type !== "character") return;
    await WealthRoller.rollWealthPurchase(actor);
  }

  // ─── Roll Requests & Contests ───────────────────────────────────────────

  async _openRequestRollDialog() {
    // Gather participants from selected tokens, vitals PCs, or all characters
    const selected = canvas?.tokens?.controlled?.map(t => t.actor).filter(a => a?.type === "character") || [];
    let participants = selected.length > 0 ? selected : game.actors.filter(a => a.type === "character");

    if (participants.length === 0) return ui.notifications.warn("No characters available for a roll request.");

    // Build skill dropdown from skillAttrMap
    const skillOpts = Object.entries(skillAttrMap)
      .map(([sk, attr]) => {
        const sLabel = sk.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const aLabel = attr.charAt(0).toUpperCase() + attr.slice(1);
        return `<option value="${sk}" data-attr="${attr}">${sLabel} (${aLabel})</option>`;
      })
      .sort()
      .join("");

    // Build participant checkboxes
    const partChecks = participants.map(a => {
      const checked = selected.length > 0 ? selected.some(s => s.id === a.id) : true;
      return `<label class="gt-rr-part"><input type="checkbox" name="part_${a.id}" value="${a.id}" ${checked ? "checked" : ""}/> ${foundry.utils.escapeHTML(a.name)}</label>`;
    }).join("");

    const content = `
      <form class="reign-dialog-form">
        <div class="form-group">
          <label>Participants:</label>
          <div class="gt-rr-participants">${partChecks}</div>
        </div>
        <div class="form-group">
          <label>Skill:</label>
          <select name="skill">${skillOpts}</select>
        </div>
        <div class="dialog-grid dialog-grid-2">
          <div class="form-group">
            <label>Difficulty:</label>
            <input type="number" name="difficulty" value="0" min="0" max="10"/>
          </div>
          <div class="form-group">
            <label>Penalty:</label>
            <input type="number" name="penalty" value="0" min="0"/>
          </div>
        </div>
        <div class="form-group">
          <label>Mode:</label>
          <select name="mode">
            <option value="simple">Simple Request</option>
            <option value="dynamic">Dynamic Contest (compare results)</option>
            <option value="opposed">Opposed Contest (gobble dice)</option>
          </select>
        </div>
        <div class="form-group" id="rr-resolver-group" style="display:none">
          <label>Winner determined by:</label>
          <select name="resolver">
            <option value="width">Width (speed / power)</option>
            <option value="height">Height (precision / fortune)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Context (optional):</label>
          <input type="text" name="context" placeholder="e.g. climbing the wall, footrace"/>
        </div>
      </form>
    `;

    const result = await reignDialog("Request Roll", content, (e, b, d) => {
      const f = d.element.querySelector("form");
      const skillSelect = f.querySelector('[name="skill"]');
      const selectedOpt = skillSelect.options[skillSelect.selectedIndex];
      const checkedParts = [...f.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
      return {
        actorIds: checkedParts,
        skill: skillSelect.value,
        attr: selectedOpt.dataset.attr,
        difficulty: parseInt(f.querySelector('[name="difficulty"]').value) || 0,
        penalty: parseInt(f.querySelector('[name="penalty"]').value) || 0,
        mode: f.querySelector('[name="mode"]').value,
        resolver: f.querySelector('[name="resolver"]').value,
        context: f.querySelector('[name="context"]').value.trim()
      };
    }, {
      defaultLabel: "Send Request",
      width: 420,
      render: (event) => {
        const el = event?.target?.element;
        if (!el) return;
        const modeSelect = el.querySelector('[name="mode"]');
        const resolverGroup = el.querySelector("#rr-resolver-group");
        if (modeSelect && resolverGroup) {
          const toggle = () => { resolverGroup.style.display = modeSelect.value === "dynamic" ? "" : "none"; };
          modeSelect.addEventListener("change", toggle);
          toggle();
        }
      }
    });

    if (!result || result.actorIds.length === 0) return;

    await this._postRollRequests(result);
  }

  async _postRollRequests(config) {
    const { actorIds, skill, attr, difficulty, penalty, mode, resolver, context } = config;
    const contestId = mode !== "simple" ? foundry.utils.randomID() : null;
    const skillLabel = skill.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const attrLabel = attr.charAt(0).toUpperCase() + attr.slice(1);
    const poolLabel = `${attrLabel} + ${skillLabel}`;

    // Mode labels
    const modeLabels = { simple: "Roll Request", dynamic: "Dynamic Contest", opposed: "Opposed Contest" };
    const modeLabel = modeLabels[mode] || "Roll Request";

    // Context line
    const contextLine = context ? `<p class="reign-text-muted reign-text-sm"><em>${foundry.utils.escapeHTML(context)}</em></p>` : "";

    // Difficulty/penalty description
    const modLines = [];
    if (difficulty > 0) modLines.push(`Difficulty ${difficulty}`);
    if (penalty > 0) modLines.push(`−${penalty}d penalty`);
    const modStr = modLines.length > 0 ? modLines.join(" · ") : "No modifiers";

    // For opposed: first actor is active, rest are blockers
    for (let i = 0; i < actorIds.length; i++) {
      const actorId = actorIds[i];
      const actor = game.actors.get(actorId);
      if (!actor) continue;

      const role = mode === "opposed" ? (i === 0 ? "active" : "blocker") : null;
      const roleLabel = role === "active" ? " (Active)" : role === "blocker" ? " (Blocker)" : "";
      const resolverNote = mode === "dynamic" ? `<p class="reign-text-sm"><i class="fas fa-balance-scale"></i> ${resolver === "width" ? "Width" : "Height"} determines the winner.</p>` : "";

      const cardHtml = `
        <div class="reign-chat-card reign-roll-request">
          <h3 class="reign-roll-request-title"><i class="fas fa-bullhorn"></i> ${modeLabel}</h3>
          ${contextLine}
          <p><strong>${foundry.utils.escapeHTML(actor.name)}${roleLabel}</strong> — roll <strong>${poolLabel}</strong></p>
          <p class="reign-text-sm">${modStr}</p>
          ${resolverNote}
          <button class="reign-btn-primary fulfil-request-btn"
                  data-actor-id="${actorId}"
                  data-attr="${attr}"
                  data-skill="${skill}"
                  data-difficulty="${difficulty}"
                  data-penalty="${penalty}"
                  data-contest-id="${contestId || ""}"
                  data-contest-type="${mode}"
                  data-contest-role="${role || ""}"
                  data-resolver="${resolver}"
                  data-pool-label="${poolLabel}"
                  data-contest-total="${actorIds.length}">
            <i class="fas fa-dice-d20"></i> Fulfil — Roll Now
          </button>
        </div>
      `;

      await ChatMessage.create({
        speaker: { alias: "GM" },
        content: cardHtml,
        flags: {
          reign: {
            rollRequest: {
              actorId, attr, skill, difficulty, penalty,
              contestId, contestType: mode, contestRole: role, resolver,
              fulfilled: false, poolLabel
            }
          }
        }
      });
    }

    if (contestId) {
      ui.notifications.info(`${modeLabel} posted for ${actorIds.length} participant(s).`);
    }
  }

  // ─── World Month Management ──────────────────────────────────────────

  /**
   * Advance month — delegates to FactionDashboard._onAdvanceMonth so the
   * full RAW logic runs: heal 1 damage per quality, reset action uses,
   * chronicle entries, chat delta report, and journal export.
   */
  async _advanceMonth() {
    const dashboard = new FactionDashboard();
    // _onAdvanceMonth expects an event with preventDefault; the target is unused.
    await dashboard._onAdvanceMonth({ preventDefault: () => {} }, null);
    await this.refresh();
  }

  /**
   * Retreat month — GM correction tool. Decrements the world month by
   * rewriting the most recent "advance" chronicle entry on each company.
   * Does NOT undo healing or action economy changes (those are irreversible).
   */
  async _retreatMonth() {
    const currentMonth = _getWorldMonth();
    if (currentMonth <= 1) return ui.notifications.warn("Cannot retreat below Month 1.");

    const confirm = await foundry.applications.api.DialogV2.confirm({
      classes: ["reign-dialog-window"],
      window: { title: "Retreat Month" },
      position: { height: "auto" },
      content: `<div class="reign-dialog-form">
        <p>Retreat the world clock from <strong>Month ${currentMonth}</strong> back to <strong>Month ${currentMonth - 1}</strong>?</p>
        <p class="reign-text-small reign-text-muted">This removes the latest advance chronicle entry from each company.
           It does <strong>not</strong> undo healing or action economy changes.</p>
      </div>`,
      rejectClose: false
    });
    if (!confirm) return;

    const companies = game.actors.filter(a => a.type === "company");
    for (const company of companies) {
      const chronicle = foundry.utils.deepClone(company.system.chronicle || []);
      // Find and remove the most recent "advance" entry at the current month
      const idx = chronicle.findLastIndex(e => e.type === "advance" && e.month === currentMonth);
      if (idx !== -1) {
        chronicle.splice(idx, 1);
        await company.update({ "system.chronicle": chronicle });
      }
    }

    ui.notifications.info(`World retreated to Month ${currentMonth - 1}.`);
    FactionDashboard.syncAll();
    await this.refresh();
  }

  // ─── Theater Mode ───────────────────────────────────────────────────────

  exitTheaterMode() {
    if (!this.theaterMode) return;
    this.theaterMode = false;
    document.body.classList.remove("reign-theater-mode");
    const btn = this.element?.querySelector('[data-gt-action="theater-toggle"]');
    if (btn) btn.classList.remove("gt-active");
  }

  // ─── Hook Registration ──────────────────────────────────────────────────

  _registerHooks() {
    // Combat changes → full refresh (updates bar + vitals combat badges)
    Hooks.on("updateCombat", () => this.refresh());
    Hooks.on("deleteCombat", () => this.refresh());
    Hooks.on("createCombat", () => this.refresh());
    Hooks.on("combatStart", () => this.refresh());

    // Combatant declaration flags → full refresh (updates vitals badges)
    Hooks.on("updateCombatant", () => this.refresh());

    // Token selection → refresh if quickroll or tokenpeek is open
    Hooks.on("controlToken", () => {
      if (this.activeSection === "tokenpeek") {
        this.peekExpandedAttr = null; // Reset dropdowns on token change
        this.peekShowSpells = false;
      }
      if (this.activeSection === "quickroll" || this.activeSection === "tokenpeek") this.refresh();
    });

    // Actor updates → refresh for companies (month), characters (vitals), threats (vitals)
    Hooks.on("updateActor", (actor) => {
      if (actor.type === "company" || actor.type === "character" || actor.type === "threat") this.refresh();
    });

    // Actor created or deleted → refresh vitals strip
    Hooks.on("createActor", (actor) => {
      if (actor.type === "character") this.refresh();
    });
    Hooks.on("deleteActor", (actor) => {
      if (actor.type === "character" || actor.type === "threat") this.refresh();
    });

    // Token placed or removed from canvas → refresh vitals (threats appear/disappear)
    Hooks.on("createToken", () => this.refresh());
    Hooks.on("deleteToken", () => this.refresh());

    // Scene change → refresh vitals (different tokens on different scenes)
    Hooks.on("canvasReady", () => this.refresh());

    // Contest resolution — watch for fulfilled roll results tagged with a contestId
    Hooks.on("createChatMessage", (msg) => {
      const contestId = msg.flags?.reign?.contestId;
      if (!contestId) return;
      // Defer to allow the message to fully render
      setTimeout(() => this._checkContestResolution(contestId), 200);
    });

    // Escape key exits theater mode
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.theaterMode) {
        ev.preventDefault();
        this.exitTheaterMode();
      }
    });
  }

  // ─── Contest Resolution ─────────────────────────────────────────────────

  async _checkContestResolution(contestId) {
    // Find all request messages for this contest
    const requestMsgs = game.messages.filter(m =>
      m.flags?.reign?.rollRequest?.contestId === contestId
    );
    if (requestMsgs.length === 0) return;

    const total = requestMsgs.length;
    const fulfilled = requestMsgs.filter(m => m.flags?.reign?.rollRequest?.fulfilled);
    if (fulfilled.length < total) return; // Still waiting for rolls

    // All rolls are in — resolve
    const contestType = requestMsgs[0].flags.reign.rollRequest.contestType;
    const resolver = requestMsgs[0].flags.reign.rollRequest.resolver || "width";

    // Gather results: find each participant's roll result message
    const results = [];
    for (const req of requestMsgs) {
      const rr = req.flags.reign.rollRequest;
      const resultMsgId = rr.rollMessageId;
      const resultMsg = resultMsgId ? game.messages.get(resultMsgId) : null;
      const rollFlags = resultMsg?.flags?.reign;
      const parsed = rollFlags?.results ? parseORE(rollFlags.results) : null;
      const bestSet = parsed?.sets?.[0] || null;
      const actor = game.actors.get(rr.actorId);

      results.push({
        name: actor?.name || "Unknown",
        role: rr.contestRole,
        bestSet,
        width: bestSet?.width || 0,
        height: bestSet?.height || 0,
        text: bestSet?.text || "No sets",
        hasSets: !!bestSet
      });
    }

    if (contestType === "dynamic") {
      await this._resolveDynamic(contestId, results, resolver);
    } else if (contestType === "opposed") {
      await this._resolveOpposed(contestId, results);
    }
  }

  async _resolveDynamic(contestId, results, resolver) {
    // Sort by the resolver metric
    const key = resolver === "width" ? "width" : "height";
    const sorted = [...results].sort((a, b) => b[key] - a[key]);
    const winner = sorted[0];
    const resolverLabel = resolver === "width" ? "Width" : "Height";

    let rows = sorted.map((r, i) => {
      const crown = i === 0 ? `<strong class="reign-text-success">★ Winner</strong>` : "";
      return `<div class="gt-contest-row">${crown} <strong>${foundry.utils.escapeHTML(r.name)}</strong>: ${r.text} (${resolverLabel} ${r[key]})</div>`;
    }).join("");

    if (!winner.hasSets && sorted.every(r => !r.hasSets)) {
      rows += `<p class="reign-text-muted">No participant rolled a set — contest is a draw.</p>`;
    }

    await ChatMessage.create({
      speaker: { alias: "Contest Resolution" },
      content: `<div class="reign-chat-card reign-contest-resolution">
        <h3 class="reign-msg-success"><i class="fas fa-trophy"></i> Dynamic Contest — Resolved</h3>
        <p class="reign-text-sm"><strong>${resolverLabel}</strong> determines the winner.</p>
        <div class="gt-contest-results">${rows}</div>
      </div>`
    });
  }

  async _resolveOpposed(contestId, results) {
    const active = results.find(r => r.role === "active");
    const blocker = results.find(r => r.role === "blocker");
    if (!active || !blocker) return;

    let outcome;
    if (!active.hasSets) {
      outcome = `<p class="reign-text-danger"><strong>${foundry.utils.escapeHTML(active.name)}</strong> failed to roll a set — action fails regardless of defense.</p>`;
    } else if (!blocker.hasSets) {
      outcome = `<p class="reign-text-success"><strong>${foundry.utils.escapeHTML(active.name)}</strong> succeeds unopposed — ${foundry.utils.escapeHTML(blocker.name)} rolled no sets.</p>`;
    } else {
      // Gobble logic: blocker's dice become Gobble Dice
      // Each Gobble Die (at the blocker's set Height) can remove one die from the active set
      // if the Gobble Die's face >= the active die's face (i.e. blocker Height >= active Height)
      const canGobble = blocker.height >= active.height;
      const gobbleWidth = Math.min(blocker.width, active.width);

      if (canGobble) {
        const remainingWidth = active.width - gobbleWidth;
        if (remainingWidth < 2) {
          outcome = `<p class="reign-text-danger"><strong>${foundry.utils.escapeHTML(blocker.name)}</strong>'s ${blocker.text} gobbles ${foundry.utils.escapeHTML(active.name)}'s ${active.text} — action <strong>blocked</strong>!</p>`;
        } else {
          outcome = `<p class="reign-text-success"><strong>${foundry.utils.escapeHTML(active.name)}</strong>'s ${active.text} partially gobbled (−${gobbleWidth}d) but still succeeds at Width ${remainingWidth}.</p>`;
        }
      } else {
        // Blocker's Height is too low — Gobble Dice can't reach
        outcome = `<p class="reign-text-success"><strong>${foundry.utils.escapeHTML(blocker.name)}</strong>'s ${blocker.text} is too slow (Height ${blocker.height}) to gobble ${foundry.utils.escapeHTML(active.name)}'s ${active.text} (Height ${active.height}). Action <strong>succeeds</strong>.</p>`;
      }
    }

    await ChatMessage.create({
      speaker: { alias: "Contest Resolution" },
      content: `<div class="reign-chat-card reign-contest-resolution">
        <h3 class="reign-msg-info"><i class="fas fa-gavel"></i> Opposed Contest — Resolved</h3>
        <div class="gt-contest-results">
          <div class="gt-contest-row"><strong>${foundry.utils.escapeHTML(active.name)}</strong> (Active): ${active.text}</div>
          <div class="gt-contest-row"><strong>${foundry.utils.escapeHTML(blocker.name)}</strong> (Blocker): ${blocker.text}</div>
        </div>
        ${outcome}
      </div>`
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORTED: Fulfil Roll Request — called from reign.mjs renderChatMessageHTML
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Executes a roll for a fulfilled request. Uses the actor's actual stats,
 * enforces the GM's difficulty/penalty, and handles ED/MD per RAW.
 * @param {ChatMessage} requestMsg - The request chat message containing the flags.
 */
export async function fulfillRollRequest(requestMsg) {
  const rr = requestMsg.flags?.reign?.rollRequest;
  if (!rr) return;

  const actor = game.actors.get(rr.actorId);
  if (!actor) return ui.notifications.warn("Actor not found.");
  if (!actor.isOwner && !game.user.isGM) return ui.notifications.warn("Only the character's owner can fulfil this request.");

  const sys = actor.system;
  const attrVal = parseInt(sys.attributes?.[rr.attr]?.value) || 0;
  const skillVal = parseInt(sys.skills?.[rr.skill]?.value) || 0;
  const hasEd = !!sys.skills?.[rr.skill]?.expert;
  const hasMd = !!sys.skills?.[rr.skill]?.master;
  const difficulty = parseInt(rr.difficulty) || 0;
  const penalty = parseInt(rr.penalty) || 0;

  let pool = attrVal + skillVal - penalty;
  if (pool < 1 && !hasEd && !hasMd) return ui.notifications.warn("Pool too low to roll.");

  // Expert Die: RAW — choose face BEFORE rolling
  let edFace = 0;
  if (hasEd) {
    const edResult = await reignDialog(
      "Set Expert Die",
      `<form class="reign-dialog-form">
        <p class="reign-text-sm reign-text-muted reign-mb-medium">Choose the Expert Die face <strong>before</strong> rolling ${rr.poolLabel}.</p>
        <div class="form-group"><label>ED Face (1–10):</label><input type="number" id="rrEdFace" value="10" min="1" max="10"/></div>
      </form>`,
      (e, b, d) => parseInt(d.element.querySelector("#rrEdFace").value) || 10,
      { defaultLabel: "Confirm", width: 360 }
    );
    if (!edResult) return;
    edFace = edResult;
    pool -= 1; // ED takes one slot from the pool
  }

  // Roll normal dice
  const normalDice = Math.max(0, Math.min(10, pool));
  let results = [];
  let rollInstance = null;
  if (normalDice > 0) {
    rollInstance = new Roll(`${normalDice}d10`);
    await rollInstance.evaluate();
    results = rollInstance.dice[0]?.results.map(r => r.result) || [];
  }

  // Append ED
  if (hasEd) results.push(edFace);

  // Master Die: RAW — choose face AFTER rolling
  if (hasMd) {
    const sortedDisplay = [...results].sort((a, b) => b - a).join(", ") || "(none)";
    const mdResult = await reignDialog(
      "Assign Master Die",
      `<form class="reign-dialog-form">
        <p class="reign-text-large reign-mb-small"><strong>Roll so far:</strong> ${sortedDisplay}</p>
        <p class="reign-text-sm reign-text-muted reign-mb-medium">Assign the Master Die to form the best set.</p>
        <div class="form-group"><label>MD Face:</label><input type="number" id="rrMdFace" value="10" min="1" max="10"/></div>
      </form>`,
      (e, b, d) => parseInt(d.element.querySelector("#rrMdFace").value) || 10,
      { defaultLabel: "Confirm", width: 360 }
    );
    if (!mdResult) return;
    results.push(mdResult);
  }

  // Post the roll result via the standard ORE chat card
  const totalPool = results.length;
  const flavor = await generateOREChatHTML(
    "character",
    foundry.utils.escapeHTML(rr.poolLabel),
    totalPool, results,
    hasEd ? edFace : 0,
    hasMd ? 1 : 0,
    null,
    { difficulty }
  );

  const contestFlags = rr.contestId ? { contestId: rr.contestId, contestActorId: rr.actorId } : {};

  const resultMsg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: flavor,
    rolls: rollInstance ? [rollInstance] : [],
    flags: { reign: { ...contestFlags, results, label: rr.poolLabel, totalPool } }
  });

  // Mark the request as fulfilled
  await requestMsg.update({
    "flags.reign.rollRequest.fulfilled": true,
    "flags.reign.rollRequest.rollMessageId": resultMsg?.id || null
  });

  // Update the request card content to show "Fulfilled"
  const updatedContent = requestMsg.content.replace(
    /<button class="reign-btn-primary fulfil-request-btn"[^]*?<\/button>/,
    `<div class="reign-roll-fulfilled"><i class="fas fa-check-circle"></i> Fulfilled by ${foundry.utils.escapeHTML(actor.name)}</div>`
  );
  await requestMsg.update({ content: updatedContent });
}