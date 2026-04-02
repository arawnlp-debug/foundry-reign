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
import { applyDamageToTarget, applyCompanyDamageToTarget, applyScatteredDamageToTarget, applyHealingToTarget, applyFirstAidToTarget } from "./combat/damage.js";

import { migrateWorld } from "./system/migration.js";
import * as models from "./system/models.js";

const { DialogV2 } = foundry.applications.api;

Hooks.once("init", () => {
  CONFIG.Combat.initiative = { formula: "0", decimals: 2 };

  game.settings.register("reign", "lastMigrationVersion", {
    name: "Last Migration Version", scope: "world", config: false,
    type: String, default: "0"
  });

  game.settings.register("reign", "oneRollTablePath", {
    name: "Custom One-Roll Tables Path",
    hint: "Path to a custom JSON file for character generation (e.g., worlds/my-world/tables.json). Leave blank for default.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  const reignStatuses = [
    { id: "dead", name: "REIGN.StatusDead", img: "icons/svg/skull.svg", _id: "dead000000000000" },
    { id: "unconscious", name: "REIGN.StatusUnconscious", img: "icons/svg/unconscious.svg", _id: "unconscious00000" },
    { id: "dazed", name: "REIGN.StatusDazed", img: "icons/svg/daze.svg", _id: "dazed00000000000" },
    { id: "maimed", name: "REIGN.StatusMaimed", img: "icons/svg/sword.svg", _id: "maimed0000000000" },
    { id: "prone", name: "REIGN.StatusProne", img: "icons/svg/falling.svg", _id: "prone00000000000" },
    { id: "bleeding", name: "REIGN.StatusBleeding", img: "icons/svg/blood.svg", _id: "bleeding00000000" }
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

  const { DocumentSheetConfig } = foundry.applications.apps;

  DocumentSheetConfig.registerSheet(Actor, "reign", ReignActorSheet, { types: ["character"], makeDefault: true });
  DocumentSheetConfig.registerSheet(Actor, "reign", ReignCompanySheet, { types: ["company"], makeDefault: true });
  DocumentSheetConfig.registerSheet(Actor, "reign", ReignThreatSheet, { types: ["threat"], makeDefault: true });
  DocumentSheetConfig.registerSheet(Item, "reign", ReignItemSheet, { makeDefault: true });
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

  element.querySelectorAll(".gobble-dmg-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!msg) return;
      if (!msg.isAuthor && !game.user.isGM) return ui.notifications.warn("Only the GM or the rolling player can alter this attack's dice.");
      
      const heightToRemove = parseInt(btn.dataset.height);
      const reignFlags = msg.flags?.reign;
      if (!reignFlags) return;

      const content = `
        <div class="reign-dialog-form">
          <p style="text-align: center; font-size: 1.1em; margin-bottom: 10px;">
            To gobble this attack, your defensive set must have a Height of <strong>${heightToRemove}</strong> or higher.
          </p>
          <p style="font-size: 0.85em; color: #8b1f1f; font-style: italic; background: #ffebee; padding: 5px; border-radius: 3px; border: 1px solid #ffcdd2;">
            <strong>Warning:</strong> Ensure your defense matches the Width and Timing of the incoming attack per RAW resolution order.
          </p>
          <div class="form-group">
            <label>Height of your Gobble Die:</label>
            <input type="number" name="gobbleHeight" value="${heightToRemove}" min="1" max="10" autofocus/>
          </div>
        </div>
      `;

      const gobbleHeight = await DialogV2.wait({
          classes: ["reign-dialog-window"],
          window: { title: "Spend Gobble Die", resizable: true },
          content: content,
          rejectClose: false, // P2-6 FIX: Safe Cancellation
          buttons: [{
              action: "confirm", label: "Gobble Attack", default: true,
              callback: (e, b, d) => {
                  const val = parseInt(d.element.querySelector('[name="gobbleHeight"]').value) || 0;
                  if (d && typeof d.close === 'function') d.close({ animate: false });
                  return val;
              }
          }]
      });

      if (!gobbleHeight) return; 

      if (gobbleHeight < heightToRemove) {
          return ui.notifications.error(`Invalid Defense! Your Gobble Die (Height ${gobbleHeight}) cannot deflect an attack of Height ${heightToRemove}.`);
      }

      let newResults = [...reignFlags.results];
      const oldWidth = newResults.filter(r => r === heightToRemove).length;
      
      const index = newResults.indexOf(heightToRemove);
      if (index > -1) {
        newResults.splice(index, 1);
        const newWidth = oldWidth - 1;
        
        const newHtml = await generateOREChatHTML(
          reignFlags.actorType, 
          reignFlags.label, 
          reignFlags.totalPool, 
          newResults, 
          reignFlags.expertDie, 
          reignFlags.masterDiceCount, 
          reignFlags.itemData, 
          reignFlags.rollFlags
        );

        let title, color, desc;
        if (newWidth < 2) {
            title = "Attack Deflected!";
            color = "#2d5a27"; 
            desc = `Incoming attack (Height ${heightToRemove}) completely broken by Gobble defense (Height ${gobbleHeight}).`;
        } else {
            title = "Attack Reduced!";
            color = "#d97706"; 
            desc = `Incoming attack (Height ${heightToRemove}) reduced to ${newWidth}x${heightToRemove} by Gobble defense (Height ${gobbleHeight}).`;
        }

        const noticeBanner = `
            <div style="background: #fdfdfc; color: ${color}; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; text-align: center; border: 2px solid ${color}; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 2px;"><i class="fas fa-shield-alt"></i> ${title}</div>
                <div style="font-size: 0.9em; font-weight: normal; color: #444;">${desc}</div>
            </div>
        `;
        const finalHtml = newHtml.replace('<div class="reign-chat-card">', `<div class="reign-chat-card">${noticeBanner}`);

        await msg.update({
           content: finalHtml,
           "flags.reign.results": newResults
        });
      }
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

  // HEALING ENGINE: Magical Primary Healing Button
  element.querySelectorAll(".apply-heal-btn").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const width = parseInt(btn.dataset.width);
      const height = parseInt(btn.dataset.height);
      const healString = btn.dataset.healString;
      
      await applyHealingToTarget(width, height, healString);
    });
  });

  // HEALING ENGINE: First Aid / Medicine Button
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
      
      // P0-A FIX: Permission Guard
      // Only the GM or the person who rolled the spell can trigger the effect application
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