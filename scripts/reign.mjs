/**
 * Reign: Realities of Lords and Leaders
 * Targeted for Foundry VTT v13+ (ApplicationV2)
 */

import { ReignActorSheet } from "./sheets/character-sheet.js";
import { ReignCompanySheet } from "./sheets/company-sheet.js";
import { ReignThreatSheet } from "./sheets/threat-sheet.js";
import { ReignItemSheet } from "./sheets/item-sheet.js";
import { generateOREChatHTML } from "./helpers/chat.js";
import { applyDamageToTarget, applyCompanyDamageToTarget } from "./combat/damage.js";

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------

Hooks.once("init", () => {
  CONFIG.Combat.initiative = { formula: "0", decimals: 1 };

  // Register a setting to track the last migration version to prevent data loss on future updates
  game.settings.register("reign", "lastMigrationVersion", {
    name: "Last Migration Version", scope: "world", config: false,
    type: String, default: "0"
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "reign", ReignActorSheet, { types: ["character"], makeDefault: true });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "reign", ReignCompanySheet, { types: ["company"], makeDefault: true });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "reign", ReignThreatSheet, { types: ["threat"], makeDefault: true });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "reign", ReignItemSheet, { makeDefault: true });
});

// Run basic migration checks when the world is ready
Hooks.once("ready", async () => {
  const currentVersion = game.system.version;
  const lastMigration = game.settings.get("reign", "lastMigrationVersion") || "0";
  
  if (foundry.utils.isNewerVersion(currentVersion, lastMigration)) {
    console.log(`Reign | World migrating from version ${lastMigration} to ${currentVersion}`);
    // Future data migration logic will execute here
    await game.settings.set("reign", "lastMigrationVersion", currentVersion);
  }
});

// ----------------------------------------------------
// CORE SYSTEM HOOKS
// ----------------------------------------------------

Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (actor.type !== "character") return;
  
  // Enforce ED/MD Exclusivity for regular skills
  const skills = changes?.system?.skills;
  if (skills) {
    for (const [key, updates] of Object.entries(skills)) {
      if (updates?.master === true && (actor.system.skills[key]?.expert || updates?.expert === true)) updates.expert = false;
      if (updates?.expert === true && (actor.system.skills[key]?.master || updates?.master === true)) updates.master = false;
    }
  }
  
  // Enforce ED/MD Exclusivity for custom skills
  const custom = changes?.system?.customSkills;
  if (custom) {
    for (const [key, updates] of Object.entries(custom)) {
      if (updates?.master === true && (actor.system.customSkills[key]?.expert || updates?.expert === true)) updates.expert = false;
      if (updates?.expert === true && (actor.system.customSkills[key]?.master || updates?.master === true)) updates.master = false;
    }
  }

  // Enforce ED/MD Exclusivity for Esoterica (Sorcery)
  const esoterica = changes?.system?.esoterica;
  if (esoterica) {
    if (esoterica?.master === true && (actor.system.esoterica?.expert || esoterica?.expert === true)) esoterica.expert = false;
    if (esoterica?.expert === true && (actor.system.esoterica?.master || esoterica?.master === true)) esoterica.master = false;
  }
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const element = (html instanceof HTMLElement || html instanceof DocumentFragment) ? html : html[0];
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

      let newResults = [...reignFlags.results];
      const index = newResults.indexOf(heightToRemove);
      if (index > -1) {
        newResults.splice(index, 1);
        
        const newHtml = generateOREChatHTML(
          reignFlags.actorType, 
          reignFlags.label, 
          reignFlags.totalPool, 
          newResults, 
          reignFlags.expertDie, 
          reignFlags.masterDiceCount, 
          reignFlags.itemData, 
          reignFlags.rollFlags
        );
        
        await msg.update({
           content: newHtml,
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
      // FIXED: Area is now parsed as an integer representing Area Dice instead of a boolean
      const areaDice = parseInt(btn.dataset.areaDice) || 0;
      
      await applyDamageToTarget(width, height, dmgFormula, ap, isMassive, areaDice);
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
});

// --- PREREQUISITE ENFORCEMENT ---
Hooks.on("preCreateItem", (item, data, options, userId) => {
  if (game.user.id !== userId) return;
  if (item.parent?.type !== "character") return;
  if (item.type !== "technique" && item.type !== "discipline") return;

  const pathName = item.system.path?.trim();
  const rank = parseInt(item.system.rank) || 1;

  if (!pathName || rank <= 1) return;

  const existingItems = item.parent.items.filter(i => 
    i.type === item.type && 
    i.system.path?.trim().toLowerCase() === pathName.toLowerCase()
  );

  for (let requiredRank = 1; requiredRank < rank; requiredRank++) {
    const hasRequiredRank = existingItems.some(i => parseInt(i.system.rank) === requiredRank);
    
    if (!hasRequiredRank) {
      ui.notifications.error(`Cannot add "${item.name}". You are missing Rank ${requiredRank} of the "${pathName}" path. Prerequisites not met.`);
      return false; 
    }
  }
});