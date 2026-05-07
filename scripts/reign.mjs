/**
 * Reign: Realities of Lords and Leaders
 * Targeted for Foundry VTT v14+ (ApplicationV2)
 */

import { ReignActorSheet } from "./sheets/character-sheet.js";
import { ReignCompanySheet } from "./sheets/company-sheet.js";
import { ReignThreatSheet } from "./sheets/threat-sheet.js";
import { ReignItemSheet } from "./sheets/item-sheet.js";
import { generateOREChatHTML, applyItemEffectsToTargets, assignGobbleSet, postOREChat, assignSetToAction } from "./helpers/chat.js";
import { applyDamageToTarget, applyScatteredDamageToTarget, applyHealingToTarget, applyFirstAidToTarget, applyOffensiveMoraleAttack, applyManeuverStatus, applyStrangleDamage, setupIronKiss, executeIronKiss, applyRedirectDamage, applySubmissionHold } from "./combat/damage.js";
import { applyCompanyDamageToTarget } from "./combat/company-damage.js";
import { consumeGobbleDie, diveForCover } from "./combat/defense.js";
import { ReignCombat } from "./combat/ore-combat.js";
import { parseORE, calculateInitiative } from "./helpers/ore-engine.js";
import { CharacterRoller, calculateOREPool } from "./helpers/character-roller.js";
import { ThreatRoller } from "./helpers/threat-roller.js";
import { skillAttrMap } from "./helpers/config.js";
import { ReignCharactermancer } from "./generators/charactermancer.js";
import { ReignCompanymancer } from "./generators/companymancer.js";
import { FactionDashboard } from "./apps/faction-dashboard.js";
import { openHazardRoller, handlePoisonResist } from "./combat/hazards.js";
import { reignDialog } from "./helpers/dialog-util.js";
import { GMToolbar, fulfillRollRequest } from "./apps/gm-toolbar.js";

import { migrateWorld } from "./system/migration.js";
import * as models from "./system/models.js";

const { DialogV2 } = foundry.applications.api;

Hooks.once("init", async () => {

  // ── Global UI Skin: mark <body> so CSS can target Foundry chrome ──
  document.body.classList.add("system-reign");

  // ── Colourblind Mode (Client Setting) ──
  game.settings.register("reign", "colorblindMode", {
    name: "Colourblind Mode",
    hint: "Shifts the colour palette to an Okabe-Ito inspired high-contrast scheme that is distinguishable under protanopia, deuteranopia, and tritanopia.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: (enabled) => {
      document.body.classList.toggle("colorblind-mode", enabled);
    }
  });
  // Apply on load (deferred to 'ready' hook where client settings are guaranteed loaded)

  CONFIG.Combat.documentClass = ReignCombat;
  CONFIG.Combat.initiative = { formula: "0", decimals: 2 };

  // AUDIT FIX: Point to valid {value} objects for token bars based on the v1.5.1 schema
  CONFIG.Actor.trackableAttributes = {
      character: {
          bar: [], // Characters use modular locations, not a single max pool
          value: ["wealth.value", "xp.value"]
      },
      threat: {
          bar: ["magnitude", "morale"], // These map to SchemaFields with {value, max}
          value: ["threatLevel"]
      },
      company: {
          bar: [], // Companies use value/damage, effective is computed
          value: ["qualities.might.value", "qualities.treasure.value", "qualities.influence.value", "qualities.territory.value", "qualities.sovereignty.value"]
      }
  };

  game.settings.register("reign", "lastMigrationVersion", {
    name: "Last Migration Version", scope: "world", config: false,
    type: String, default: "0"
  });

  game.settings.register("reign", "oneRollTables", {
    name: "Available One-Roll Tables",
    hint: "A comma-separated list of file paths to One-Roll JSON files. (e.g., systems/reign/data/oneroll-default.json, worlds/myworld/data/dwarven-paths.json)",
    scope: "world",
    config: true,
    type: String,
    default: "systems/reign/data/oneroll-default.json"
  });

  // --- NEW POINT BUY SETTINGS ---
  game.settings.register("reign", "campaignBudget", {
    name: "Point Buy: Campaign Budget",
    hint: "The total number of starting points for new characters (e.g., 85 for Beginner, 120 for Serious, 150 for Epic).",
    scope: "world",
    config: true,
    type: Number,
    default: 85
  });
  // ------------------------------

  // RAW: After combat, half the Shock taken during that specific fight immediately disappears,
  // rounded up. "All" and "None" are optional GM variants; "Half" is the rules-as-written default.
  game.settings.register("reign", "postCombatRecovery", {
    name: "Post-Combat Shock Recovery",
    hint: "RAW: Half the Shock sustained in a fight disappears immediately when combat ends, rounded up (default). 'All' is a heroic house rule. 'None' is a lethal house rule.",
    scope: "world",
    config: true,
    type: String,
    default: "half",
    choices: {
      half: "Half — rounded up (RAW default)",
      all:  "All — full recovery (House Rule: heroic)",
      none: "None — no recovery (House Rule: lethal)"
    }
  });
  // ------------------------------

  game.settings.register("reign", "declarationMode", {
    name: "Declaration Mode",
    hint: "Simple: the current toggle-only workflow. Advanced: a structured dialog that captures the declared action, stat/skill, and opens the roll dialog pre-configured.",
    scope: "world",
    config: true,
    type: String,
    default: "simple",
    choices: {
      simple:   "Simple — toggle only (default)",
      advanced: "Advanced — declaration dialog"
    }
  });
  // ------------------------------

  const reignStatuses = [
    { id: "dead", name: "REIGN.StatusDead", img: "icons/svg/skull.svg", _id: "dead000000000000" },
    { id: "unconscious", name: "REIGN.StatusUnconscious", img: "icons/svg/unconscious.svg", _id: "unconscious00000" },
    // V14 Catch-Basin Fix: Point to the new globalPool modifier
    { id: "dazed", name: "REIGN.StatusDazed", img: "icons/svg/daze.svg", _id: "dazed00000000000", changes: [{ key: "system.modifiers.globalPool", mode: 2, value: "-1" }] },
    { id: "maimed", name: "REIGN.StatusMaimed", img: "icons/svg/sword.svg", _id: "maimed0000000000" },
    { id: "prone", name: "REIGN.StatusProne", img: "icons/svg/falling.svg", _id: "prone00000000000" },
    { id: "bleeding", name: "REIGN.StatusBleeding", img: "icons/svg/blood.svg", _id: "bleeding00000000" },
    { id: "pinned", name: "REIGN.StatusPinned", img: "icons/svg/net.svg", _id: "pinned0000000000" },
    { id: "restrained", name: "REIGN.StatusRestrained", img: "icons/svg/anchor.svg", _id: "restrained000000" },
    { id: "blind", name: "REIGN.StatusBlind", img: "icons/svg/blind.svg", _id: "blind00000000000" } 
  ];

  // V14 COMPLIANCE: Proxy-safe array mutation.
  // Replace all Foundry core statuses with only Reign statuses so the token HUD
  // shows only conditions that are meaningful in this system.
  CONFIG.statusEffects.splice(0, CONFIG.statusEffects.length, ...reignStatuses);

  CONFIG.Actor.dataModels = {
    character: models.ReignCharacterData,
    company: models.ReignCompanyData,
    threat: models.ReignThreatData
  };

  CONFIG.Item.dataModels = {
    weapon: models.ReignWeaponData,
    armor: models.ReignArmorData,
    shield: models.ReignShieldData,
    technique: models.ReignMagicData,
    discipline: models.ReignMagicData,
    spell: models.ReignSpellData,
    gear: models.ReignGearData,
    advantage: models.ReignAdvantageData,
    problem: models.ReignProblemData,
    asset: models.ReignAssetData,
    poison: models.ReignPoisonData
  };

  const templatePaths = [
    // Existing global partials
    "systems/reign/templates/parts/damage-silhouette.hbs",
    
    // NEW: V14 Character Sheet Partials
    "systems/reign/templates/actor/parts/header.hbs",
    "systems/reign/templates/actor/parts/tabs.hbs",
    "systems/reign/templates/actor/parts/tab-stats.hbs",
    "systems/reign/templates/actor/parts/tab-combat.hbs",
    "systems/reign/templates/actor/parts/combat-health.hbs",
    "systems/reign/templates/actor/parts/combat-moves.hbs",
    "systems/reign/templates/actor/parts/combat-inventory.hbs",
    "systems/reign/templates/actor/parts/tab-esoterica.hbs",
    "systems/reign/templates/actor/parts/tab-biography.hbs",
    "systems/reign/templates/actor/parts/tab-effects.hbs",
    "systems/reign/templates/apps/companymancer.hbs",
    "systems/reign/templates/apps/gm-toolbar.hbs"
  ];
  await foundry.applications.handlebars.loadTemplates(templatePaths);

  const { DocumentSheetConfig } = foundry.applications.apps;

  DocumentSheetConfig.registerSheet(Actor, "reign", ReignActorSheet, { types: ["character"], makeDefault: true });
  DocumentSheetConfig.registerSheet(Actor, "reign", ReignCompanySheet, { types: ["company"], makeDefault: true });
  DocumentSheetConfig.registerSheet(Actor, "reign", ReignThreatSheet, { types: ["threat"], makeDefault: true });
  DocumentSheetConfig.registerSheet(Item, "reign", ReignItemSheet, { makeDefault: true });

  /**
   * P3 FIX: Expose Global API for Macros
   * This allows GMs to access core logic without opening sheets.
   */
  game.reign = {
    parseORE,
    calculateInitiative,
    applyDamageToTarget,
    applyCompanyDamageToTarget,
    applyScatteredDamageToTarget,
    applyHealingToTarget,
    applyFirstAidToTarget,
    applyOffensiveMoraleAttack,   // Package A: Offensive Morale Attack
    consumeGobbleDie,
    diveForCover,                                          // Item 8: Dive for Cover
    applyItemEffectsToTargets, // Phase 4: Export Magic Transfer Macro
    assignGobbleSet, // Export P1 Gobble Logic
    declareAim: CharacterRoller.declareAim,               // Package C: Aim maneuver
    assignShieldCoverage: CharacterRoller.assignShieldCoverage, // Package C: Shield assignment
    ReignCharactermancer,
    ReignCompanymancer,
    openQuickDiceRoller,                                     // F4: Quick Dice Roller
    GMToolbar                                                // GM Toolbar class
  };
});

// ── Colourblind Mode: apply saved preference on load (all users) ──
Hooks.once("ready", () => {
  if (game.settings.get("reign", "colorblindMode")) {
    document.body.classList.add("colorblind-mode");
  }
});

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const currentVersion = game.system.version;
  const lastMigration = game.settings.get("reign", "lastMigrationVersion") || "0";
  
  if (foundry.utils.isNewerVersion(currentVersion, lastMigration)) {
    console.log(`Reign | World migrating from version ${lastMigration} to ${currentVersion}`);
    const result = await migrateWorld();
    if ((result?.failureCount || 0) > 0) {
      ui.notifications.error(`Reign | Migration encountered ${result.failureCount} failure(s). Version flag not advanced. See console for details.`);
      return;
    }
    await game.settings.set("reign", "lastMigrationVersion", currentVersion);
  }
});

// GM Toolbar — Initialise the persistent HUD after the game is fully ready.
// GM-only: the toolbar's init() method gates on game.user.isGM internally.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const toolbar = new GMToolbar();
  await toolbar.init();
  game.reign.toolbar = toolbar;
});

/**
 * Intercept Actor Creation (Before it saves to the database)
 * Automatically links unique entities (Characters & Companies) to their tokens
 * so their names and stats perfectly sync on the canvas.
 */
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (actor.type === "character" || actor.type === "company") {
    actor.updateSource({
      "prototypeToken.actorLink": true,
      "prototypeToken.name": data.name // Forces the token to inherit the chosen name
    });
  }
});

/**
 * Intercept Character and Company Creation
 * Triggers the Charactermancer or Companymancer if a new, blank entity is created.
 */
Hooks.on("createActor", async (actor, options, userId) => {
  if (game.user.id !== userId) return;
  if (actor.flags?.core?.sourceId || options.fromCompendium) return;

  if (actor.type === "character") {
    await actor.update({ "system.creationMode": true });
    setTimeout(() => {
      actor.sheet.close();
      new ReignCharactermancer({ document: actor }).render(true);
    }, 50); 
  } else if (actor.type === "company") {
    await actor.update({ "system.creationMode": true });
    setTimeout(() => {
      actor.sheet.close();
      new ReignCompanymancer({ document: actor }).render(true);
    }, 50); 
  }
});

Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (actor.type !== "character") return;
  
  const skills = changes?.system?.skills;
  if (skills) {
    for (const [key, updates] of Object.entries(skills)) {
      if (updates?.master === true && (actor.system.skills[key]?.expert || updates?.expert === true)) updates.expert = false;
      if (updates?.expert === true && (actor.system.skills[key]?.master || updates?.master === true)) updates.master = false;
    }
  }
  
  const custom = changes?.system?.customSkills;
  if (custom) {
    for (const [key, updates] of Object.entries(custom)) {
      if (updates?.master === true && (actor.system.customSkills[key]?.expert || updates?.expert === true)) updates.expert = false;
      if (updates?.expert === true && (actor.system.customSkills[key]?.master || updates?.master === true)) updates.master = false;
    }
  }

  const esoterica = changes?.system?.esoterica;
  if (esoterica) {
    if (esoterica?.master === true && (actor.system.esoterica?.expert || esoterica?.expert === true)) esoterica.expert = false;
    if (esoterica?.expert === true && (actor.system.esoterica?.master || esoterica?.master === true)) esoterica.master = false;

    // Stash the previous attunementStatus so the updateActor hook can detect
    // a genuine transition to "perfect" rather than a redundant re-save.
    if (esoterica.attunementStatus !== undefined) {
        if (!options.previousData) options.previousData = {};
        if (!options.previousData.system) options.previousData.system = {};
        if (!options.previousData.system.esoterica) options.previousData.system.esoterica = {};
        options.previousData.system.esoterica.attunementStatus = actor.system.esoterica?.attunementStatus;
    }
  }
});

Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (!item.parent || item.parent.type !== "character") return;

    if (changes.system?.equipped === true && item.type === "weapon" && item.system.qualities?.massive) {
        const bodyVal = item.parent.system.attributes.body?.value || 0;
        if (bodyVal < 4) {
            ui.notifications.error(`Cannot equip ${item.name}. Massive weapons require Body 4 or higher (Current: ${bodyVal}).`);
            return false; 
        }
    }
    return true;
});

// ── ATTUNEMENT AE OFFER ────────────────────────────────────────────────────
// When a character's attunementStatus transitions to "perfect", offer to create
// a labelled Active Effect so the GM/player can record mechanical attunement
// benefits (immunities, resistances, etc.) through the standard AE system.
// This is entirely optional — dismissing the dialog has no effect.
// Only fires for the owning user to avoid duplicate dialogs in multiplayer.
Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (actor.type !== "character") return;

    const newStatus = changes?.system?.esoterica?.attunementStatus;
    if (newStatus !== "perfect") return;

    const oldStatus = options?.previousData?.system?.esoterica?.attunementStatus;
    if (oldStatus === "perfect") return; // already perfect — no transition

    // Check if an attunement AE already exists for this school
    const schoolName = actor.system.esoterica?.schoolName || "";
    const aeLabel = schoolName
        ? `Perfect Attunement: ${schoolName}`
        : "Perfect Attunement";

    const existingAE = actor.effects.find(e => e.name === aeLabel);
    if (existingAE) return; // already created

    // Only the GM or an owner of this actor should see the dialog
    if (!actor.isOwner) return;

    const confirmed = await DialogV2.confirm({
        window: { title: "Attunement Achieved" },
        content: `
            <div class="reign-dialog-section">
                <p><strong>${actor.name}</strong> has achieved Perfect Attunement${schoolName ? ` with <em>${schoolName}</em>` : ""}.</p>
                <p>Would you like to create an Active Effect to track attunement benefits — immunities, resistances, and other mechanical advantages?</p>
                <p class="reign-text-muted reign-text-sm">The effect will be created with no changes. Add mechanical entries to it as needed.</p>
            </div>
        `,
        yes: { label: "Create Effect", icon: "fas fa-circle-nodes" },
        no:  { label: "Not Now",       icon: "fas fa-times" }
    });

    if (!confirmed) return;

    const attunementNotes = actor.system.esoterica?.attunement || "";
    const aeData = {
        name: aeLabel,
        icon: "icons/magic/light/orbs-energize-teal.webp",
        disabled: false,
        description: attunementNotes || `Perfect attunement with ${schoolName || "this school"}. Add mechanical benefits as changes below.`,
        changes: []
    };

    const created = await actor.createEmbeddedDocuments("ActiveEffect", [aeData]);
    if (created?.length) {
        ui.notifications.info(`Active Effect "${aeLabel}" created. Open the Effects tab to add mechanical benefits.`);
    }
});

Hooks.on("updateItem", async (item, changes, options, userId) => {
  if (game.user.id !== userId) return;
  if (!item.parent || item.parent.type !== "character") return;

  if (changes.system !== undefined && changes.system.equipped !== undefined) {
    const isEquipped = changes.system.equipped;
    
    if (isEquipped) {
      await item.update({ "system.equippedTimestamp": Date.now() }, { render: false });
    }

    const effectUpdates = item.effects.map(e => ({ _id: e.id, disabled: !isEquipped }));

    if (effectUpdates.length > 0) {
      await item.updateEmbeddedDocuments("ActiveEffect", effectUpdates);
    }

    if (isEquipped) {
      const actor = item.parent;
      const otherItemUpdates = [];
      const isTwoHanded = item.type === "weapon" && item.system.qualities?.twoHanded;
      const isShield = item.type === "shield";
      const isWeapon = item.type === "weapon";

      const equippedHandhelds = actor.items.filter(i => 
        i.id !== item.id && 
        (i.type === "weapon" || i.type === "shield") && 
        i.system.equipped
      );

      if (isTwoHanded) {
        equippedHandhelds.forEach(i => { otherItemUpdates.push({ _id: i.id, "system.equipped": false }); });
      } else if (isShield || isWeapon) {
        let handsUsed = 0;
        equippedHandhelds.forEach(i => {
          const isOther2H = i.type === "weapon" && i.system.qualities?.twoHanded;
          if (isOther2H) {
            otherItemUpdates.push({ _id: i.id, "system.equipped": false });
          } else {
            handsUsed += 1;
          }
        });

        if (handsUsed >= 2) {
          const sorted = equippedHandhelds
            .filter(i => !(i.type === "weapon" && i.system.qualities?.twoHanded))
            .sort((a, b) => (a.system.equippedTimestamp || 0) - (b.system.equippedTimestamp || 0));
            
          if (sorted[0]) otherItemUpdates.push({ _id: sorted[0].id, "system.equipped": false });
        }
      }

      if (otherItemUpdates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", otherItemUpdates);
        ui.notifications.info(`${item.name} equipped. Conflict gear unequipped to respect hand limits.`);
      } else {
        ui.notifications.info(`${item.name} equipped.`);
      }
    } else {
        ui.notifications.info(`${item.name} unequipped.`);
    }
  }
});

Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (!item.parent || item.parent.type !== "character") return;

    const actor = item.parent;
    const itemUuid = item.uuid;
    
    // DEBUG: Clean up legacy hard-copied effects when deleting the origin item
    const effectIdsToTrash = actor.effects.filter(e => e.origin === itemUuid).map(e => e.id);
    
    if (effectIdsToTrash.length > 0) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", effectIdsToTrash);
        console.log(`Reign | Cleaned up ${effectIdsToTrash.length} orphaned active effect(s) from deleted item: ${item.name}`);
    }
});

// ISSUE-036 FIX: Shared helper — deactivates all other active non-passive technique/discipline
// AEs on the actor. Called both when an AE is newly created (enabled) AND when it is re-enabled
// after being disabled.
async function _enforceTechniqueMutualExclusion(effect) {
    const actor = effect.parent;
    if (!actor || actor.type !== "character") return;
    if (!effect.origin || effect.disabled) return;

    const originItem = fromUuidSync(effect.origin);
    if (!originItem || (originItem.type !== "technique" && originItem.type !== "discipline") || originItem.system.isPassive) return;

    const otherStancesToDisable = [];
    for (const otherEffect of actor.effects) {
        if (otherEffect.id === effect.id || otherEffect.disabled) continue;
        if (otherEffect.origin) {
            const otherOriginItem = fromUuidSync(otherEffect.origin);
            if (otherOriginItem && (otherOriginItem.type === "technique" || otherOriginItem.type === "discipline") && !otherOriginItem.system.isPassive) {
                otherStancesToDisable.push({ _id: otherEffect.id, disabled: true });
            }
        }
    }

    if (otherStancesToDisable.length > 0) {
        await actor.updateEmbeddedDocuments("ActiveEffect", otherStancesToDisable);
        ui.notifications.info(`Entered ${originItem.name} stance. Previous active techniques deactivated.`);
    }
}

Hooks.on("createActiveEffect", async (effect, options, userId) => {
    if (game.user.id !== userId) return;
    // Fire on creation only if the AE is created already-enabled (not disabled)
    if (effect.disabled) return;
    await _enforceTechniqueMutualExclusion(effect);
});

Hooks.on("updateActiveEffect", async (effect, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (changes.disabled !== false) return; // Only fire when transitioning disabled → enabled
    await _enforceTechniqueMutualExclusion(effect);
});

// G1: Hazard Roller — GM-only button in Token Controls
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  // V14 compatibility: controls may be an array (older builds) or an object/Map (newer builds)
  let tokenGroup;
  if (Array.isArray(controls)) {
    tokenGroup = controls.find(c => c.name === "tokens" || c.name === "token");
  } else {
    tokenGroup = controls.tokens || controls.token;
  }
  if (!tokenGroup) return;
  const tools = tokenGroup.tools;
  if (Array.isArray(tools)) {
    tools.push({
      name: "hazardRoller",
      title: "REIGN.HazardRoller",
      icon: "fas fa-skull-crossbones",
      button: true,
      onChange: () => openHazardRoller()
    });
  } else if (tools && typeof tools === "object") {
    tools.hazardRoller = {
      name: "hazardRoller",
      title: "REIGN.HazardRoller",
      icon: "fas fa-skull-crossbones",
      button: true,
      onChange: () => openHazardRoller()
    };
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const element = (html instanceof HTMLElement) ? html : (html instanceof DocumentFragment ? html.firstElementChild : null);
  if (!element) return;

  const msgId = message.id || element.dataset?.messageId;
  const msg = game.messages.get(msgId);

  // --- P1 RAW FIX: Gobble Set Selection ---
  element.querySelectorAll(".select-gobble-set-btn").forEach(btn => {
      btn.addEventListener("click", async (event) => {
          event.preventDefault();
          if (!msg) return;
          if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can select the Gobble Dice.");

          const width = parseInt(btn.dataset.width);
          const height = parseInt(btn.dataset.height);

          await assignGobbleSet(msg, width, height);
      });
  });

  // 8b: Multi-action set assignment
  element.querySelectorAll(".set-assign-btn").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!msg) return;
      if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can assign sets.");
      const setIndex = parseInt(btn.dataset.setIndex);
      const card = btn.closest(".reign-chat-card");
      const select = card?.querySelector(`.set-assign-select[data-set-index="${setIndex}"]`);
      const actionLabel = select?.value;
      if (!actionLabel) return ui.notifications.warn("Select an action before assigning.");
      await assignSetToAction(msg, setIndex, actionLabel);
    });
  });

  // --- ITEM 8: Dive for Cover button on Dodge cards ---
  // If this is a Dodge defense with gobble dice still available (not yet consumed,
  // and cover not already applied), inject a "Dive for Cover" button.
  const reignFlags = msg?.flags?.reign;
  if (reignFlags?.isDefense
      && (reignFlags?.defenseType === "dodge" || /dodge/i.test(reignFlags?.label || ""))
      && reignFlags?.gobbleDice?.length > 0
      && !reignFlags?.coverApplied) {

      const existingCoverBtn = element.querySelector(".dive-for-cover-btn");
      if (!existingCoverBtn) {
          const card = element.querySelector(".reign-chat-card");
          if (card) {
              const coverBtnWrapper = document.createElement("div");
              coverBtnWrapper.classList.add("reign-cover-btn-wrapper");
              coverBtnWrapper.innerHTML = `<button class="dive-for-cover-btn reign-btn-primary" title="Sacrifice your Gobble Dice to dive behind an obstacle. You'll be downed but protected."><i class="fas fa-shield-alt"></i> Dive for Cover</button>`;
              card.appendChild(coverBtnWrapper);

              coverBtnWrapper.querySelector(".dive-for-cover-btn").addEventListener("click", async (ev) => {
                  ev.preventDefault();
                  if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can choose to dive for cover.");
                  await diveForCover(msg);
              });
          }
      }
  }

  element.querySelectorAll(".set-init-btn").forEach(btn => {
      btn.addEventListener("click", async (event) => {
          event.preventDefault();
          if (!msg) return;
          if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can set this initiative.");

          const width = parseInt(btn.dataset.width);
          const height = parseInt(btn.dataset.height);

          if (game.combat && game.combat.started) {
              const combatant = game.combat.combatants.find(c => c.actorId === msg.speaker?.actor);
              if (combatant) {
                  const reignFlags = msg.flags?.reign || {};
                  const flags = reignFlags.rollFlags || {};
                  const isDefense = flags.isDefense || /dodge|parry|counterspell/i.test(reignFlags.label);
                  const range = reignFlags.itemData?.type === "weapon" ? (reignFlags.itemData.system.range || "0") : "0";
                  
                  const newInit = calculateInitiative([{width, height}], isDefense, flags.isAttack, flags.isMinion, range);

                  await combatant.update({ initiative: newInit });
                  ui.notifications.info(`Initiative set to ${width}x${height} for ${combatant.name}.`);
              } else {
                  ui.notifications.warn("Token is not in the active combat tracker.");
              }
          } else {
              ui.notifications.warn("No active combat encounter.");
          }
      });
  });

  element.querySelectorAll(".gobble-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can alter this attack's dice.");
      
      const heightToRemove = parseInt(btn.dataset.height);
      await consumeGobbleDie(msg, heightToRemove);
    });
  });

  element.querySelectorAll(".apply-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const width = parseInt(btn.dataset.width);
      const height = parseInt(btn.dataset.height);
      const dmgFormula = btn.dataset.dmgString || btn.dataset.dmg || "Width Shock";
      
      const ap = parseInt(btn.dataset.ap) || 0;
      const areaDice = parseInt(btn.dataset.areaDice) || 0;
      
      // ISSUE-017 FIX: Read isMassive from server-side message flags, not from the DOM
      // attribute, which a player could spoof with browser DevTools.
      const advancedMods = msg.flags?.reign?.rollFlags?.advancedMods || {};
      const isMassive = !!(advancedMods.isMassive);

      // ISSUE-038 FIX: Derive attacker from the message speaker rather than using null,
      // which fell back to whatever token the GM had selected at apply-time.
      const attackerActor = msg?.speaker?.actor ? game.actors.get(msg.speaker.actor) : null;

      await applyDamageToTarget(width, height, dmgFormula, ap, isMassive, areaDice, attackerActor, advancedMods);
    });
  });

  element.querySelectorAll(".apply-waste-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const faces = btn.dataset.faces;
      const type = btn.dataset.type;
      const ap = parseInt(btn.dataset.ap) || 0;
      
      // ✅ Retrieve serialized advanced mods directly from the chat card flags
      const advancedMods = msg.flags?.reign?.rollFlags?.advancedMods || {};

      await applyScatteredDamageToTarget(faces, type, ap, null, advancedMods);
    });
  });

  element.querySelectorAll(".apply-company-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const width = parseInt(btn.dataset.width);
      
      const qualityKey = String(btn.dataset.quality || "").toLowerCase(); 
      const attackerActor = msg?.speaker?.actor ? game.actors.get(msg.speaker.actor) : null;

      await applyCompanyDamageToTarget(width, qualityKey, attackerActor);
    });
  });

  element.querySelectorAll(".apply-heal-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const width = parseInt(btn.dataset.width);
      const height = parseInt(btn.dataset.height);
      const healString = btn.dataset.healString;
      
      await applyHealingToTarget(width, height, healString);
    });
  });

  element.querySelectorAll(".apply-first-aid-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const width = parseInt(btn.dataset.width);
      
      await applyFirstAidToTarget(width);
    });
  });

  // ROLL REQUEST: Fulfil button — executes the requested roll for the character
  element.querySelectorAll(".fulfil-request-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await fulfillRollRequest(msg);
    });
  });

  // PHASE 4: MAGIC TRANSFER TRIGGER
  element.querySelectorAll(".apply-condition-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      
      if (!msg) return;
      if (!game.user.isGM && msg.author?.id !== game.user.id) {
        return ui.notifications.warn("Only the GM or the caster can apply this spell's effects.");
      }

      const itemUuid = btn.dataset.itemUuid;
      if (!itemUuid) return ui.notifications.error("Could not locate original spell UUID.");
      
      // Execute the unified transfer function mapped from chat.js
      await applyItemEffectsToTargets(itemUuid);
    });
  });

  // Ch7: MANEUVER MORALE ATTACK BUTTON (Display Kill, Threaten)
  element.querySelectorAll(".apply-morale-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const moraleValue = parseInt(btn.dataset.moraleValue) || 0;
      const sourceDesc = btn.dataset.source || "Maneuver";
      
      await applyOffensiveMoraleAttack(moraleValue, sourceDesc);
    });
  });

  // C1: MANOEUVRE STATUS EFFECT BUTTON (Pin, Restrain, Stand, Shove, Slam)
  element.querySelectorAll(".apply-maneuver-status-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      if (!game.user.isGM && msg.author?.id !== game.user.id) {
        return ui.notifications.warn("Only the GM or the rolling player can apply this manoeuvre's effect.");
      }

      await applyManeuverStatus({
        maneuverKey:  btn.dataset.maneuverKey  || "",
        applyStatus:  btn.dataset.applyStatus  || "",
        clearStatus:  btn.dataset.clearStatus  || "",
        setFlag:      btn.dataset.setFlag      || "",
        statusTarget: btn.dataset.statusTarget || "target",
        slamShock:    parseInt(btn.dataset.slamShock) || 0,
        slamMultiLoc: btn.dataset.slamMultiLoc === "true",
        actorId:      msg.speaker?.actor || null
      });
    });
  });

  // C2: STRANGLE — Initial application
  element.querySelectorAll(".apply-strangle-initial-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await applyStrangleDamage({
        shock: parseInt(btn.dataset.shock) || 0,
        isMaintain: false,
        actorId: msg.speaker?.actor || null
      });
    });
  });

  // C2: STRANGLE — Maintain hold (next round, no roll)
  element.querySelectorAll(".apply-strangle-maintain-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await applyStrangleDamage({
        shock: parseInt(btn.dataset.shock) || 0,
        isMaintain: true,
        actorId: msg.speaker?.actor || null
      });
    });
  });

  // C2: IRON KISS — Setup (store flag for next round)
  element.querySelectorAll(".setup-iron-kiss-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await setupIronKiss({
        virtualWidth: parseInt(btn.dataset.virtualWidth) || 2,
        actorId: msg.speaker?.actor || null,
        msg
      });
    });
  });

  // C2: IRON KISS — Execute (fire the stored guaranteed attack)
  element.querySelectorAll(".execute-iron-kiss-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await executeIronKiss({ actorId: msg.speaker?.actor || null });
    });
  });

  // C2: REDIRECT — Apply redirected damage via dialog
  element.querySelectorAll(".apply-redirect-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await applyRedirectDamage({
        widthMod:    parseInt(btn.dataset.widthMod) || 0,
        redirectAny: btn.dataset.redirectAny === "true",
        actorId:     msg.speaker?.actor || null
      });
    });
  });

  // C2: SUBMISSION HOLD — Apply hold damage to held limb
  element.querySelectorAll(".apply-submission-hold-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await applySubmissionHold({
        shock:      parseInt(btn.dataset.shock) || 0,
        killing:    0,
        holdHeight: parseInt(btn.dataset.holdHeight) || 3,
        isWrench:   false,
        actorId:    msg.speaker?.actor || null
      });
    });
  });

  // C2: SUBMISSION HOLD — Wrench Free (target self-inflicts Killing)
  element.querySelectorAll(".apply-wrench-free-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      await applySubmissionHold({
        shock:      0,
        killing:    parseInt(btn.dataset.killing) || 0,
        holdHeight: parseInt(btn.dataset.holdHeight) || 3,
        isWrench:   true,
        actorId:    msg.speaker?.actor || null
      });
    });
  });

  // C3: GM RESOLVE BUTTON — Tier 2 manoeuvre acknowledgement
  element.querySelectorAll(".gm-resolve-maneuver-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      if (!game.user.isGM) {
        return ui.notifications.warn("Only the GM can resolve Tier 2 manoeuvres.");
      }

      const maneuverLabel = btn.dataset.maneuverLabel || "Manoeuvre";
      const width  = btn.dataset.width  || "?";
      const height = btn.dataset.height || "?";
      const rollerName = msg.speaker?.alias || msg.author?.name || "Unknown";

      await ChatMessage.create({
        content: `<div class="reign-chat-card">
          <h3 class="reign-msg-info"><i class="fas fa-gavel"></i> ${maneuverLabel} — GM Resolved</h3>
          <p><strong>${rollerName}</strong> performed <strong>${maneuverLabel}</strong> (${width}×${height}).</p>
          <p class="reign-text-small reign-text-muted"><i class="fas fa-book"></i> Effect applied at GM discretion per RAW rules.</p>
        </div>`
      });
    });
  });

  // F1: COUNTERSPELL GOBBLE BUTTON — same mechanic as Dodge/Parry gobble, applied to spell sets
  element.querySelectorAll(".counterspell-gobble-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can alter this spell's dice.");
      const heightToRemove = parseInt(btn.dataset.height);
      await consumeGobbleDie(msg, heightToRemove);
    });
  });

  // F3: ROLL SENSE + EERIE BUTTON — opens roll dialog pre-set for detection check
  element.querySelectorAll(".roll-eerie-detection-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const detectionRadius = btn.dataset.detectionRadius || "Unknown";
      const spellName       = btn.dataset.spellName || "a spell";

      const actor = game.user.character
        || game.actors.find(a => a.type === "character" && a.isOwner);

      if (!actor) {
        return ui.notifications.warn("No owned character found to roll Sense + Eerie.");
      }

      // Open roll dialog pre-set to Sense + Eerie.
      // Pass eerieDetection flag so the dialog banner and result can note
      // that any match succeeds — no Width or Height threshold.
      await CharacterRoller.rollCharacter(actor, {
        type: "skill",
        key: "eerie",
        label: "Sense + Eerie (Detection)",
        defaultAttr: "sense",
        eerieDetection: true,
        eerieDetectionRadius: detectionRadius,
        eerieSpellName: spellName
      });
    });
  });

  // G2: POISON — Resist buttons on poison chat cards
  element.querySelectorAll(".poison-resist-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!game.user.isGM && !msg?.isAuthor) return;
      const resistType = btn.dataset.resistType || "vigor";
      const targetIds = btn.dataset.targetIds || "";
      const difficulty = parseInt(btn.dataset.difficulty) || 0;
      await handlePoisonResist(resistType, targetIds, difficulty);
    });
  });

  // G2: VENOM — Resist buttons on creature venom chat cards (unified handler)
  element.querySelectorAll(".venom-resist-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const resistType = btn.dataset.resistType || "vigor";
      const targetId = btn.dataset.targetId || "";
      await handlePoisonResist(resistType, targetId, 0);
    });
  });

  // ── BATCH C ITEM-11: Re-roll last ↺ ──────────────────────────────────────
  // Reads lastRollContext from the rolling actor's flags and re-runs the
  // identical dice pool without opening the dialog.
  element.querySelectorAll(".reign-reroll-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg?.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the rolling player or GM can re-roll this.");
      const actorId = msg?.speaker?.actor;
      const actor = actorId ? game.actors.get(actorId) : null;
      if (!actor) return ui.notifications.warn("Cannot find the rolling character.");
      const context = actor.getFlag("reign", "lastRollContext");
      if (!context) return ui.notifications.warn("No previous roll context found for this character.");
      await CharacterRoller.reroll(actor, context);
    });
  });

  // ── BATCH C ITEM-2: Pin escape roll ──────────────────────────────────────
  // Opens a Body+Fight dialog for the pinned character with difficulty pre-set
  // to max(attackerBody, attackerFight) per RAW Ch7.
  element.querySelectorAll(".attempt-escape-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const attackerBody  = parseInt(btn.dataset.attackerBody)  || 0;
      const attackerFight = parseInt(btn.dataset.attackerFight) || 0;
      const difficulty = Math.max(attackerBody, attackerFight);

      // Resolve the pinned character — whoever clicks this is the defender
      const actor = game.user.character
        ?? canvas.tokens?.controlled?.[0]?.actor
        ?? game.actors.find(a => a.type === "character" && a.isOwner);
      if (!actor) return ui.notifications.warn("No character found. Select your token first.");

      await CharacterRoller.rollCharacter(actor, {
        type: "skill",
        key: "fight",
        label: "Escape Pin",
        defaultAttr: "body",
        difficulty
      });
    });
  });

});

Hooks.on("preCreateItem", (item, data, options, userId) => {
  if (game.user.id !== userId) return;
  if (item.parent?.type !== "character") return;
  
  if (item.type === "problem") {
      const currentProblems = item.parent.items.filter(i => i.type === "problem").length;
      if (currentProblems >= 3) {
          ui.notifications.error("A character cannot have more than 3 Problems (RAW Ch 2).");
          return false;
      }
  }

  if (item.type !== "technique" && item.type !== "discipline") return;

  // RAW Ch2 p.21: No character can know more than 15 Martial Techniques or 15 Esoteric Disciplines.
  const MAX_PER_TYPE = 15;
  const currentCount = item.parent.items.filter(i => i.type === item.type).length;
  const typeLabel = item.type === "technique" ? "Martial Techniques" : "Esoteric Disciplines";
  if (currentCount >= MAX_PER_TYPE) {
      ui.notifications.error(`Cannot add — already at the maximum of ${MAX_PER_TYPE} ${typeLabel} (RAW Ch 2).`);
      return false;
  }

  const sys = data.system || item.system;
  const pathName = sys?.path?.trim();
  const rank = parseInt(sys?.rank) || 1;
  const itemName = data.name || item.name || "Unnamed Item";

  // Prerequisite validation: must know all lower ranks in the same path
  if (pathName && rank > 1) {
    const existingItems = item.parent.items.filter(i => 
      i.type === item.type && 
      i.system.path?.trim().toLowerCase() === pathName.toLowerCase()
    );

    for (let requiredRank = 1; requiredRank < rank; requiredRank++) {
      const hasRequiredRank = existingItems.some(i => parseInt(i.system.rank) === requiredRank);
      
      if (!hasRequiredRank) {
        ui.notifications.error(`Cannot add "${itemName}". You are missing Rank ${requiredRank} of the "${pathName}" path. Prerequisites not met.`);
        return false; 
      }
    }
  }

  // RAW Ch3 p.38: XP cost = rank. Only enforce outside of character creation mode.
  if (!item.parent.system.creationMode && !options.reignSkipXP) {
      const xpCost = rank;
      const unspent = item.parent.system.xp?.value || 0;
      if (unspent < xpCost) {
          ui.notifications.error(`Insufficient XP to learn "${itemName}". Rank ${rank} costs ${xpCost} XP (you have ${unspent}).`);
          return false;
      }
      // Flag for the createItem hook to deduct XP after successful creation
      options.reignXPCost = xpCost;
  }
});

/**
 * Post-creation XP deduction for Techniques & Disciplines added outside creation mode.
 */
Hooks.on("createItem", async (item, options, userId) => {
  if (game.user.id !== userId) return;
  if (!options.reignXPCost || !item.parent) return;
  
  const xpCost = options.reignXPCost;
  const actor = item.parent;
  const unspent = actor.system.xp?.value || 0;
  
  await actor.update({
      "system.xp.value": unspent - xpCost,
      "system.xp.spent": (actor.system.xp?.spent || 0) + xpCost
  });
  ui.notifications.info(`Spent ${xpCost} XP to learn ${item.name} (Rank ${item.system.rank || 1}).`);
});

Hooks.on("combatStart", async (combat, context) => {
  if (!game.user.isGM) return;
  if (!game.combats.has(combat.id)) return;
  await combat.setFlag("reign", "phase", "declaration");
  const updates = combat.combatants.map(c => ({
    _id: c.id,
    "flags.reign.declared": false,
    initiative: null 
  }));
  if (updates.length > 0) {
    await combat.updateEmbeddedDocuments("Combatant", updates);
  }
});

Hooks.on("updateCombatant", async (combatant, changes, context, userId) => {
  if (!game.user.isGM) return;
  const combat = combatant.combat;
  if (!combat || !game.combats.has(combat.id)) return;

  if (combat.getFlag("reign", "phase") === "declaration" && foundry.utils.hasProperty(changes, "flags.reign.declared")) {
      const allDeclared = combat.combatants.filter(c => c.getFlag("reign", "declared")).length === combat.combatants.size;
      if (allDeclared && combat.combatants.size > 0) {
          await combat.setFlag("reign", "phase", "resolution");
          combat.setupTurns();
      }
  }
});

/**
 * ITEM-8 (Advanced Mode): Opens a structured declaration dialog for the given combatant.
 *
 * The dialog captures:
 *  - A free-text description of the declared action (public, shown in the tracker)
 *  - An action type (No Roll / Attack / Defense / Skill Roll / Multi-action /
 *    Ready Slow Weapon / Complete Slow Spell)
 *  - Context-sensitive sub-fields for each action type
 *
 * On "Confirm (No Roll)": writes declarationText and declarationAction flags,
 *   sets declared = true. No roll dialog is opened.
 * On "Confirm + Roll": writes flags, sets declared, then calls
 *   CharacterRoller.rollCharacter() with the relevant dataset pre-populated.
 *
 * Multi-action: the penalty preview is shown in the dialog, but the player must
 *   match the slot count in the roll dialog's Multi-Actions field manually.
 *   (The roll dialog already manages this math; we avoid touching it here.)
 *
 * @param {Combatant} combatant
 * @param {Combat} combat
 */
/**
 * ITEM-8a: Intermediate pool selector for multi-action declarations.
 *
 * Shown after "Confirm + Roll" when the player has declared multiple actions.
 * Presents each declared action with its computed base pool so the player
 * can choose which single pool to roll. The multi-action penalty is then
 * applied by the roll dialog via the preMultiActions hint.
 *
 * @param {Actor}  actor
 * @param {Array}  actions      — action objects built by extractForm
 * @param {Array}  allSkillOpts — full skill options array for attr lookup
 * @param {number} slotCount    — total number of declared actions
 * @returns {Promise<Object|null>} rollCharacter-compatible dataset, or null if cancelled
 */
async function _openPoolSelectorDialog(actor, actions, allSkillOpts, slotCount) {
  const system = actor.system;

  function describePool(action) {
    if (action.type === "attack") {
      const weapon = actor.items.get(action.itemId);
      if (!weapon) return "—";
      return weapon.system.pool || "—";
    }
    if (action.type === "defense") {
      const attrKey  = action.subtype === "dodge" ? "coordination" : "body";
      const attrVal  = parseInt(system.attributes?.[attrKey]?.value) || 0;
      const skillVal = parseInt(system.skills?.[action.subtype]?.value) || 0;
      const attrLabel = attrKey.charAt(0).toUpperCase() + attrKey.slice(1);
      return `${attrLabel} ${attrVal} + ${action.label} ${skillVal} = ${attrVal + skillVal}d`;
    }
    if (action.type === "skill") {
      const opt     = allSkillOpts.find(s => s.value === action.skillKey);
      const attrKey = opt?.attr || "none";
      const attrVal = attrKey !== "none" ? (parseInt(system.attributes?.[attrKey]?.value) || 0) : 0;
      let skillVal  = 0;
      const skey    = action.skillKey || "";
      if (skey.startsWith("static_"))      skillVal = parseInt(system.skills?.[skey.replace("static_", "")]?.value) || 0;
      else if (skey.startsWith("custom_")) skillVal = parseInt(system.customSkills?.[skey.replace("custom_", "")]?.value) || 0;
      else if (skey.startsWith("esoterica_")) skillVal = parseInt(system.esoterica?.sorcery) || 0;
      const attrLabel = attrKey !== "none" ? attrKey.charAt(0).toUpperCase() + attrKey.slice(1) : "";
      return `${attrLabel} ${attrVal} + ${action.label} ${skillVal} = ${attrVal + skillVal}d`;
    }
    return "—";
  }

  const radioHtml = actions.map((action, i) => {
    const poolDesc = describePool(action);
    return `
      <div class="form-group" style="margin-bottom:0.4rem">
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
          <input type="radio" name="poolChoice" value="${i}" ${i === 0 ? "checked" : ""}/>
          <span>
            <strong>${foundry.utils.escapeHTML(action.label)}</strong>
            <span class="reign-text-muted reign-text-small"> — ${foundry.utils.escapeHTML(poolDesc)}</span>
          </span>
        </label>
      </div>`;
  }).join("");

  const content = `
    <form class="reign-dialog-form">
      <p class="reign-text-small reign-text-muted reign-mb-small">
        <i class="fas fa-info-circle"></i>
        ${slotCount} declared actions — pool penalty −${slotCount - 1}d.
        Each set from this roll can be assigned to one action during resolution.
        The roll dialog will open with Multi-Actions pre-set to ${slotCount}.
      </p>
      <hr class="reign-divider"/>
      ${radioHtml}
    </form>`;

  const choiceIndex = await reignDialog(
    "Multi-action — Choose Pool",
    content,
    null,
    {
      width: 420,
      buttons: [{
        action: "confirm",
        label: "Roll This Pool",
        default: true,
        callback: (e, b, d) => {
          const checked = d.element.querySelector('[name="poolChoice"]:checked');
          return checked !== null ? parseInt(checked.value) : 0;
        }
      }]
    }
  );

  if (choiceIndex === null || choiceIndex === undefined) return null;

  const chosen = actions[choiceIndex];
  if (!chosen) return null;

  // Convert the chosen action into a rollCharacter-compatible dataset
  const opt     = allSkillOpts.find(s => s.value === chosen.skillKey);
  const attrKey = opt?.attr || "none";

  if (chosen.type === "attack") {
    const weapon = actor.items.get(chosen.itemId);
    return weapon ? { type: "item", key: chosen.itemId, label: weapon.name } : null;
  }
  if (chosen.type === "defense") {
    const attr = chosen.subtype === "dodge" ? "coordination" : "body";
    return { type: "skill", key: chosen.subtype, label: chosen.label, defaultAttr: attr };
  }
  if (chosen.type === "skill") {
    const skey = chosen.skillKey || "";
    if (skey.startsWith("static_"))      return { type: "skill",       key: skey.replace("static_", ""),  label: chosen.label, defaultAttr: attrKey };
    if (skey.startsWith("custom_"))      return { type: "customSkill", key: skey.replace("custom_", ""),  label: chosen.label, defaultAttr: attrKey };
    if (skey.startsWith("esoterica_"))   return { type: "esoterica",   key: "sorcery",                    label: chosen.label, defaultAttr: "knowledge" };
  }
  return null;
}

/**
 * ITEM-8 (Advanced Mode): Opens a structured declaration dialog for the given combatant.
 *
 * Supports character, creature (threat+creatureMode), and mob (threat) actors.
 * On "Confirm (No Roll)": writes declarationText and declarationAction flags, sets declared.
 * On "Confirm + Roll":
 *   - Characters: opens CharacterRoller. Multi-action first shows the pool selector (8a).
 *   - Creatures:  calls actor.sheet._rollCreaturePool() with the selected attack/skill.
 *   - Mobs:       calls ThreatRoller.rollThreat().
 *
 * @param {Combatant} combatant
 * @param {Combat}    combat
 */
async function _openDeclarationDialog(combatant, combat) {
  const actor = combatant.actor;
  if (!actor) return;

  if (!game.user.isGM && !combatant.isOwner) {
    return ui.notifications.warn("You do not have permission to declare for this combatant.");
  }

  // ── Actor type flags ──────────────────────────────────────────────────────
  const isCharacter = actor.type === "character";
  const isCreature  = actor.type === "threat" && !!actor.system.creatureMode;
  const isMob       = actor.type === "threat" && !actor.system.creatureMode;

  // ── Context ───────────────────────────────────────────────────────────────
  const system = actor.system;

  // Characters use item-based weapons; creatures use creatureAttacks; mobs don't use items.
  const equippedWeapons  = isCharacter ? actor.items.filter(i => i.type === "weapon" && i.system.equipped) : [];
  const creatureAttacks  = isCreature  ? (system.creatureAttacks || []) : [];

  const weaponCooldown       = combatant.getFlag("reign", "slowCooldown") ?? -1;
  const slowWeaponsInCooldown = equippedWeapons.filter(
    w => (w.system.qualities?.slow ?? 0) > 0 && game.combat.round <= weaponCooldown
  );

  const activeCast     = combatant.getFlag("reign", "activeCast");
  const canCompleteCast = !!(activeCast && game.combat?.round >= activeCast.round);

  // ── Character skill option lists ──────────────────────────────────────────
  const staticSkillOpts = Object.entries(skillAttrMap)
    .map(([key, attr]) => ({
      value: `static_${key}`,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " / "),
      attr
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const customSkillOpts = Object.entries(system.customSkills || {}).map(([id, sk]) => ({
    value: `custom_${id}`,
    label: sk.customLabel || "Custom Skill",
    attr: sk.attribute || "none"
  }));

  const hasEsoterica   = (parseInt(system.esoterica?.sorcery) || 0) > 0 || !!system.esoterica?.schoolName;
  const esotericaLabel = system.esoterica?.schoolName || "Sorcery";

  const allSkillOpts = [
    ...staticSkillOpts,
    ...customSkillOpts,
    ...(hasEsoterica ? [{ value: "esoterica_sorcery", label: esotericaLabel, attr: "knowledge" }] : [])
  ];

  const skillAttrLookup = {};
  for (const opt of allSkillOpts) skillAttrLookup[opt.value] = opt.attr;

  // ── HTML option strings ───────────────────────────────────────────────────
  const attrLabels = {
    body: "Body", coordination: "Coordination", sense: "Sense",
    knowledge: "Knowledge", command: "Command", charm: "Charm"
  };

  const weaponOptionsHtml = equippedWeapons.length > 0
    ? equippedWeapons.map(w => `<option value="${w.id}">${foundry.utils.escapeHTML(w.name)}</option>`).join("")
    : `<option value="">— No weapons equipped —</option>`;

  const slowWeaponOptionsHtml = slowWeaponsInCooldown.length > 0
    ? slowWeaponsInCooldown.map(w => `<option value="${w.id}">${foundry.utils.escapeHTML(w.name)}</option>`).join("")
    : `<option value="">— No slow weapons in cooldown —</option>`;

  const skillOptionsHtml = allSkillOpts
    .map(s => `<option value="${s.value}">${foundry.utils.escapeHTML(s.label)}</option>`)
    .join("");

  const attrOptionsHtml = Object.entries(attrLabels)
    .map(([k, l]) => `<option value="${k}">${l}</option>`)
    .join("");

  // Creature attack selector
  const creatureAttackOptionsHtml = creatureAttacks.length > 0
    ? creatureAttacks.map((atk, i) =>
        `<option value="${i}">${foundry.utils.escapeHTML(atk.name)} (${atk.attribute}+${atk.skill || "—"})</option>`
      ).join("")
    : `<option value="">— No attacks defined —</option>`;

  // Creature skill selectors
  const creatureSkillOptionsHtml = Object.entries(system.creatureSkills || {})
    .map(([key, sk]) => {
      const val = typeof sk === "object" ? (sk.value ?? 0) : sk;
      return `<option value="${key}">${foundry.utils.escapeHTML(key)} (${val})</option>`;
    }).join("") || `<option value="">— No skills defined —</option>`;

  const creatureAttrOptionsHtml = Object.entries(system.creatureAttributes || {})
    .map(([key, val]) => `<option value="${key}">${foundry.utils.escapeHTML(key)} (${val})</option>`)
    .join("") || `<option value="">— No attributes defined —</option>`;

  // ── Multi-action slot builder (characters only) ───────────────────────────
  function buildSlotHtml(n) {
    const removeBtn = n > 2
      ? `<a class="remove-slot reign-text-danger" data-slot="${n}" title="Remove action" style="cursor:pointer;margin-left:4px"><i class="fas fa-times"></i></a>`
      : "";
    return `
      <div class="decl-multi-slot reign-mt-small" data-slot="${n}">
        <div class="flexrow reign-gap-small" style="align-items:center">
          <span class="reign-text-small reign-text-muted" style="min-width:5rem">Action ${n}:</span>
          <select name="slotType_${n}" data-slot="${n}" class="slot-type-select">
            <option value="attack">Attack</option>
            <option value="defense">Defense</option>
            <option value="skill">Skill Roll</option>
          </select>
          ${removeBtn}
        </div>
        <div class="slot-fields reign-ml-small reign-mt-small">
          <div class="form-group flexrow" data-slotfield="attack_${n}">
            <label class="reign-col-2 reign-text-small">Weapon</label>
            <select name="slotWeapon_${n}" class="reign-col-3">${weaponOptionsHtml}</select>
          </div>
          <div class="form-group flexrow" data-slotfield="defense_${n}" style="display:none">
            <label class="reign-col-2 reign-text-small">Type</label>
            <select name="slotDefense_${n}" class="reign-col-3">
              <option value="dodge">Dodge</option>
              <option value="parry">Parry</option>
            </select>
          </div>
          <div class="form-group flexrow" data-slotfield="skill_${n}" style="display:none">
            <label class="reign-col-2 reign-text-small">Skill</label>
            <select name="slotSkill_${n}" class="slot-skill-select reign-col-3" data-slot="${n}">${skillOptionsHtml}</select>
          </div>
        </div>
      </div>`;
  }

  // ── Action type dropdown options (actor-type aware) ───────────────────────
  let actionTypeOptionsHtml = `<option value="noroll">No Roll / Narrative</option>`;
  if (isCharacter || (isCreature && creatureAttacks.length > 0) || isMob) {
    actionTypeOptionsHtml += `<option value="attack">${isMob ? "Group Attack" : "Attack"}</option>`;
  }
  if (isCharacter || isCreature) {
    actionTypeOptionsHtml += `
      <option value="defense">Defense</option>
      <option value="skill">Skill Roll</option>`;
  }
  if (isCharacter) {
    actionTypeOptionsHtml += `<option value="multi">Multi-action</option>`;
    if (slowWeaponsInCooldown.length > 0) actionTypeOptionsHtml += `<option value="readySlow">Ready Slow Weapon</option>`;
    if (canCompleteCast) actionTypeOptionsHtml += `<option value="completeCast">Complete Slow Spell (${foundry.utils.escapeHTML(activeCast.name)})</option>`;
  }

  // ── Attack sub-field HTML (actor-type aware) ──────────────────────────────
  let attackFieldHtml = "";
  if (isCharacter) {
    attackFieldHtml = `
      <div class="form-group flexrow">
        <label class="reign-col-2">Weapon</label>
        <select name="attackWeapon" class="reign-col-3">${weaponOptionsHtml}</select>
      </div>`;
  } else if (isCreature) {
    attackFieldHtml = `
      <div class="form-group flexrow">
        <label class="reign-col-2">Attack</label>
        <select name="creatureAttack" class="reign-col-3">${creatureAttackOptionsHtml}</select>
      </div>`;
  } else if (isMob) {
    attackFieldHtml = `
      <p class="reign-text-small reign-text-muted">
        <i class="fas fa-users"></i>
        Rolls the full group attack pool (Magnitude + adjustments).
      </p>`;
  }

  // ── Skill sub-field HTML (actor-type aware) ───────────────────────────────
  let skillFieldHtml = "";
  if (isCharacter) {
    skillFieldHtml = `
      <div class="form-group flexrow">
        <label class="reign-col-2">Skill</label>
        <select name="skillKey" id="decl-skill-select" class="reign-col-3">${skillOptionsHtml}</select>
      </div>
      <div class="form-group flexrow">
        <label class="reign-col-2">Stat</label>
        <select name="skillAttr" id="decl-skill-attr" class="reign-col-3">${attrOptionsHtml}</select>
      </div>`;
  } else if (isCreature) {
    skillFieldHtml = `
      <div class="form-group flexrow">
        <label class="reign-col-2">Skill</label>
        <select name="creatureSkill" class="reign-col-3">${creatureSkillOptionsHtml}</select>
      </div>
      <div class="form-group flexrow">
        <label class="reign-col-2">Attribute</label>
        <select name="creatureAttr" class="reign-col-3">${creatureAttrOptionsHtml}</select>
      </div>`;
  }

  // ── Dialog content ────────────────────────────────────────────────────────
  const content = `
    <form class="reign-dialog-form">

      <div class="form-group flexrow reign-mb-small">
        <label class="reign-col-2">Declaration</label>
        <input type="text" name="declarationText" class="reign-col-3"
          placeholder="Describe your action…" autocomplete="off"/>
      </div>

      <div class="form-group flexrow reign-mb-small">
        <label class="reign-col-2">Action Type</label>
        <select name="actionType" id="decl-action-type" class="reign-col-3">
          ${actionTypeOptionsHtml}
        </select>
      </div>

      <hr class="reign-divider"/>

      <!-- Attack -->
      <div class="decl-fields" id="decl-attack" style="display:none">
        ${attackFieldHtml}
      </div>

      <!-- Defense -->
      <div class="decl-fields" id="decl-defense" style="display:none">
        <div class="form-group flexrow">
          <label class="reign-col-2">Type</label>
          <select name="defenseType" class="reign-col-3">
            <option value="dodge">Dodge</option>
            <option value="parry">Parry</option>
          </select>
        </div>
      </div>

      <!-- Skill Roll -->
      <div class="decl-fields" id="decl-skill" style="display:none">
        ${skillFieldHtml}
      </div>

      <!-- Multi-action (characters only) -->
      ${isCharacter ? `
      <div class="decl-fields" id="decl-multi" style="display:none">
        <div id="multi-slot-container">
          ${buildSlotHtml(1)}
          ${buildSlotHtml(2)}
        </div>
        <div class="flexrow reign-mt-small reign-gap-small" style="align-items:center">
          <a id="add-slot-btn" style="cursor:pointer" class="reign-text-small">
            <i class="fas fa-plus"></i> Add Action
          </a>
          <span id="multi-penalty-preview" class="reign-text-small reign-text-muted"></span>
        </div>
        <p class="reign-text-small reign-text-muted reign-mt-small">
          <i class="fas fa-info-circle"></i>
          You will choose which pool to roll after confirming. Sets are assigned to actions during resolution.
        </p>
      </div>` : ""}

      <!-- Ready Slow Weapon (characters only) -->
      ${isCharacter ? `
      <div class="decl-fields" id="decl-readySlow" style="display:none">
        <div class="form-group flexrow">
          <label class="reign-col-2">Weapon</label>
          <select name="slowWeapon" class="reign-col-3">${slowWeaponOptionsHtml}</select>
        </div>
        <p class="reign-text-small reign-text-muted">
          <i class="fas fa-clock"></i> This round is spent readying. No roll required.
        </p>
      </div>` : ""}

      <!-- Complete Slow Spell (characters only) -->
      ${isCharacter && canCompleteCast ? `
      <div class="decl-fields" id="decl-completeCast" style="display:none">
        <p class="reign-text-small">
          <i class="fas fa-magic reign-text-magic"></i>
          <strong>${foundry.utils.escapeHTML(activeCast.name)}</strong> is ready to release this round.
          Click <em>Confirm + Roll</em> to cast.
        </p>
      </div>` : ""}

    </form>`;

  // ── Form data extraction (shared by both button callbacks) ────────────────
  function extractForm(el) {
    const f = el.querySelector("form");
    const actionType      = f.querySelector('[name="actionType"]')?.value || "noroll";
    const declarationText = f.querySelector('[name="declarationText"]')?.value?.trim() || "";
    const actions = [];
    let primaryDataset = null;

    if (actionType === "attack") {
      if (isCharacter) {
        const itemId = f.querySelector('[name="attackWeapon"]')?.value || "";
        const weapon = actor.items.get(itemId);
        actions.push({ type: "attack", itemId, label: weapon?.name || "Attack" });
        if (weapon) primaryDataset = { type: "item", key: itemId, label: weapon.name };

      } else if (isCreature) {
        const atkIdx = parseInt(f.querySelector('[name="creatureAttack"]')?.value) || 0;
        const atk    = creatureAttacks[atkIdx];
        if (atk) {
          actions.push({ type: "creatureAttack", attackIndex: atkIdx, label: atk.name });
          primaryDataset = {
            type: "creature",
            attrKey:  atk.attribute || "body",
            skillKey: atk.skill || "",
            label:    atk.name,
            itemData: {
              name: atk.name, type: "weapon",
              system: { damage: atk.damage, qualities: { slow: atk.isSlow || 0 } }
            }
          };
        }

      } else if (isMob) {
        actions.push({ type: "mobAttack", label: "Group Attack" });
        primaryDataset = { type: "mob", label: "Group Attack" };
      }

    } else if (actionType === "defense") {
      const defType = f.querySelector('[name="defenseType"]')?.value || "dodge";
      const label   = defType === "dodge" ? "Dodge" : "Parry";
      const attr    = defType === "dodge" ? "coordination" : "body";
      actions.push({ type: "defense", subtype: defType, label });
      primaryDataset = { type: "skill", key: defType, label, defaultAttr: attr };

    } else if (actionType === "skill") {
      if (isCharacter) {
        const skillVal = f.querySelector('[name="skillKey"]')?.value  || "none";
        const attrVal  = f.querySelector('[name="skillAttr"]')?.value || "none";
        const skillOpt = allSkillOpts.find(s => s.value === skillVal);
        const label    = skillOpt?.label || "Skill Roll";
        actions.push({ type: "skill", skillKey: skillVal, attr: attrVal, label });
        if (skillVal.startsWith("static_"))      primaryDataset = { type: "skill",       key: skillVal.replace("static_", ""),  label, defaultAttr: attrVal };
        else if (skillVal.startsWith("custom_")) primaryDataset = { type: "customSkill", key: skillVal.replace("custom_", ""),  label, defaultAttr: attrVal };
        else if (skillVal.startsWith("esoterica_")) primaryDataset = { type: "esoterica", key: "sorcery",                       label, defaultAttr: attrVal };

      } else if (isCreature) {
        const skillKey = f.querySelector('[name="creatureSkill"]')?.value || "";
        const attrKey  = f.querySelector('[name="creatureAttr"]')?.value  || "body";
        const label    = skillKey ? `${skillKey} (${attrKey})` : "Skill Roll";
        actions.push({ type: "creatureSkill", skillKey, attrKey, label });
        primaryDataset = { type: "creature", attrKey, skillKey, label };
      }

    } else if (actionType === "multi") {
      // Characters only — slot builder
      const slotEls = [...(f.querySelector("#multi-slot-container")?.querySelectorAll(".decl-multi-slot") || [])];
      for (const slot of slotEls) {
        const n        = slot.dataset.slot;
        const slotType = slot.querySelector(`[name="slotType_${n}"]`)?.value || "attack";
        if (slotType === "attack") {
          const itemId = slot.querySelector(`[name="slotWeapon_${n}"]`)?.value || "";
          const weapon = actor.items.get(itemId);
          actions.push({ type: "attack", itemId, label: weapon?.name || "Attack" });
        } else if (slotType === "defense") {
          const defType = slot.querySelector(`[name="slotDefense_${n}"]`)?.value || "dodge";
          const label   = defType === "dodge" ? "Dodge" : "Parry";
          const attr    = defType === "dodge" ? "coordination" : "body";
          actions.push({ type: "defense", subtype: defType, label });
        } else if (slotType === "skill") {
          const skillVal = slot.querySelector(`[name="slotSkill_${n}"]`)?.value || "none";
          const skillOpt = allSkillOpts.find(s => s.value === skillVal);
          actions.push({ type: "skill", skillKey: skillVal, label: skillOpt?.label || "Skill" });
        }
      }
      // primaryDataset for multi is resolved in the pool selector step after the dialog closes

    } else if (actionType === "readySlow") {
      const itemId = f.querySelector('[name="slowWeapon"]')?.value || "";
      const weapon = actor.items.get(itemId);
      actions.push({ type: "readySlow", itemId, label: `Ready ${weapon?.name || "weapon"}` });

    } else if (actionType === "completeCast" && canCompleteCast) {
      actions.push({ type: "completeCast", itemId: activeCast.itemId, label: activeCast.name });
      primaryDataset = { type: "item", key: activeCast.itemId, label: activeCast.name };
    }

    return { actionType, declarationText, actions, primaryDataset };
  }

  // ── Dialog ────────────────────────────────────────────────────────────────
  const result = await reignDialog(
    `Declare Action — ${foundry.utils.escapeHTML(actor.name)}`,
    content,
    null,
    {
      width: 460,
      buttons: [
        {
          action: "noroll",
          label: "Confirm (No Roll)",
          callback: (e, b, d) => ({ roll: false, ...extractForm(d.element) })
        },
        {
          action: "roll",
          label: "Confirm + Roll",
          default: true,
          callback: (e, b, d) => ({ roll: true, ...extractForm(d.element) })
        }
      ],
      render: (event, el) => {
        const f = el.querySelector("form");
        if (!f) return;

        const actionTypeSelect = f.querySelector("#decl-action-type");
        const allFieldGroups   = f.querySelectorAll(".decl-fields");
        const rollBtn          = el.querySelector('[data-action="roll"]');

        function updateFieldVisibility() {
          const val = actionTypeSelect?.value || "noroll";
          allFieldGroups.forEach(g => g.style.display = "none");
          const target = f.querySelector(`#decl-${val}`);
          if (target) target.style.display = "";
          if (rollBtn) rollBtn.disabled = (val === "noroll" || val === "readySlow");
        }
        actionTypeSelect?.addEventListener("change", updateFieldVisibility);
        updateFieldVisibility();

        // Auto-populate Stat when Skill changes (character only)
        const skillSelect     = f.querySelector("#decl-skill-select");
        const skillAttrSelect = f.querySelector("#decl-skill-attr");
        function syncSkillAttr() {
          const attr = skillAttrLookup[skillSelect?.value];
          if (attr && skillAttrSelect) skillAttrSelect.value = attr;
        }
        skillSelect?.addEventListener("change", syncSkillAttr);
        syncSkillAttr();

        // ── Multi-action slot wiring (characters only) ──────────────────────
        if (!isCharacter) return;

        const slotContainer  = f.querySelector("#multi-slot-container");
        const penaltyPreview = f.querySelector("#multi-penalty-preview");
        const addSlotBtn     = f.querySelector("#add-slot-btn");
        let slotCount = 2;

        function updatePenaltyPreview() {
          if (penaltyPreview) {
            penaltyPreview.textContent = `Pool penalty: −${slotCount - 1}d (${slotCount} actions)`;
          }
        }
        updatePenaltyPreview();

        function wireSlot(n) {
          const slotTypeSelect = f.querySelector(`[name="slotType_${n}"]`);
          if (!slotTypeSelect) return;
          function updateSlotFields() {
            const val  = slotTypeSelect.value;
            const atkF = f.querySelector(`[data-slotfield="attack_${n}"]`);
            const defF = f.querySelector(`[data-slotfield="defense_${n}"]`);
            const sklF = f.querySelector(`[data-slotfield="skill_${n}"]`);
            if (atkF) atkF.style.display = val === "attack"  ? "" : "none";
            if (defF) defF.style.display = val === "defense" ? "" : "none";
            if (sklF) sklF.style.display = val === "skill"   ? "" : "none";
          }
          slotTypeSelect.addEventListener("change", updateSlotFields);
          updateSlotFields();
          const removeBtn = f.querySelector(`.remove-slot[data-slot="${n}"]`);
          if (removeBtn) {
            removeBtn.addEventListener("click", () => {
              const slotEl = slotContainer?.querySelector(`.decl-multi-slot[data-slot="${n}"]`);
              if (slotEl) slotEl.remove();
              slotCount--;
              updatePenaltyPreview();
              if (addSlotBtn && slotCount < 4) addSlotBtn.style.display = "";
            });
          }
        }

        wireSlot(1);
        wireSlot(2);

        addSlotBtn?.addEventListener("click", () => {
          if (slotCount >= 4) return;
          slotCount++;
          slotContainer?.insertAdjacentHTML("beforeend", buildSlotHtml(slotCount));
          wireSlot(slotCount);
          updatePenaltyPreview();
          if (slotCount >= 4 && addSlotBtn) addSlotBtn.style.display = "none";
        });
      }
    }
  );

  if (!result) return;

  // ── Write flags and mark declared ─────────────────────────────────────────
  const { actionType, declarationText, actions, primaryDataset, roll } = result;

  const activeCombat    = game.combats.get(combat.id);
  if (!activeCombat) return;
  const activeCombatant = activeCombat.combatants.get(combatant.id);
  if (!activeCombatant) return;

  await activeCombatant.setFlag("reign", "declared",          true);
  await activeCombatant.setFlag("reign", "declarationText",   declarationText);
  await activeCombatant.setFlag("reign", "declarationAction", {
    type: actionType,
    actions,
    penalty: Math.max(0, actions.length - 1)
  });

  // ── Open roll dialog if requested ─────────────────────────────────────────
  if (roll) {
    if (isCharacter) {
      if (actionType === "multi" && actions.length > 1) {
        // 8a: Pool selector — player picks which pool to roll, then roll dialog opens
        // with Multi-Actions pre-set to the slot count.
        const chosenDataset = await _openPoolSelectorDialog(actor, actions, allSkillOpts, actions.length);
        if (!chosenDataset) return;
        await CharacterRoller.rollCharacter(actor, { ...chosenDataset, preMultiActions: actions.length });
      } else if (primaryDataset) {
        await CharacterRoller.rollCharacter(actor, primaryDataset);
      } else {
        ui.notifications.info(`${actor.name} declared: "${declarationText || actionType}". No roll configured.`);
      }

    } else if (actor.type === "threat") {
      if (isCreature && primaryDataset) {
        // Creature rolls go through the threat sheet's _rollCreaturePool
        await actor.sheet._rollCreaturePool(
          actor,
          primaryDataset.attrKey,
          primaryDataset.skillKey,
          primaryDataset.label,
          primaryDataset.itemData || null
        );
      } else if (isMob) {
        await ThreatRoller.rollThreat(actor, {});
      } else {
        ui.notifications.info(`${actor.name} declared. Roll from the actor sheet.`);
      }

    } else {
      ui.notifications.info(`${actor.name} declared. Roll from the actor sheet.`);
    }
  }
}

Hooks.on("renderCombatTracker", (app, html, context, options) => {
  const combat = game.combat;
  if (!combat) return;

  const element = html instanceof HTMLElement ? html : html[0];
  if (!element) return;

  const phase = combat.getFlag("reign", "phase") || "declaration";
  const isDeclaring = phase === "declaration";
  const isGM = game.user.isGM;

  // CLEANED UI: Styles removed, classes added
  const btnHtml = `
    <div class="reign-combat-phase-control">
      <button class="reign-phase-btn cm-declare-btn" data-phase="declaration">
        <i class="fas fa-eye"></i> Declare
      </button>
      <button class="reign-phase-btn cm-resolve-btn" data-phase="resolution">
        <i class="fas fa-bolt"></i> Resolve
      </button>
    </div>
  `;

  let header = element.querySelector(".combat-tracker-header");
  if (header && !element.querySelector(".reign-combat-phase-control")) {
      header.insertAdjacentHTML('afterend', btnHtml);
      const phaseBtns = element.querySelectorAll(".reign-phase-btn");
      if (isGM) {
          phaseBtns.forEach(btn => {
              btn.addEventListener("click", async (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const activeCombat = game.combats.get(combat.id);
                  if (!activeCombat) return;
                  const newPhase = ev.currentTarget.dataset.phase;
                  if (phase !== newPhase) {
                      await activeCombat.setFlag("reign", "phase", newPhase);
                      activeCombat.setupTurns();
                  }
              });
          });
      } else {
          phaseBtns.forEach(btn => {
              btn.style.cursor = "default";
              btn.disabled = true;
          });
      }
  }

  const decBtn = element.querySelector(".cm-declare-btn");
  const resBtn = element.querySelector(".cm-resolve-btn");

  if (decBtn && resBtn) {
      if (isDeclaring) {
          decBtn.classList.add("active-declare");
          resBtn.classList.remove("active-resolve");
      } else {
          resBtn.classList.add("active-resolve");
          decBtn.classList.remove("active-declare");
      }
  }

  const currentTurn = combat.combatant;
  if (currentTurn && currentTurn.actor) {
      const statuses = Array.from(currentTurn.actor.statuses);
      const penalties = [];
      if (statuses.includes("dazed")) penalties.push("DAZED (−1d)");
      if (statuses.includes("prone")) penalties.push("PRONE (−1d)");
      if (statuses.includes("blind")) penalties.push("BLIND (−2d Ranged / Diff 4 Melee)");
      
      const phaseControl = element.querySelector(".reign-combat-phase-control");
      if (penalties.length > 0 && !element.querySelector(".reign-wound-banner") && phaseControl) {
          // CLEANED UI: Styles removed, classes added
          const bannerHtml = `
            <div class="reign-wound-banner">
                <i class="fas fa-exclamation-triangle"></i> Current Turn Penalties:<br>
                <span>${penalties.join(" | ")}</span>
            </div>
          `;
          phaseControl.insertAdjacentHTML('afterend', bannerHtml);
      }
  }

  const declarationMode = game.settings.get("reign", "declarationMode") || "simple";
  const combatants = element.querySelectorAll(".combatant");
  combatants.forEach(li => {
      const cid = li.dataset.combatantId;
      const c = combat.combatants.get(cid);
      if (!c) return;

      const isDeclared = c.getFlag("reign", "declared") || false;
      const initDiv = li.querySelector(".token-initiative");
      
      if (initDiv) {
          const rollBtn = initDiv.querySelector(".roll");
          if (rollBtn) rollBtn.style.display = "none";

          if (isDeclaring) {

            if (declarationMode === "simple") {
              // ── SIMPLE MODE: current toggle behaviour, unchanged ───────────
              initDiv.innerHTML = `
                <a class="combatant-control reign-declare-btn ${isDeclared ? 'confirmed' : 'pending'}" data-combatant-id="${cid}" title="${isDeclared ? 'Declaration Confirmed' : 'Confirm Declaration'}">
                    <i class="${isDeclared ? 'fas fa-check-circle' : 'far fa-circle'}"></i>
                </a>
              `;
              const declareBtn = initDiv.querySelector(".reign-declare-btn");
              if (declareBtn) {
                  declareBtn.addEventListener("click", async (ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const activeCombat = game.combats.get(combat.id);
                      if (!activeCombat) return;
                      const activeCombatant = activeCombat.combatants.get(cid);
                      if (!activeCombatant) return;
                      if (!isGM && !activeCombatant.isOwner) return ui.notifications.warn("You do not have permission to confirm this combatant's declaration.");
                      await activeCombatant.setFlag("reign", "declared", !isDeclared);
                  });
              }

            } else {
              // ── ADVANCED MODE: declaration dialog ─────────────────────────
              if (isDeclared) {
                const declText  = c.getFlag("reign", "declarationText") || "";
                const shortText = declText.length > 26 ? declText.slice(0, 26) + "…" : declText;
                initDiv.innerHTML = `
                  <a class="combatant-control reign-declare-btn confirmed" data-combatant-id="${cid}"
                     title="${foundry.utils.escapeHTML(declText || 'Declaration Confirmed')}">
                    <i class="fas fa-check-circle"></i>
                    ${shortText ? `<span class="reign-decl-text reign-text-small reign-text-muted">${foundry.utils.escapeHTML(shortText)}</span>` : ""}
                  </a>`;
              } else {
                initDiv.innerHTML = `
                  <button class="reign-declare-dialog-btn" data-combatant-id="${cid}" title="Open Declaration Dialog">
                    <i class="fas fa-scroll"></i> Declare
                  </button>`;
                const dialogBtn = initDiv.querySelector(".reign-declare-dialog-btn");
                if (dialogBtn) {
                  dialogBtn.addEventListener("click", async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const activeCombat = game.combats.get(combat.id);
                    if (!activeCombat) return;
                    const activeCombatant = activeCombat.combatants.get(cid);
                    if (!activeCombatant) return;
                    if (!isGM && !activeCombatant.isOwner) return ui.notifications.warn("You do not have permission to declare for this combatant.");
                    await _openDeclarationDialog(activeCombatant, activeCombat);
                  });
                }
              }
            }

          } else {
              // ISSUE-029 FIX: Display initiative as "W×H" rather than the raw decimal
              // (e.g. "2×10" instead of "210.90") so players can read it at a glance.
              // Encoding: Width*100 + Height + fractional_offset (≤0.99)
              if (Number.isNumeric(c.initiative)) {
                  const initNum = c.initiative;
                  const rawBase = Math.floor(initNum); // e.g. 210 from 210.90
                  const w = Math.floor(rawBase / 100);
                  const h = rawBase % 100;
                  const frac = initNum - rawBase;
                  const isDefence = frac >= 0.9 && frac < 1.0;
                  const isMinion  = initNum < rawBase;
                  const icon = isDefence ? "🛡" : "⚔";
                  if (!initDiv.querySelector(".reign-init-label")) {
                      const span = document.createElement("span");
                      span.className = "reign-init-label";
                      span.title = `Initiative: ${initNum}`;
                      span.textContent = `${w}×${h}${isDefence ? " 🛡" : ""}`;
                      initDiv.appendChild(span);
                  }
              } else if (!initDiv.querySelector(".reign-waiting")) {
                  initDiv.insertAdjacentHTML('beforeend', `<span class="reign-waiting" title="Waiting for action...">--</span>`);
              }
          }
      }
  });
});

Hooks.once("diceSoNiceReady", (dice3d) => {
    dice3d.addColorset({
        name: "reign-blood",
        description: "Reign: Blood & Iron",
        category: "System",
        foreground: "#ffffff",
        background: "#8b1f1f",
        outline: "#222222",
        edge: "#222222",
        texture: "marble",
        material: "metal"
    }, "preferred"); 
});

// Player Access: All users can open the Faction Dashboard.
// GM-only controls (Advance Month, Apply Damage, Chronicle editing) are gated
// inside the dashboard itself. Players can roll for companies they own.
Hooks.on("renderActorDirectory", (app, html, data) => {
  const element = html instanceof HTMLElement ? html : html[0];
  if (!element) return;

  const dashboardBtn = `
    <div class="header-actions action-buttons flexrow reign-mb-small">
        <button class="reign-faction-dashboard-btn reign-btn-dashboard">
            <i class="fas fa-globe"></i> Faction Dashboard
        </button>
    </div>
  `;

  const header = element.querySelector(".directory-header");
  if (header && !element.querySelector(".reign-faction-dashboard-btn")) {
      header.insertAdjacentHTML('beforeend', dashboardBtn);
      
      const btn = element.querySelector(".reign-faction-dashboard-btn");
      if (btn) {
          btn.addEventListener("click", (ev) => {
              ev.preventDefault();
              new FactionDashboard().render(true);
          });
      }
  }
});

// G4: Clear per-combat creature flags when a combat encounter ends.
// These flags are intentionally NOT cleared between rounds — only at combat end:
//   elephantTrumpetUsed  — Morale Attack once per combat (RAW Ch13)
//   chargeRunWidest      — Rhino's accumulated Run Width resets when combat ends
//   freeGobbleDice       — Big Cat free pool (seeded fresh each round by nextRound;
//                          cleared here in case combat ends mid-round with dice remaining)
Hooks.on("deleteCombat", async (combat, options, userId) => {
  if (game.user.id !== userId) return;

  const creatureCombatants = combat.combatants.filter(c => {
    const actor = c.actor;
    return actor?.type === "threat" && actor.system.creatureMode;
  });

  await Promise.all(creatureCombatants.map(async combatant => {
    const actor = combatant.actor;
    if (!actor) return;

    const updates = {};
    if (actor.getFlag("reign", "elephantTrumpetUsed")) updates["flags.reign.-=elephantTrumpetUsed"] = null;
    if (actor.getFlag("reign", "freeGobbleDice"))      updates["flags.reign.-=freeGobbleDice"]      = null;

    // chargeRunWidest lives in system data, not a flag — reset via system update
    const chargeWidth = actor.system.creatureFlags?.chargeRunWidest || 0;
    const constrictActive = actor.system.creatureFlags?.constrictActive || false;

    const systemUpdates = {};
    if (chargeWidth > 0)     systemUpdates["system.creatureFlags.chargeRunWidest"] = 0;
    if (constrictActive) {
      systemUpdates["system.creatureFlags.constrictActive"]   = false;
      systemUpdates["system.creatureFlags.constrictTargetId"] = "";
      // Release any pinned target
      const targetId = actor.system.creatureFlags.constrictTargetId;
      if (targetId) {
        const targetActor = game.actors.get(targetId);
        if (targetActor) await targetActor.toggleStatusEffect("restrained", { active: false });
      }
    }

    if (!foundry.utils.isEmpty(updates))       await actor.update(updates);
    if (!foundry.utils.isEmpty(systemUpdates)) await actor.update(systemUpdates);
  }));
});

// ==========================================
// F4: QUICK DICE ROLLER — Chat Sidebar Button
// ==========================================
// A standalone ORE dice roller accessible from the chat controls bar.
// Rolls an arbitrary d10 pool through the ORE engine and posts a full
// chat card with sets, waste, and optional Expert/Master dice — without
// requiring a character sheet to be open.

/**
 * Opens the Quick Dice Roller dialog and posts the result to chat.
 */
async function openQuickDiceRoller() {
  const content = `
    <div class="reign-dialog-pool-preview">
      Expected Pool: <span id="qr-pool-value" class="reign-pool-value">...</span>
    </div>
    <form class="reign-dialog-form">
      <div class="form-group">
        <label>${game.i18n.localize("REIGN.QRLabel")}:</label>
        <input type="text" name="label" value="" placeholder="${game.i18n.localize("REIGN.QRLabelPlaceholder")}"/>
      </div>
      <div class="dialog-grid dialog-grid-2">
        <div class="form-group">
          <label>${game.i18n.localize("REIGN.QRPoolSize")}:</label>
          <input type="number" name="poolSize" value="4" min="1" max="20"/>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("REIGN.QRDifficulty")}:</label>
          <input type="number" name="difficulty" value="0" min="0" max="10"/>
        </div>
      </div>
      <div class="dialog-grid dialog-grid-2">
        <div class="form-group">
          <label>${game.i18n.localize("REIGN.QRBonusDice")}:</label>
          <input type="number" name="bonus" value="0" min="0"/>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("REIGN.QRPenaltyDice")}:</label>
          <input type="number" name="penalty" value="0" min="0"/>
        </div>
      </div>
      <div class="dialog-grid dialog-grid-2 reign-dialog-section">
        <div class="form-group">
          <label>${game.i18n.localize("REIGN.QRExpertDie")}:</label>
          <input type="number" name="ed" value="0" min="0" max="10"/>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("REIGN.QRMasterDie")}:</label>
          <input type="checkbox" name="md" value="1"/>
        </div>
      </div>
    </form>
  `;

  const rollData = await reignDialog(
    game.i18n.localize("REIGN.QRTitle"),
    content,
    (e, b, d) => {
      const f = d.element.querySelector("form");
      return {
        label:    f.querySelector('[name="label"]')?.value?.trim() || game.i18n.localize("REIGN.QRDefaultLabel"),
        poolSize: Math.max(1, parseInt(f.querySelector('[name="poolSize"]')?.value) || 1),
        difficulty: parseInt(f.querySelector('[name="difficulty"]')?.value) || 0,
        bonus:    parseInt(f.querySelector('[name="bonus"]')?.value) || 0,
        penalty:  parseInt(f.querySelector('[name="penalty"]')?.value) || 0,
        ed:       parseInt(f.querySelector('[name="ed"]')?.value) || 0,
        md:       f.querySelector('[name="md"]')?.checked ? 1 : 0
      };
    },
    {
      defaultLabel: game.i18n.localize("REIGN.QRRollButton"),
      width: 380,
      render: (event, html) => {
        const element = event?.target?.element ?? (event instanceof HTMLElement ? event : null);
        if (!element) return;

        const f = element.querySelector("form");
        const poolPreview = element.querySelector("#qr-pool-value");
        if (!f || !poolPreview) return;

        const updatePreview = () => {
          const poolSize = Math.max(1, parseInt(f.querySelector('[name="poolSize"]')?.value) || 1);
          const bonus    = parseInt(f.querySelector('[name="bonus"]')?.value) || 0;
          const penalty  = parseInt(f.querySelector('[name="penalty"]')?.value) || 0;
          const ed       = parseInt(f.querySelector('[name="ed"]')?.value) || 0;
          const md       = f.querySelector('[name="md"]')?.checked ? 1 : 0;

          const rawTotal = poolSize + bonus;
          const poolMath = calculateOREPool(rawTotal, ed, md, 0, penalty, 1, true);

          if (poolMath.diceToRoll < 1) {
            poolPreview.innerHTML = `<span class="reign-text-danger">${game.i18n.localize("REIGN.QRPoolTooLow")}</span>`;
          } else {
            let display = `${poolMath.normalDiceCount}d10`;
            if (poolMath.actualEd > 0) display += ` <span class="reign-text-info">+ 1 ED (${poolMath.finalEdFace})</span>`;
            if (poolMath.actualMd > 0) display += ` <span class="reign-text-magic">+ 1 MD</span>`;
            if (poolMath.wasCapped) display += ` <span class="reign-text-small reign-text-muted">(Capped at 10)</span>`;
            poolPreview.innerHTML = display;
          }
        };

        f.querySelectorAll("input").forEach(input => {
          input.addEventListener("input", updatePreview);
          input.addEventListener("change", updatePreview);
        });
        updatePreview();
      }
    }
  );

  if (!rollData) return;

  // --- Calculate the final pool ---
  const rawTotal = rollData.poolSize + rollData.bonus;
  const poolMath = calculateOREPool(rawTotal, rollData.ed, rollData.md, 0, rollData.penalty, 1, true);

  if (poolMath.diceToRoll < 1) {
    return ui.notifications.warn(game.i18n.localize("REIGN.QRPoolTooLow"));
  }

  // --- Roll the normal dice ---
  let results = [];
  let actualRoll = null;

  if (poolMath.normalDiceCount > 0) {
    actualRoll = new Roll(`${poolMath.normalDiceCount}d10`);
    await actualRoll.evaluate();
    results = actualRoll.dice[0]?.results.map(r => r.result) || [];
  }

  if (poolMath.actualEd > 0) results.push(poolMath.finalEdFace);

  // --- Handle Master Die assignment ---
  if (poolMath.actualMd > 0) {
    results.sort((a, b) => b - a);
    const mdHtml = `<form class="reign-dialog-form">
      <p class="reign-text-large reign-mb-small reign-mt-0"><strong>${game.i18n.localize("REIGN.QRMDYourRoll")}:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
      <p class="reign-text-small reign-text-muted reign-mb-medium">${game.i18n.localize("REIGN.QRMDAssign")}</p>
      <div class="form-group">
        <label>MD Face:</label>
        <input type="number" id="qrMdFace" value="10" min="1" max="10"/>
      </div>
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

  // --- Determine the speaker ---
  // Use the currently selected token/assigned character if available, otherwise the user.
  const speakerActor = canvas?.tokens?.controlled?.[0]?.actor
    || game.user.character
    || null;
  const speaker = speakerActor
    ? ChatMessage.getSpeaker({ actor: speakerActor })
    : ChatMessage.getSpeaker({ user: game.user });

  // --- Generate the ORE chat card ---
  const actorType = speakerActor?.type || "character";
  const flavor = await generateOREChatHTML(
    actorType,
    foundry.utils.escapeHTML(rollData.label),
    poolMath.diceToRoll,
    results,
    poolMath.actualEd > 0 ? poolMath.finalEdFace : 0,
    poolMath.actualMd,
    null,   // no item
    { difficulty: rollData.difficulty }  // flags
  );

  const messageData = {
    speaker,
    content: flavor
  };
  if (actualRoll) messageData.rolls = [actualRoll];

  await ChatMessage.create(messageData);
}

// Inject the Quick Dice Roller button into the Chat sidebar controls.
// V14 compatibility: the ChatLog may be ApplicationV1 or V2 depending on the
// Foundry build, so we try multiple hooks and a direct DOM query on ready.

function _injectQuickRollerButton() {
  // Already injected?
  if (document.querySelector(".reign-quick-roller-btn")) return;

  // Find the chat controls row — try several known V14 selectors
  const chatControls = document.querySelector("#chat-controls")
    || document.querySelector("#chat .chat-control-icon")?.parentElement
    || document.querySelector("#chat form")?.previousElementSibling
    || document.querySelector('[data-tab="chat"] #chat-controls');
  if (!chatControls) return;

  const btn = document.createElement("a");
  btn.className = "reign-quick-roller-btn";
  btn.title = game.i18n.localize("REIGN.QRTitle");
  btn.innerHTML = `<svg viewBox="0 0 20 24" width="14" height="17" style="fill:currentColor;"><polygon points="10,0 20,12 10,24 0,12"/><text x="10" y="14" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff" font-family="sans-serif">10</text></svg><span class="reign-qr-label">ORE</span>`;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    openQuickDiceRoller();
  });

  chatControls.prepend(btn);
}

// Primary: fire on ChatLog render (ApplicationV1 builds)
Hooks.on("renderChatLog", () => {
  setTimeout(_injectQuickRollerButton, 50);
});

// Fallback: fire when the sidebar tab changes to chat
Hooks.on("changeSidebarTab", (app) => {
  if (app.tabName === "chat" || app.options?.id === "chat" || app.id === "chat") {
    setTimeout(_injectQuickRollerButton, 50);
  }
});

// Last resort: inject once the game is fully ready
Hooks.once("ready", () => {
  setTimeout(_injectQuickRollerButton, 500);
});