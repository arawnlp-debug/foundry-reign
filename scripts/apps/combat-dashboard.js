// scripts/apps/combat-dashboard.js
// ════════════════════════════════════════════════════════════════════════════
//  REIGN ORE COMBAT DASHBOARD — Phase 2: Flag-Backed Display Layer
//  ApplicationV2 window showing the Declaration roster and Resolution
//  speed ladder. Roll data is read from Combat document flags
//  (written by combat-flags.js) for a single canonical data source.
//
//  Architecture:
//    - Singleton pattern: one instance stored on game.reign.dashboard
//    - Auto-shows when combat starts, closes when combat ends
//    - Hooks into updateCombat, updateCombatant, createChatMessage
//    - Per-user collapse state stored on game.user flags
// ════════════════════════════════════════════════════════════════════════════

import { parseORE, getHitLocation, getHitLocationLabel, parseDamageFormula, computeLocationDamage } from "../helpers/ore-engine.js";
import { HIT_LOCATIONS, HIT_LOCATION_LABELS } from "../helpers/config.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";
import { getAllRollData, getSpotlight, advanceSpotlight, validateGobble, requestGobble, resolveCurrentSet, requestSpoil } from "../combat/combat-flags.js";
import { applyDamageToTarget } from "../combat/damage.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

// ─── Constants ───────────────────────────────────────────────────────────────

const TEMPLATE_PATH = "systems/reign/templates/apps/combat-dashboard.hbs";

/** Decode the Width×100 + Height initiative encoding. */
function decodeInitiative(initValue) {
  if (!Number.isNumeric(initValue) || initValue <= 0) return null;
  const rawBase = Math.floor(initValue);
  const width = Math.floor(rawBase / 100);
  const height = rawBase % 100;
  if (width < 1 || height < 1 || height > 10) return null;
  return { width, height };
}

/** Tier label and CSS class from Width value. */
function tierMeta(width) {
  if (width >= 5) return { cls: "w5", label: `Width ${width} — Fastest`, pips: width };
  if (width === 4) return { cls: "w4", label: "Width 4", pips: 4 };
  if (width === 3) return { cls: "w3", label: "Width 3", pips: 3 };
  if (width === 2) return { cls: "w2", label: "Width 2", pips: 2 };
  return { cls: "w1", label: "Width 1 — Slowest", pips: 1 };
}

/** Hit location zone CSS class for colouring. */
function zoneClass(locKey) {
  const map = { head: "hz-head", torso: "hz-torso", armR: "hz-arm", armL: "hz-arm", legR: "hz-leg", legL: "hz-leg" };
  return map[locKey] || "";
}

/** Short hit location label without die-face range. */
function shortLocLabel(locKey) {
  const map = { head: "Head", torso: "Torso", armR: "R. Arm", armL: "L. Arm", legR: "R. Leg", legL: "L. Leg" };
  return map[locKey] || "Unknown";
}

// ─── Dashboard Class ─────────────────────────────────────────────────────────

export class CombatDashboard extends ScrollPreserveMixin(HandlebarsApplicationMixin(ApplicationV2)) {

  /** Track whether the dashboard was manually closed by the user this combat. */
  _userDismissed = false;

  static DEFAULT_OPTIONS = {
    id: "reign-combat-dashboard",
    classes: ["reign", "combat-dashboard", "app-v2"],
    tag: "div",
    window: {
      title: "⚔ Combat Dashboard",
      icon: "fas fa-swords",
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 880,
      height: "auto",
    },
    actions: {
      panToToken:        CombatDashboard.prototype._onPanToToken,
      openSheet:         CombatDashboard.prototype._onOpenSheet,
      toggleCollapse:    CombatDashboard.prototype._onToggleCollapse,
      advanceSpotlight:  CombatDashboard.prototype._onAdvanceSpotlight,
      applyGobble:       CombatDashboard.prototype._onApplyGobble,
      resolveSet:        CombatDashboard.prototype._onResolveSet,
      spoilSet:          CombatDashboard.prototype._onSpoilSet,
      declareToggle:     CombatDashboard.prototype._onDeclareToggle,
      openDeclareDialog: CombatDashboard.prototype._onOpenDeclareDialog,
      nextRound:         CombatDashboard.prototype._onNextRound,
    }
  };

  static PARTS = {
    main: { template: TEMPLATE_PATH }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Register hooks on first render. */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this._registerHooks();
  }

  /** Clean up hooks on close. */
  close(options = {}) {
    this._userDismissed = true;
    this._unregisterHooks();
    return super.close(options);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HOOKS
  // ═══════════════════════════════════════════════════════════════════════════

  _hookIds = [];

  _registerHooks() {
    const refresh = foundry.utils.debounce(() => {
      if (this.rendered) this.render(false);
    }, 100);

    this._hookIds.push(Hooks.on("updateCombat", refresh));
    this._hookIds.push(Hooks.on("updateCombatant", refresh));
    this._hookIds.push(Hooks.on("createChatMessage", refresh));
    this._hookIds.push(Hooks.on("deleteCombat", () => this.close()));
    this._hookIds.push(Hooks.on("targetToken", refresh));
    this._hookIds.push(Hooks.on("updateActor", (actor) => {
      if (actor.type === "character" || actor.type === "threat") refresh();
    }));
  }

  _unregisterHooks() {
    for (const id of this._hookIds) Hooks.off(id);
    this._hookIds = [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════════════════════

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const combat = game.combat;

    context.isGM = game.user.isGM;
    context.hasCombat = !!combat?.started;
    context.collapsed = !!game.user.getFlag("reign", "dashboardCollapsed");

    if (!context.hasCombat) {
      context.phase = null;
      return context;
    }

    context.phase = combat.getFlag("reign", "phase") || "declaration";
    context.round = combat.round || 1;
    context.declarationMode = game.settings.get("reign", "declarationMode") || "simple";
    context.isAdvancedMode = context.declarationMode === "advanced";

    if (context.phase === "declaration") {
      context.declaration = this._prepareDeclarationData(combat);
    } else {
      context.resolution = this._prepareResolutionData(combat);
    }

    return context;
  }

  // ─── Declaration Phase ─────────────────────────────────────────────────────

  _prepareDeclarationData(combat) {
    const combatants = [];
    const sorted = combat.combatants.contents.sort((a, b) =>
      combat._sortCombatants ? combat._sortCombatants(a, b) : 0
    );

    for (const c of sorted) {
      const actor = c.actor;
      if (!actor) continue;

      const isPC = !!actor.hasPlayerOwner;
      const declared = c.getFlag("reign", "declared") || false;
      const declText = c.getFlag("reign", "declarationText") || "";
      const declAction = c.getFlag("reign", "declarationAction") || "";
      const sense = actor.system?.attributes?.sense?.value || 0;
      const hasShield = actor.items?.some(i => i.type === "shield" && i.system.equipped) || false;

      // Conditions
      const conditions = [];
      if (actor.statuses?.has("dazed")) conditions.push("Dazed");
      if (actor.statuses?.has("prone")) conditions.push("Prone");
      if (actor.statuses?.has("blind")) conditions.push("Blind");
      if (actor.statuses?.has("pinned")) conditions.push("Pinned");
      if (actor.statuses?.has("restrained")) conditions.push("Restrained");

      // Aim state from previous round
      const aimBonus = actor.getFlag("reign", "aimBonus") || 0;

      combatants.push({
        id: c.id,
        actorId: actor.id,
        name: c.name || actor.name,
        img: actor.img || "icons/svg/mystery-man.svg",
        isPC,
        isThreat: actor.type === "threat",
        isCreature: actor.type === "threat" && actor.system.creatureMode,
        declared,
        declText: foundry.utils.escapeHTML(declText),
        declAction,
        sense,
        hasShield,
        conditions,
        hasConditions: conditions.length > 0,
        aimBonus,
        hasAim: aimBonus > 0,
        // Permission: can this user declare for this combatant?
        isOwner: c.isOwner,
        canDeclare: game.user.isGM || c.isOwner,
        // Magnitude for threats
        magnitude: actor.type === "threat" ? (actor.system.magnitude?.value || 0) : null,
        magnitudeMax: actor.type === "threat" ? (actor.system.magnitude?.max || 0) : null,
      });
    }

    const declaredCount = combatants.filter(c => c.declared).length;
    const totalCount = combatants.length;
    const progressPercent = totalCount > 0 ? Math.round((declaredCount / totalCount) * 100) : 0;

    return { combatants, declaredCount, totalCount, progressPercent };
  }

  // ─── Resolution Phase ──────────────────────────────────────────────────────

  _prepareResolutionData(combat) {
    const entries = [];
    const rollCache = getAllRollData(combat);

    for (const c of combat.combatants) {
      const actor = c.actor;
      if (!actor) continue;
      if (c.initiative === null || c.initiative === undefined) continue;

      const decoded = decodeInitiative(c.initiative);
      if (!decoded) continue;

      const { width, height } = decoded;
      const rollData = rollCache.get(actor.id) || null;

      // Determine action type from roll flags
      const rollFlags = rollData?.rollFlags || {};
      const label = rollData?.label || "";
      const isDefense = rollData?.isDefense || rollFlags.isDefense || /dodge|parry|counterspell/i.test(label);
      const isSpell = rollData?.itemData?.type === "spell";
      const isAttack = !isDefense;

      // Hit location (from Height)
      const locKey = getHitLocation(height);
      const locLabel = getHitLocationLabel(locKey);

      // Dice data from the roll message
      let matchedDice = [];
      let wasteDice = [];
      let gobbleDice = [];
      let allResults = [];

      if (rollData?.results) {
        allResults = rollData.results;
        const parsed = parseORE(allResults, rollFlags.isMinion);
        // Find the specific set matching this initiative
        const matchingSet = parsed.sets.find(s => s.width === width && s.height === height);
        if (matchingSet) {
          matchedDice = Array(matchingSet.width).fill(matchingSet.height);
        }
        wasteDice = parsed.waste || [];

        // Gobble dice for defense rolls
        if (isDefense && rollData.gobbleDice) {
          gobbleDice = rollData.gobbleDice;
        }
      }

      // Damage preview for attacks
      let dmgPreview = null;
      if (isAttack && rollData?.itemData?.system?.damageFormula) {
        const formula = rollData.itemData.system.damageFormula;
        const dmg = parseDamageFormula(formula, width);
        const parts = [];
        if (dmg.shock > 0) parts.push(`${dmg.shock} Shock`);
        if (dmg.killing > 0) parts.push(`${dmg.killing} Killing`);
        if (dmg.healing > 0) parts.push(`${dmg.healing} Healing`);
        dmgPreview = parts.join(" + ") || null;
      }

      // Weapon qualities
      const qualities = [];
      if (rollData?.itemData?.system?.qualities) {
        const q = rollData.itemData.system.qualities;
        if (q.ap) qualities.push(`AP ${q.ap}`);
        if (q.slow) qualities.push(`Slow ${q.slow}`);
        if (q.area) qualities.push(`Area ${q.area}`);
        if (q.massive) qualities.push("Massive");
        if (q.twoHanded) qualities.push("2H");
      }

      // Defense type label
      let defenseTypeLabel = "";
      if (isDefense) {
        const dt = rollData?.defenseType || "generic";
        if (dt === "dodge") defenseTypeLabel = "Dodge";
        else if (dt === "parry") defenseTypeLabel = "Parry";
        else if (dt === "counterspell") defenseTypeLabel = "Counterspell";
        else defenseTypeLabel = "Defense";
      }

      // Action description
      let actionDesc = "";
      if (isDefense) {
        actionDesc = `🛡 ${defenseTypeLabel}`;
      } else if (isSpell) {
        actionDesc = `✦ ${rollData?.itemData?.name || "Spell"}`;
      } else if (rollData?.itemData?.name) {
        actionDesc = `⚔ ${rollData.itemData.name}`;
      } else if (label) {
        actionDesc = `⚔ ${label}`;
      } else {
        actionDesc = "⚔ Attack";
      }

      // Actor conditions for badges
      const conditions = [];
      if (actor.statuses?.has("dazed")) conditions.push({ id: "dazed", label: "Dazed", icon: "fas fa-dizzy" });
      if (actor.statuses?.has("prone")) conditions.push({ id: "prone", label: "Prone", icon: "fas fa-arrow-down" });
      if (actor.statuses?.has("blind")) conditions.push({ id: "blind", label: "Blind", icon: "fas fa-eye-slash" });

      entries.push({
        combatantId: c.id,
        actorId: actor.id,
        name: c.name || actor.name,
        img: actor.img || "icons/svg/mystery-man.svg",
        isPC: !!actor.hasPlayerOwner,
        isThreat: actor.type === "threat",
        isCreature: actor.type === "threat" && actor.system.creatureMode,
        initiative: c.initiative,
        width,
        height,
        initBadge: `${width}×${height}`,
        actionDesc: foundry.utils.escapeHTML(actionDesc),
        isAttack,
        isDefense,
        isSpell,
        locKey,
        locLabel,
        locShort: shortLocLabel(locKey),
        zoneClass: zoneClass(locKey),
        // Dice
        hasDiceData: matchedDice.length > 0,
        matchedDice,
        wasteDice,
        totalRolled: allResults.length,
        // Defense
        gobbleDice,
        gobbleCount: gobbleDice.length,
        hasGobble: gobbleDice.length > 0,
        defenseTypeLabel,
        // Damage
        dmgPreview,
        qualities,
        hasQualities: qualities.length > 0,
        // Conditions
        conditions,
        hasConditions: conditions.length > 0,
        // Threat data
        magnitude: actor.type === "threat" ? (actor.system.magnitude?.value || 0) : null,
      });
    }

    // Sort by initiative descending (widest/highest first)
    entries.sort((a, b) => b.initiative - a.initiative);

    // Group into Width tiers
    const tierMap = new Map();
    for (const entry of entries) {
      if (!tierMap.has(entry.width)) {
        const meta = tierMeta(entry.width);
        tierMap.set(entry.width, {
          width: entry.width,
          tierClass: meta.cls,
          tierLabel: meta.label,
          pips: Array(meta.pips).fill(true),
          entries: [],
          count: 0,
        });
      }
      const tier = tierMap.get(entry.width);
      tier.entries.push(entry);
      tier.count++;
    }

    // Convert to array sorted by Width descending
    const tiers = [...tierMap.values()].sort((a, b) => b.width - a.width);

    // Detect simultaneous sets (same Width AND Height from different actors)
    for (const tier of tiers) {
      const byHeight = new Map();
      for (const entry of tier.entries) {
        const key = entry.height;
        if (!byHeight.has(key)) byHeight.set(key, []);
        byHeight.get(key).push(entry);
      }
      for (const [h, group] of byHeight) {
        if (group.length > 1) {
          for (const entry of group) {
            entry.isSimultaneous = true;
            entry.simultaneousWith = group
              .filter(e => e.actorId !== entry.actorId)
              .map(e => e.name)
              .join(", ");
          }
        }
      }

      // Phase 5: Mark entries that need a collision connector before them
      for (let i = 1; i < tier.entries.length; i++) {
        const prev = tier.entries[i - 1];
        const curr = tier.entries[i];
        if (prev.isSimultaneous && curr.isSimultaneous && prev.height === curr.height) {
          curr.showConnectorBefore = true;
          curr.connectorLabel = `${curr.width}×${curr.height}`;
        }
      }
    }

    // ─── Phase 3: Spotlight from combat flags ───────────────────────────
    const spotlight = getSpotlight(combat);
    let spotlightEntry = null;
    const pendingRolls = combat.getFlag("reign", "pendingRolls") || {};

    // Apply per-set status from flags and identify the spotlit entry
    for (const entry of entries) {
      const payload = pendingRolls[entry.combatantId];
      if (payload?.sets) {
        // Find the matching set in the flag data by width/height
        const flagSet = payload.sets.find(s => s.width === entry.width && s.height === entry.height);
        if (flagSet?.status) {
          entry.setStatus = flagSet.status;
          entry.isResolved = flagSet.status === "resolved";
          entry.isBroken = flagSet.status === "broken";
          entry.isReacting = flagSet.status === "reacting";
        }
      }

      // Match against the spotlight flag
      if (spotlight && spotlight.combatantId === entry.combatantId) {
        const flagSet = payload?.sets?.[spotlight.setIndex];
        if (flagSet && flagSet.width === entry.width && flagSet.height === entry.height) {
          entry.isSpotlight = true;
          spotlightEntry = entry;
        }
      }
    }

    // Fallback: if no spotlight flag exists, spotlight the first pending entry
    if (!spotlightEntry && entries.length > 0) {
      const firstPending = entries.find(e => !e.isResolved && !e.isBroken);
      if (firstPending) {
        firstPending.isSpotlight = true;
        spotlightEntry = firstPending;
      }
    }

    // ─── Phase 3: Gobble validation for defense entries ───────────────
    // When a spotlight exists on an attack set, validate each defender's
    // gobble dice against it and attach the validation results.
    if (spotlightEntry && !spotlightEntry.isDefense) {
      const atkSet = { width: spotlightEntry.width, height: spotlightEntry.height };

      for (const entry of entries) {
        if (!entry.isDefense || !entry.hasGobble) continue;

        const defPayload = pendingRolls[entry.combatantId];
        const defActor = game.actors.get(entry.actorId);
        const validation = validateGobble(defPayload, atkSet, defActor);

        entry.gobbleValidation = {
          valid: validation.valid,
          timingOk: validation.timingOk,
          heightOk: validation.heightOk,
          reason: validation.reason,
          validCount: validation.validDice.length,
          invalidCount: validation.invalidDice.length,
        };

        // Tag each gobble die as valid or invalid for template rendering
        entry.gobbleDiceTagged = entry.gobbleDice.map(dieValue => ({
          value: dieValue,
          isValid: validation.timingOk && (validation.validDice.includes(dieValue)),
        }));

        // Data for the apply button
        if (validation.valid) {
          entry.gobbleTarget = {
            attackerCombatantId: spotlightEntry.combatantId,
            attackSetIndex: spotlight?.setIndex ?? 0,
            defenderCombatantId: entry.combatantId,
          };
        }
      }
    }

    // ─── Phase 4: Damage preview for spotlit attack set ────────────────
    let damagePreview = null;
    if (spotlightEntry && spotlightEntry.isAttack && game.user.isGM) {
      const targets = Array.from(game.user.targets);
      if (targets.length > 0) {
        const targetToken = targets[0];
        const targetActor = targetToken.actor;
        if (targetActor) {
          const dmgFormula = spotlightEntry.dmgPreview ? undefined : null;
          const rollData = rollCache.get(spotlightEntry.actorId);
          const formula = rollData?.itemData?.system?.damageFormula || "Width Shock";
          const ap = rollData?.itemData?.system?.qualities?.ap || 0;
          const parsed = parseDamageFormula(formula, spotlightEntry.width);
          const locKey = getHitLocation(spotlightEntry.height);

          // Character target: location-based AR and health
          if (targetActor.type === "character") {
            const locHealth = targetActor.system.health?.[locKey] || {};
            const locMax = targetActor.system.effectiveMax?.[locKey] || 10;
            const locAR = targetActor.system.armor?.[locKey] || 0;
            const effectiveAR = Math.max(0, locAR - ap);
            const netShock = Math.max(0, parsed.shock - effectiveAR);
            const netKilling = Math.max(0, parsed.killing - effectiveAR);
            const postHit = computeLocationDamage(
              locHealth.shock || 0, locHealth.killing || 0,
              netShock, netKilling, locMax
            );

            damagePreview = {
              targetName: targetActor.name,
              targetImg: targetActor.img,
              formulaLabel: formula,
              grossShock: parsed.shock,
              grossKilling: parsed.killing,
              locLabel: getHitLocationLabel(locKey),
              ar: locAR,
              ap,
              effectiveAR,
              netShock,
              netKilling,
              currentShock: locHealth.shock || 0,
              currentKilling: locHealth.killing || 0,
              locMax,
              postShock: postHit.newShock,
              postKilling: postHit.newKilling,
              overflow: postHit.overflowKilling,
              hasOverflow: postHit.overflowKilling > 0,
              isLethal: postHit.newKilling >= locMax && (locKey === "head" || locKey === "torso"),
            };
          } else {
            // Threat/creature: simplified preview
            damagePreview = {
              targetName: targetActor.name,
              targetImg: targetActor.img,
              formulaLabel: formula,
              grossShock: parsed.shock,
              grossKilling: parsed.killing,
              locLabel: getHitLocationLabel(locKey),
              ar: 0, ap, effectiveAR: 0,
              netShock: parsed.shock,
              netKilling: parsed.killing,
              isThreats: true,
            };
          }
        }
      }
    }

    if (spotlightEntry) {
      spotlightEntry.damagePreview = damagePreview;
      spotlightEntry.hasTarget = !!damagePreview;
    }

    // ─── Phase 4: Spoil eligibility ──────────────────────────────────────
    // Any combatant with pending (non-resolved, non-broken) sets can be spoiled.
    // The dashboard shows a "Lose a die" button on each eligible set.
    for (const entry of entries) {
      if (entry.isResolved || entry.isBroken) continue;
      // Don't show spoil on the currently resolving set
      if (entry.isSpotlight) continue;

      const payload = pendingRolls[entry.combatantId];
      if (!payload?.sets) continue;

      // Find the matching flag set index for the spoil button data attribute
      const flagSetIdx = payload.sets.findIndex(s => s.width === entry.width && s.height === entry.height);
      if (flagSetIdx >= 0) {
        entry.canSpoil = true;
        entry.spoilSetIndex = flagSetIdx;
      }
    }

    // Build spotlight label for the action bar
    const spotLabel = spotlightEntry
      ? `${spotlightEntry.name} · ${spotlightEntry.initBadge} · ${spotlightEntry.locShort}`
      : "";

    // Count resolved
    const resolvedCount = entries.filter(e => e.isResolved || e.isBroken).length;

    return {
      tiers,
      totalSets: entries.length,
      spotlightLabel: spotLabel,
      hasEntries: entries.length > 0,
      hasSpotlight: !!spotlightEntry,
      resolvedCount,
      allResolved: resolvedCount === entries.length && entries.length > 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Click portrait: pan canvas to the combatant's token. */
  _onPanToToken(event, target) {
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!actorId) return;
    const token = canvas?.tokens?.placeables.find(t => t.actor?.id === actorId);
    if (token) {
      token.control({ releaseOthers: true });
      canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
    } else {
      game.actors.get(actorId)?.sheet?.render(true);
    }
  }

  /** Double-click portrait: open actor sheet. */
  _onOpenSheet(event, target) {
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!actorId) return;
    game.actors.get(actorId)?.sheet?.render(true);
  }

  /** Toggle collapse state per user. */
  async _onToggleCollapse(event, target) {
    const current = !!game.user.getFlag("reign", "dashboardCollapsed");
    await game.user.setFlag("reign", "dashboardCollapsed", !current);
    this.render(false);
  }

  /** GM: Advance the spotlight to the next set in resolution order. */
  async _onAdvanceSpotlight(event, target) {
    if (!game.user.isGM) return;
    const combat = game.combat;
    if (!combat?.started) return;
    const result = await advanceSpotlight(combat);
    if (!result) {
      ui.notifications.info("All sets resolved for this round.");
      this._postRoundSummary(combat);
    }
  }

  /** Apply a gobble die from a defender to the currently spotlit attack. */
  async _onApplyGobble(event, target) {
    const defCombatantId = target.dataset.defenderCombatantId;
    const atkCombatantId = target.dataset.attackerCombatantId;
    const atkSetIndex = parseInt(target.dataset.attackSetIndex);

    if (!defCombatantId || !atkCombatantId || isNaN(atkSetIndex)) return;

    // Permission check: player must own the defender, or be GM
    if (!game.user.isGM) {
      const combat = game.combat;
      const defCombatant = combat?.combatants.get(defCombatantId);
      if (!defCombatant?.isOwner) {
        return ui.notifications.warn("You can only use your own gobble dice.");
      }
    }

    requestGobble(defCombatantId, atkCombatantId, atkSetIndex);
  }

  /** GM: Resolve the currently spotlit attack set — apply damage and advance. */
  async _onResolveSet(event, target) {
    if (!game.user.isGM) return;
    const combat = game.combat;
    if (!combat?.started) return;

    const spotlight = getSpotlight(combat);
    if (!spotlight) return ui.notifications.warn("No set is currently spotlit.");

    const pendingRolls = combat.getFlag("reign", "pendingRolls") || {};
    const atkPayload = pendingRolls[spotlight.combatantId];
    const atkSet = atkPayload?.sets?.[spotlight.setIndex];

    if (!atkPayload || !atkSet) return ui.notifications.warn("Spotlight set data not found.");
    if (atkPayload.isDefense) return ui.notifications.warn("Defense sets are not resolved for damage — advance the spotlight instead.");
    if (atkSet.status === "resolved" || atkSet.status === "broken") return;

    // Check GM has a target selected
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) {
      return ui.notifications.warn("Target a token on the canvas before resolving damage.");
    }

    // Extract damage parameters from the combat flag data
    const width = atkSet.width;
    const height = atkSet.height;
    const dmgFormula = atkPayload.itemData?.system?.damageFormula || "Width Shock";
    const ap = atkPayload.itemData?.system?.qualities?.ap || 0;
    const areaDice = atkPayload.itemData?.system?.qualities?.area || 0;
    const advancedMods = atkPayload.advancedMods || {};
    const isMassive = !!(advancedMods.isMassive);
    const attackerActor = game.actors.get(atkPayload.actorId) || null;

    // Apply damage (uses game.user.targets internally)
    await applyDamageToTarget(width, height, dmgFormula, ap, isMassive, areaDice, attackerActor, advancedMods);

    // Mark resolved and advance spotlight
    const next = await resolveCurrentSet(combat);
    if (!next) {
      this._postRoundSummary(combat);
    }
  }

  /** Player or GM: Spoil a die from one of the target's sets after being hit. */
  async _onSpoilSet(event, target) {
    const combatantId = target.dataset.combatantId;
    const setIndex = parseInt(target.dataset.setIndex);
    if (!combatantId || isNaN(setIndex)) return;

    // Permission: must own the combatant or be GM
    if (!game.user.isGM) {
      const combat = game.combat;
      const combatant = combat?.combatants.get(combatantId);
      if (!combatant?.isOwner) {
        return ui.notifications.warn("You can only spoil your own sets.");
      }
    }

    requestSpoil(combatantId, setIndex);
  }

  /** Simple mode: toggle declared/undeclared for a combatant. */
  async _onDeclareToggle(event, target) {
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if (!combatantId) return;

    const combat = game.combat;
    if (!combat?.started) return;

    const combatant = combat.combatants.get(combatantId);
    if (!combatant) return;

    // Permission check
    if (!game.user.isGM && !combatant.isOwner) {
      return ui.notifications.warn("You do not have permission to declare for this combatant.");
    }

    const current = combatant.getFlag("reign", "declared") || false;
    await combatant.setFlag("reign", "declared", !current);
  }

  /** Advanced mode: open the structured declaration dialog. */
  async _onOpenDeclareDialog(event, target) {
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if (!combatantId) return;

    const combat = game.combat;
    if (!combat?.started) return;

    const combatant = combat.combatants.get(combatantId);
    if (!combatant) return;

    if (!game.user.isGM && !combatant.isOwner) {
      return ui.notifications.warn("You do not have permission to declare for this combatant.");
    }

    // Call the declaration dialog exposed on game.reign
    if (typeof game.reign?.openDeclarationDialog === "function") {
      await game.reign.openDeclarationDialog(combatant, combat);
    } else {
      // Fallback: simple toggle if advanced dialog isn't available
      await combatant.setFlag("reign", "declared", true);
    }
  }

  /** GM: Advance to the next round. Clears all rolls and resets declarations. */
  async _onNextRound(event, target) {
    if (!game.user.isGM) return;
    const combat = game.combat;
    if (!combat?.started) return;
    await combat.nextRound();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ROUND SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  /** Posts a round summary chat card when all sets are resolved. GM-only. */
  async _postRoundSummary(combat) {
    if (!game.user.isGM || !combat) return;

    const pendingRolls = combat.getFlag("reign", "pendingRolls") || {};
    const round = combat.round || 1;
    const lines = [];

    for (const [combatantId, payload] of Object.entries(pendingRolls)) {
      if (!payload?.sets) continue;
      const name = game.actors.get(payload.actorId)?.name || "Unknown";

      for (const set of payload.sets) {
        const status = set.status || "pending";
        if (status === "resolved") {
          const loc = getHitLocationLabel(getHitLocation(set.height));
          lines.push(`<strong>${foundry.utils.escapeHTML(name)}</strong> — ${set.width}×${set.height} → ${loc} ✓`);
        } else if (status === "broken") {
          lines.push(`<strong>${foundry.utils.escapeHTML(name)}</strong> — set broken ✗`);
        }
      }
    }

    if (lines.length === 0) return;

    await ChatMessage.create({
      content: `<div class="reign-chat-card">
        <h3><i class="fas fa-flag-checkered"></i> Round ${round} — Resolution Complete</h3>
        <div class="reign-callout">${lines.join("<br>")}</div>
      </div>`,
      speaker: { alias: "⚔ Combat Dashboard" }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  STATIC HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Show the dashboard if combat is active and the user hasn't dismissed it.
   * Called from hooks in reign.mjs.
   */
  static show(instance) {
    if (!game.combat?.started) return;
    if (instance._userDismissed) return;
    if (!instance.rendered) {
      instance.render(true);
    }
  }

  /**
   * Manually toggle the dashboard open/closed. Called from the scene control
   * button in reign.mjs. Resets the dismissal flag when opening so future
   * auto-show hooks (combatStart, phase transitions) work normally again.
   */
  static toggle(instance) {
    if (!instance) return;
    if (instance.rendered) {
      instance.close();
    } else {
      instance._userDismissed = false;
      instance.render(true);
    }
  }

  /** Reset dismissal flag — called when a new combat starts. */
  resetDismissal() {
    this._userDismissed = false;
  }
}
