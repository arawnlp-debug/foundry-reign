/**
 * Reign: Realities of Lords and Leaders
 * Targeted for Foundry VTT v14+ (ApplicationV2)
 */

import { ReignActorSheet } from "./sheets/character-sheet.js";
import { ReignCompanySheet } from "./sheets/company-sheet.js";
import { ReignThreatSheet } from "./sheets/threat-sheet.js";
import { ReignItemSheet } from "./sheets/item-sheet.js";
import { generateOREChatHTML, applyItemEffectsToTargets, assignGobbleSet, postOREChat } from "./helpers/chat.js";
import { applyDamageToTarget, applyScatteredDamageToTarget, applyHealingToTarget, applyFirstAidToTarget, applyOffensiveMoraleAttack } from "./combat/damage.js";
import { applyCompanyDamageToTarget } from "./combat/company-damage.js";
import { consumeGobbleDie, diveForCover } from "./combat/defense.js";
import { ReignCombat } from "./combat/ore-combat.js";
import { parseORE, calculateInitiative } from "./helpers/ore-engine.js";
import { CharacterRoller } from "./helpers/character-roller.js";
import { ReignCharactermancer } from "./generators/charactermancer.js";
import { ReignCompanymancer } from "./generators/companymancer.js";
import { FactionDashboard } from "./apps/faction-dashboard.js";

import { migrateWorld } from "./system/migration.js";
import * as models from "./system/models.js";

const { DialogV2 } = foundry.applications.api;

Hooks.once("init", async () => {
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

  // --- PACKAGE E: POST-COMBAT RECOVERY ---
  game.settings.register("reign", "postCombatRecovery", {
    name: "Post-Combat Shock Recovery",
    hint: "How much Shock damage sustained during a fight is recovered when combat ends. 'Half' (default) heals half the Shock taken this fight, rounded up. 'All' clears all sustained Shock. 'None' leaves all damage for natural healing — a grittier, more lethal game.",
    scope: "world",
    config: true,
    type: String,
    default: "half",
    choices: {
      none: "None (Lethal — no automatic recovery)",
      half: "Half (Default — recover 50% of sustained Shock)",
      all: "All (Heroic — recover all sustained Shock)"
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
    { id: "blind", name: "REIGN.StatusBlind", img: "icons/svg/blind.svg", _id: "blind00000000000" } 
  ];

  // V14 COMPLIANCE: Proxy-safe array mutation
  for (const status of reignStatuses) {
    const existing = CONFIG.statusEffects.find(e => e.id === status.id);
    if (existing) {
      Object.assign(existing, status);
    } else {
      CONFIG.statusEffects.push(status);
    }
  }

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
    asset: models.ReignAssetData
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
    "systems/reign/templates/apps/companymancer.hbs"
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
    ReignCompanymancer
  };
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

Hooks.on("updateActiveEffect", async (effect, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (changes.disabled !== false) return; 

    const actor = effect.parent;
    if (!actor || actor.type !== "character") return;
    if (!effect.origin) return;

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
      const isMassive = btn.dataset.massive === "true";
      const areaDice = parseInt(btn.dataset.areaDice) || 0;
      
      // ✅ Retrieve serialized advanced mods directly from the chat card flags
      const advancedMods = msg.flags?.reign?.rollFlags?.advancedMods || {};

      await applyDamageToTarget(width, height, dmgFormula, ap, isMassive, areaDice, null, advancedMods);
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
              // CLEANED UI: Styles removed, classes added
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
              if (!Number.isNumeric(c.initiative) && !initDiv.querySelector(".reign-waiting")) {
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

Hooks.on("renderActorDirectory", (app, html, data) => {
  if (!game.user.isGM) return;

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