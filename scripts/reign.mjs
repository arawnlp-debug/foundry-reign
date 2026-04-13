// scripts/reign.mjs

/**
 * Reign: Realities of Lords and Leaders
 * Targeted for Foundry VTT v13+ (ApplicationV2)
 */

import { ReignActorSheet } from "./sheets/character-sheet.js";
import { ReignCompanySheet } from "./sheets/company-sheet.js";
import { ReignThreatSheet } from "./sheets/threat-sheet.js";
import { ReignItemSheet } from "./sheets/item-sheet.js";
import { generateOREChatHTML } from "./helpers/chat.js";
import { applyDamageToTarget, applyCompanyDamageToTarget, applyScatteredDamageToTarget, applyHealingToTarget, applyFirstAidToTarget, consumeGobbleDie } from "./combat/damage.js";
import { ReignCombat } from "./combat/ore-combat.js";
import { parseORE, calculateInitiative } from "./helpers/ore-engine.js";
import { ReignCharactermancer } from "./generators/charactermancer.js";

import { migrateWorld } from "./system/migration.js";
import * as models from "./system/models.js";

const { DialogV2 } = foundry.applications.api;

Hooks.once("init", async () => {
  CONFIG.Combat.documentClass = ReignCombat;
  CONFIG.Combat.initiative = { formula: "0", decimals: 2 };

  // AUDIT FIX P4: Corrected to point to valid {value, max} objects for token bars
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
          bar: [], // Companies use current/permanent, not value/max
          value: ["qualities.might.current", "qualities.treasure.current", "qualities.influence.current", "qualities.territory.current", "qualities.sovereignty.current"]
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

  const reignStatuses = [
    { id: "dead", name: "REIGN.StatusDead", img: "icons/svg/skull.svg", _id: "dead000000000000" },
    { id: "unconscious", name: "REIGN.StatusUnconscious", img: "icons/svg/unconscious.svg", _id: "unconscious00000" },
    { id: "dazed", name: "REIGN.StatusDazed", img: "icons/svg/daze.svg", _id: "dazed00000000000", changes: [{ key: "system.modifiers.pool", mode: 2, value: "-1" }] },
    { id: "maimed", name: "REIGN.StatusMaimed", img: "icons/svg/sword.svg", _id: "maimed0000000000" },
    { id: "prone", name: "REIGN.StatusProne", img: "icons/svg/falling.svg", _id: "prone00000000000" },
    { id: "bleeding", name: "REIGN.StatusBleeding", img: "icons/svg/blood.svg", _id: "bleeding00000000" },
    { id: "blind", name: "REIGN.StatusBlind", img: "icons/svg/blind.svg", _id: "blind00000000000" } 
  ];

  CONFIG.statusEffects = CONFIG.statusEffects.filter(e => !["dead", "unconscious"].includes(e.id));
  CONFIG.statusEffects.push(...reignStatuses);

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
    problem: models.ReignProblemData
  };

  const templatePaths = [
    "systems/reign/templates/parts/damage-silhouette.hbs"
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
    consumeGobbleDie,
    ReignCharactermancer
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
 * Intercept Character Creation
 * Triggers the Charactermancer if a new, blank character is created.
 */
Hooks.on("createActor", async (actor, options, userId) => {
  // Only the user who clicked "Create" should launch the app
  if (game.user.id !== userId) return;
  if (actor.type !== "character") return;
  
  // Don't trigger if the actor is being duplicated, imported from a compendium, etc.
  if (actor.flags?.core?.sourceId || options.fromCompendium) return;

  // Launch the Charactermancer and lock the underlying sheet
  await actor.update({ "system.creationMode": true });
  
  // Close the default sheet that Foundry auto-opens, then open our Wizard
  setTimeout(() => {
    actor.sheet.close();
    new ReignCharactermancer({ document: actor }).render(true);
  }, 50); 
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

// P2 FIX: Delete Orphaned Effects when Item is deleted
Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (!item.parent || item.parent.type !== "character") return;

    const actor = item.parent;
    const itemUuid = item.uuid;
    
    // Find any effects on the actor that originated from this deleted item
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
                  
                  // AUDIT FIX B12 / ISSUE 7: Use shared ORE initiative engine calculator
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

  // AUDIT FIX UX: Use exported consumeGobbleDie to sync defense cards
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
      
      await applyDamageToTarget(width, height, dmgFormula, ap, isMassive, areaDice);
    });
  });

  element.querySelectorAll(".apply-waste-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const faces = btn.dataset.faces;
      const type = btn.dataset.type;
      const ap = parseInt(btn.dataset.ap) || 0;
      
      await applyScatteredDamageToTarget(faces, type, ap);
    });
  });

  element.querySelectorAll(".apply-company-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const width = parseInt(btn.dataset.width);
      const qualityKey = btn.dataset.quality;
      
      await applyCompanyDamageToTarget(width, qualityKey);
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

  element.querySelectorAll(".apply-condition-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      
      if (!msg) return;
      if (!game.user.isGM && msg.author?.id !== game.user.id) {
        return ui.notifications.warn("Only the GM or the caster can apply this spell's effects.");
      }

      const itemUuid = btn.dataset.itemUuid;
      if (!itemUuid) return ui.notifications.error("Could not locate original spell UUID.");
      
      const item = await fromUuid(itemUuid);
      if (!item || !item.effects || item.effects.size === 0) return ui.notifications.warn("No active effects found on this spell.");

      const targets = game.user.targets;
      if (targets.size === 0) return ui.notifications.warn("You must target at least one token to apply the condition.");

      const effectData = [];
      for (let e of item.effects) {
          let data = e.toObject();
          
          delete data._id;       
          data.disabled = false; 
          data.transfer = false; 
          data.origin = itemUuid;
          
          if (data.name) {
              const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
              data.statuses = Array.from(new Set([...(data.statuses || []), slug]));
          }
          
          effectData.push(data);
      }

      for (let t of targets) {
          if (!t.actor) continue;

          const existingEffectIds = t.actor.effects.filter(e => e.origin === itemUuid).map(e => e.id);
          if (existingEffectIds.length > 0) {
              await t.actor.deleteEmbeddedDocuments("ActiveEffect", existingEffectIds);
          }

          await t.actor.createEmbeddedDocuments("ActiveEffect", effectData);
      }
      ui.notifications.info(`Applied ${item.name} effect(s) to ${targets.size} targeted token(s).`);
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

  const sys = data.system || item.system;
  const pathName = sys?.path?.trim();
  const rank = parseInt(sys?.rank) || 1;
  const itemName = data.name || item.name || "Unnamed Item";

  if (!pathName || rank <= 1) return;

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
});

const resetCombatRound = async (combat) => {
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
};

Hooks.on("combatStart", async (combat, context) => {
  if (game.user.isGM) await resetCombatRound(combat);
});

Hooks.on("updateCombat", async (combat, changes, context, userId) => {
  if (!game.user.isGM) return;
  if (!game.combats.has(combat.id)) return;
  if (foundry.utils.hasProperty(changes, "round") && combat.started) {
      await resetCombatRound(combat);
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

// Robust jQuery-based UI Injection for the Combat Tracker
Hooks.on("renderCombatTracker", (app, html, data) => {
  const combat = game.combat;
  if (!combat) return;

  const $html = html instanceof jQuery ? html : $(html[0] || html);
  const phase = combat.getFlag("reign", "phase") || "declaration";
  const isDeclaring = phase === "declaration";
  const isGM = game.user.isGM;

  // REFACTORED PHASE TOGGLE BUTTONS
  const btnHtml = `
    <div class="reign-combat-phase-control flexrow" style="margin: 4px 8px; text-align: center; border-radius: 4px; display: flex; align-items: center; background: rgba(0,0,0,0.4); padding: 2px;">
      <button class="phase-btn cm-declare-btn" data-phase="declaration" style="flex:1; border: 1px solid transparent; border-radius: 3px 0 0 3px; line-height: 24px; padding: 0; height: 28px; cursor: pointer; color: #aaa; transition: all 0.2s ease;">
        <i class="fas fa-eye"></i> Declare
      </button>
      <button class="phase-btn cm-resolve-btn" data-phase="resolution" style="flex:1; border: 1px solid transparent; border-radius: 0 3px 3px 0; line-height: 24px; padding: 0; height: 28px; cursor: pointer; color: #aaa; transition: all 0.2s ease;">
        <i class="fas fa-bolt"></i> Resolve
      </button>
    </div>
  `;

  if (!$html.find(".reign-combat-phase-control").length) {
      $html.find(".combat-tracker-header").after(btnHtml);
      if (isGM) {
          $html.find(".phase-btn").off("click").on("click", async (ev) => {
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
      } else {
          $html.find(".phase-btn").css("cursor", "default").prop("disabled", true);
      }
  }

  // FORCE DYNAMIC HIGHLIGHTS (Bypasses CSS caching)
  const $decBtn = $html.find(".cm-declare-btn");
  const $resBtn = $html.find(".cm-resolve-btn");

  if (isDeclaring) {
      $decBtn.css({"background": "#2e7d32", "color": "white", "border": "1px solid #4caf50", "box-shadow": "0 0 8px #4caf50", "font-weight": "bold", "text-shadow": "1px 1px 2px black"});
      $resBtn.css({"background": "transparent", "color": "#888", "border": "1px solid transparent", "box-shadow": "none", "font-weight": "normal"});
  } else {
      $resBtn.css({"background": "#b71c1c", "color": "white", "border": "1px solid #e53935", "box-shadow": "0 0 8px #e53935", "font-weight": "bold", "text-shadow": "1px 1px 2px black"});
      $decBtn.css({"background": "transparent", "color": "#888", "border": "1px solid transparent", "box-shadow": "none", "font-weight": "normal"});
  }

  // PENALTY BANNER
  const currentTurn = combat.combatant;
  if (currentTurn && currentTurn.actor) {
      const statuses = Array.from(currentTurn.actor.statuses);
      const penalties = [];
      if (statuses.includes("dazed")) penalties.push("DAZED (−1d)");
      if (statuses.includes("prone")) penalties.push("PRONE (−1d)");
      if (statuses.includes("blind")) penalties.push("BLIND (−2d Ranged / Diff 4 Melee)");
      
      if (penalties.length > 0 && !$html.find(".reign-wound-banner").length) {
          const bannerHtml = `
            <div class="reign-wound-banner" style="background: #ffcdd2; color: #b71c1c; border: 1px solid #d32f2f; text-align: center; padding: 6px; margin: 4px 8px 8px 8px; border-radius: 4px; font-weight: bold; font-size: 0.9em; box-shadow: 0 1px 3px rgba(0,0,0,0.2); flex: 0 0 auto;">
                <i class="fas fa-exclamation-triangle"></i> Current Turn Penalties:<br>
                <span style="font-weight: normal; font-size: 0.95em; color: #8b0000;">${penalties.join(" | ")}</span>
            </div>
          `;
          $html.find(".reign-combat-phase-control").after(bannerHtml);
      }
  }

  // INITIATIVE LIST
  const combatants = $html.find(".combatant");
  combatants.each((idx, li) => {
      const cid = li.dataset.combatantId;
      const c = combat.combatants.get(cid);
      if (!c) return;

      const isDeclared = c.getFlag("reign", "declared") || false;
      const $initDiv = $(li).find(".token-initiative");
      
      if ($initDiv.length) {
          $initDiv.find(".roll").hide();

          if (isDeclaring) {
              $initDiv.html(`
                <a class="combatant-control reign-declare-btn" data-combatant-id="${cid}" title="${isDeclared ? 'Declaration Confirmed' : 'Confirm Declaration'}" style="color: ${isDeclared ? '#4caf50' : '#888'}; font-size: 1.4em; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; transition: color 0.2s ease;">
                    <i class="${isDeclared ? 'fas fa-check-circle' : 'far fa-circle'}"></i>
                </a>
              `);
              
              $initDiv.find(".reign-declare-btn").off("click").on("click", async (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const activeCombat = game.combats.get(combat.id);
                  if (!activeCombat) return;
                  const activeCombatant = activeCombat.combatants.get(cid);
                  if (!activeCombatant) return;
                  if (!isGM && !activeCombatant.isOwner) return ui.notifications.warn("You do not have permission to confirm this combatant's declaration.");
                  await activeCombatant.setFlag("reign", "declared", !isDeclared);
              });
          } else {
              if (!Number.isNumeric(c.initiative) && !$initDiv.find(".reign-waiting").length) {
                  $initDiv.append(`<span class="reign-waiting" style="color: #999; font-weight: bold; font-size: 1.2em;" title="Waiting for action...">--</span>`);
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