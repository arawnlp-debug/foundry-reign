// scripts/system/migration.js

/**
 * Main entry point for the migration engine.
 * Triggered in reign.mjs when the system version exceeds the world's last saved version.
 */
export async function migrateWorld() {
  ui.notifications.info(`Reign System Migration started! Please do not close your game...`, { permanent: true });
  console.log("Reign | Beginning world migration...");

  // ITEM-21: Structured run record for the integrity report.
  const report = {
    successes: [], // { name, type }
    failures: [],  // { name, type, error }
    warnings: []   // { name, type, message } — anomaly detection, populated after migration
  };

  // 1. Migrate World Actors
  for (let actor of game.actors) {
    try {
      const updateData = migrateActorData(actor);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Reign | Migrating Actor ${actor.name}`);
        await actor.update(updateData);
        report.successes.push({ name: actor.name, type: actor.type });
      }
    } catch (err) {
      console.error(`Reign | Failed to migrate Actor ${actor.name}:`, err);
      report.failures.push({ name: actor.name, type: actor.type, error: err.message || String(err) });
    }
  }

  // 2. Migrate World Items
  for (let item of game.items) {
    try {
      const updateData = migrateItemData(item);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Reign | Migrating Item ${item.name}`);
        await item.update(updateData);
        report.successes.push({ name: item.name, type: item.type });
      }
    } catch (err) {
      console.error(`Reign | Failed to migrate Item ${item.name}:`, err);
      report.failures.push({ name: item.name, type: item.type, error: err.message || String(err) });
    }
  }

  // 3. Migrate Actors inside Tokens on Scenes
  for (let scene of game.scenes) {
    for (let token of scene.tokens) {
      if (token.actor && !token.actorLink) {
        try {
          const updateData = migrateActorData(token.actor);
          if (!foundry.utils.isEmpty(updateData)) {
            console.log(`Reign | Migrating Token Actor ${token.name} on scene ${scene.name}`);
            await token.actor.update(updateData);
            report.successes.push({ name: `${token.name} [token]`, type: token.actor.type });
          }
        } catch (err) {
          console.error(`Reign | Failed to migrate Token Actor ${token.name}:`, err);
          report.failures.push({ name: `${token.name} [token]`, type: token.actor?.type || "unknown", error: err.message || String(err) });
        }
      }
    }
  }

  // 4. Migrate System Compendium Packs
  for (let pack of game.packs) {
    if (pack.metadata.packageType !== "system" || pack.metadata.id.indexOf("reign.") !== 0) continue;
    if (!["Actor", "Item"].includes(pack.documentName)) continue;

    console.log(`Reign | Checking compendium pack ${pack.collection} for migrations...`);
    const wasLocked = pack.locked;
    await pack.configure({ locked: false });
    
    const documents = await pack.getDocuments();
    for (let doc of documents) {
      try {
        const updateData = doc.documentName === "Actor" ? migrateActorData(doc) : migrateItemData(doc);
        if (!foundry.utils.isEmpty(updateData)) {
          console.log(`Reign | Migrating Compendium Document ${doc.name}`);
          await doc.update(updateData);
          report.successes.push({ name: doc.name, type: doc.type });
        }
      } catch (err) {
        console.error(`Reign | Failed to migrate Compendium Document ${doc.name}:`, err);
        report.failures.push({ name: doc.name, type: doc.type, error: err.message || String(err) });
      }
    }
    await pack.configure({ locked: wasLocked });
  }

  // 5. ITEM-21: Anomaly detection — lightweight sweep for known data problems.
  // Runs after migration so any fixable issues are already resolved before flagging.
  _detectAnomalies(report);

  // Post the GM-only summary chat card (and journal entry on failures).
  await _postMigrationReport(report);

  const migrationCount = report.successes.length;
  const failureCount = report.failures.length;

  if (failureCount > 0) {
    ui.notifications.error(`Reign System Migration encountered ${failureCount} failure(s)! Check the console for details.`, { permanent: true });
  }

  if (migrationCount > 0) {
    ui.notifications.info(`Reign System Migration complete! Migrated ${migrationCount} entities.`, { permanent: true });
  } else if (failureCount === 0) {
    ui.notifications.info(`Reign System Migration complete! No entities required migration.`, { permanent: true });
  }
  console.log("Reign | World migration complete.");
  
  return { migrationCount, failureCount };
}

/**
 * Route Actor data to specific migration functions based on type.
 * Passes raw source data to migration functions to avoid 
 * conflicts with V13 TypeDataModel getters.
 */
function migrateActorData(actor) {
  let updateData = {};
  const source = actor.toObject();

  if (actor.type === "character") {
    updateData = migrateCharacter(source);
  } else if (actor.type === "company") {
    updateData = migrateCompany(source);
  } else if (actor.type === "threat") {
    updateData = migrateThreat(source);
  }

  return updateData;
}

/**
 * Route Item data to specific migration functions based on type.
 */
function migrateItemData(item) {
  let updateData = {};
  const source = item.toObject();

  if (item.type === "weapon") updateData = migrateWeapon(source);
  else if (item.type === "armor") updateData = migrateArmor(source);
  else if (item.type === "shield") updateData = migrateShield(source);
  else if (item.type === "technique") updateData = migrateMagicItem(source);
  else if (item.type === "discipline") updateData = migrateMagicItem(source);
  else if (item.type === "spell") updateData = migrateSpell(source);
  else if (item.type === "gear") updateData = migrateGear(source);
  else if (item.type === "advantage") updateData = migrateAdvantage(source);
  else if (item.type === "problem") updateData = migrateProblem(source);
  // G2: Poison items use schema defaults — no migration needed for new items

  return updateData;
}

function migrateCharacter(source) {
  const updateData = {};
  const system = source.system || {};

  if (typeof system.creationMode !== "boolean") {
    updateData["system.creationMode"] = false;
  }

  if (typeof system.customSkills !== "object" || system.customSkills === null || Array.isArray(system.customSkills)) {
    updateData["system.customSkills"] = {};
  }

  if (typeof system.customMoves !== "object" || system.customMoves === null || Array.isArray(system.customMoves)) {
    updateData["system.customMoves"] = {};
  }

  const modifiers = system.modifiers || {};
  
  // P0 MIGRATION FIX: Route legacy v1.x fields to v2.0.0 paths to prevent data loss
  if ("pool" in modifiers) {
      updateData["system.modifiers.globalPool"] = Number(modifiers.pool) || 0;
      updateData["system.modifiers.-=pool"] = null;
  }
  if ("speed" in modifiers) {
      updateData["system.modifiers.globalSpeed"] = Number(modifiers.speed) || 0;
      updateData["system.modifiers.-=speed"] = null;
  }
  if ("armor" in modifiers) {
      const legacyArmor = Number(modifiers.armor) || 0;
      ["head", "torso", "armL", "armR", "legL", "legR"].forEach(loc => {
          updateData[`system.modifiers.naturalArmor.${loc}`] = legacyArmor;
      });
      updateData["system.modifiers.-=armor"] = null;
  }

  // Health: ensure no legacy 'max' or 'armor' keys pollute the health sub-schema
  const health = system.health || {};
  for (const loc of ["head", "torso", "armL", "armR", "legL", "legR"]) {
    const current = health[loc] || {};
    if ("max" in current) updateData[`system.health.${loc}.-=max`] = null;
    if ("armor" in current) updateData[`system.health.${loc}.-=armor`] = null;
  }

  return updateData;
}

function migrateCompany(source) {
  const updateData = {};
  const system = source.system || {};
  const qualities = system.qualities || {};

  for (const key of ["might", "treasure", "influence", "territory", "sovereignty"]) {
    const quality = qualities[key] || {};

    const val = Math.min(5, Number(quality.value ?? quality.permanent) || 0);
    if (quality.value !== val) updateData[`system.qualities.${key}.value`] = val;
    
    if (!Number.isInteger(quality.damage)) updateData[`system.qualities.${key}.damage`] = Number(quality.damage) || 0;
    if (!Number.isInteger(quality.uses)) updateData[`system.qualities.${key}.uses`] = 0;
    
    if ("permanent" in quality) updateData[`system.qualities.${key}.-=permanent`] = null;
    if ("current" in quality) updateData[`system.qualities.${key}.-=current`] = null;

    if (quality.notes === null || quality.notes === undefined) updateData[`system.qualities.${key}.notes`] = "";
  }

  const pledges = system.pledges || {};
  if (!Number.isInteger(pledges.bonus)) updateData["system.pledges.bonus"] = 0;
  if (!Number.isInteger(pledges.ed)) updateData["system.pledges.ed"] = 0;
  if (!Number.isInteger(pledges.md)) updateData["system.pledges.md"] = 0;

  const biography = system.biography || {};
  if (biography.description === null || biography.description === undefined) updateData["system.biography.description"] = "";
  if (biography.assets === null || biography.assets === undefined) updateData["system.biography.assets"] = "";

  return updateData;
}

function migrateThreat(source) {
  const updateData = {};
  const system = source.system || {};

  if (!Number.isInteger(system.threatLevel)) {
    updateData["system.threatLevel"] = Number(system.threatLevel) || 0;
  }

  if (system.damageFormula === null || system.damageFormula === undefined || system.damageFormula === "") {
    updateData["system.damageFormula"] = "Width Shock";
  }

  const magnitude = system.magnitude || {};
  if (!Number.isInteger(magnitude.value)) updateData["system.magnitude.value"] = Number(magnitude.value) || 5;
  if (!Number.isInteger(magnitude.max)) updateData["system.magnitude.max"] = Number(magnitude.max) || 5;

  const morale = system.morale || {};
  if (!Number.isInteger(morale.value)) updateData["system.morale.value"] = Number(morale.value) || 5;
  if (!Number.isInteger(morale.max)) updateData["system.morale.max"] = Number(morale.max) || 5;

  if (system.description === null || system.description === undefined) {
    updateData["system.description"] = "";
  }

  if (system.parentCompany === null || system.parentCompany === undefined) {
    updateData["system.parentCompany"] = "";
  }

  // G3.1 (v2.9.0): Creature mode fields — new schema, all default via schema definition.
  // No data remapping required; existing threat actors remain in mob mode (creatureMode: false).
  // creatureFlags sub-schema: ensure legacy actors without the field are initialised safely.
  if (system.creatureFlags === null || system.creatureFlags === undefined) {
    updateData["system.creatureFlags"] = {
      freeGobbleDicePerRound: 0, moraleAttackOnce: false,
      constrictActive: false, constrictTargetId: "",
      chargeRunWidest: 0, venomPotency: 0, venomType: ""
    };
  }

  // v3.0.1: Creature skills — convert flat values (number / "ED" / "MD") to structured
  // objects { value, expert, master } so skills can have dice AND an ED/MD simultaneously.
  const rawSkills = system.creatureSkills;
  if (rawSkills && typeof rawSkills === "object") {
    let needsMigration = false;
    const migratedSkills = {};
    for (const [key, val] of Object.entries(rawSkills)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        migratedSkills[key] = val; // already structured
      } else {
        needsMigration = true;
        if (val === "ED") migratedSkills[key] = { value: 0, expert: true, master: false };
        else if (val === "MD") migratedSkills[key] = { value: 0, expert: false, master: true };
        else migratedSkills[key] = { value: typeof val === "number" ? val : (parseInt(val) || 0), expert: false, master: false };
      }
    }
    if (needsMigration) updateData["system.creatureSkills"] = migratedSkills;
  }

  return updateData;
}

function migrateWeapon(source) {
  const updateData = {};
  const system = source.system || {};
  const qualities = system.qualities || {};

  if (system.damage === null || system.damage === undefined || system.damage === "") {
    updateData["system.damage"] = "Width Shock";
  }

  if (system.pool === null || system.pool === undefined) updateData["system.pool"] = "";
  if (system.range === null || system.range === undefined) updateData["system.range"] = "";
  if (system.notes === null || system.notes === undefined) updateData["system.notes"] = "";
  
  if (typeof system.equipped !== "boolean") updateData["system.equipped"] = false;
  if (!Number.isInteger(system.equippedTimestamp)) updateData["system.equippedTimestamp"] = 0;

  if (!Number.isInteger(qualities.armorPiercing)) updateData["system.qualities.armorPiercing"] = Number(qualities.armorPiercing) || 0;
  if (!Number.isInteger(qualities.slow)) updateData["system.qualities.slow"] = Number(qualities.slow) || 0;
  if (typeof qualities.twoHanded !== "boolean") updateData["system.qualities.twoHanded"] = false;
  if (typeof qualities.massive !== "boolean") updateData["system.qualities.massive"] = false;
  if (!Number.isInteger(qualities.area)) updateData["system.qualities.area"] = Number(qualities.area) || 0;

  // G2 (v3.0.0): Weapon poison fields — default to unpoisoned
  if (typeof system.isPoisoned !== "boolean") updateData["system.isPoisoned"] = false;
  if (system.poisonRef === null || system.poisonRef === undefined) updateData["system.poisonRef"] = "";

  // ITEM-9 (Batch H): Weapon skill binding — default to empty (preserves pool-string behaviour)
  if (system.skillKey === null || system.skillKey === undefined) updateData["system.skillKey"] = "";

  return updateData;
}

function migrateArmor(source) {
  const updateData = {};
  const system = source.system || {};

  if (!["light", "medium", "heavy"].includes(system.armorWeight)) updateData["system.armorWeight"] = "light";
  if (typeof system.equipped !== "boolean") updateData["system.equipped"] = false;
  if (!Number.isInteger(system.equippedTimestamp)) updateData["system.equippedTimestamp"] = 0;
  if (system.notes === null || system.notes === undefined) updateData["system.notes"] = "";

  return updateData;
}

function migrateShield(source) {
  const updateData = {};
  const system = source.system || {};

  if (!["small", "large", "tower"].includes(system.shieldSize)) updateData["system.shieldSize"] = "small";
  if (!["wood", "metal"].includes(system.material)) updateData["system.material"] = "wood";
  if (!["armL", "armR"].includes(system.shieldArm)) updateData["system.shieldArm"] = "armL";
  if (!Number.isInteger(system.parryBonus)) updateData["system.parryBonus"] = Number(system.parryBonus) || 1;
  if (!Number.isInteger(system.coverAR)) updateData["system.coverAR"] = Number(system.coverAR) || 1;
  
  if (typeof system.equipped !== "boolean") updateData["system.equipped"] = false;
  if (!Number.isInteger(system.equippedTimestamp)) updateData["system.equippedTimestamp"] = 0;
  if (typeof system.isStationary !== "boolean") updateData["system.isStationary"] = true;

  const protectedLocations = system.protectedLocations || {};
  for (const key of ["head", "torso", "armL", "armR", "legL", "legR"]) {
    if (typeof protectedLocations[key] !== "boolean") {
      updateData[`system.protectedLocations.${key}`] = false;
    }
  }

  if (system.notes === null || system.notes === undefined) updateData["system.notes"] = "";

  return updateData;
}

function migrateMagicItem(source) {
  const updateData = {};
  const system = source.system || {};

  if (system.path === null || system.path === undefined) updateData["system.path"] = "";
  if (!Number.isInteger(system.rank)) updateData["system.rank"] = Number(system.rank) || 1;
  if (system.page === null || system.page === undefined) updateData["system.page"] = "";
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";

  return updateData;
}

function migrateSpell(source) {
  const updateData = {};
  const system = source.system || {};

  if (!Number.isInteger(system.intensity)) updateData["system.intensity"] = Number(system.intensity) || 1;
  if (!Number.isInteger(system.castingTime)) updateData["system.castingTime"] = Number(system.castingTime) || 0;
  if (!system.castingStat) updateData["system.castingStat"] = "knowledge";
  if (system.pool === null || system.pool === undefined) updateData["system.pool"] = "";
  if (system.page === null || system.page === undefined) updateData["system.page"] = "";
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";

  // v2.3.0: Slow rating
  if (!Number.isInteger(system.slow)) updateData["system.slow"] = 0;

  // v2.3.0: New string fields
  if (system.duration === null || system.duration === undefined) updateData["system.duration"] = "";
  if (system.school === null || system.school === undefined) updateData["system.school"] = "";

  // v2.3.0: Boolean flags
  if (typeof system.attunementRequired !== "boolean") updateData["system.attunementRequired"] = false;
  if (typeof system.isAttunementSpell !== "boolean")  updateData["system.isAttunementSpell"] = false;
  if (typeof system.dodgeable !== "boolean")          updateData["system.dodgeable"] = false;
  if (typeof system.parriable !== "boolean")          updateData["system.parriable"] = false;
  if (typeof system.armorBlocks !== "boolean")        updateData["system.armorBlocks"] = false;

  return updateData;
}

function migrateGear(source) {
  const updateData = {};
  const system = source.system || {};

  if (!Number.isInteger(system.quantity)) updateData["system.quantity"] = Number(system.quantity) || 1;
  if (system.notes === null || system.notes === undefined) updateData["system.notes"] = "";

  return updateData;
}

function migrateAdvantage(source) {
  const updateData = {};
  const system = source.system || {};

  if (!Number.isInteger(system.cost)) updateData["system.cost"] = Number(system.cost) || 1;
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";
  if (system.hook === null || system.hook === undefined) updateData["system.hook"] = "";

  return updateData;
}

function migrateProblem(source) {
  const updateData = {};
  const system = source.system || {};

  if (!Number.isInteger(system.bonus)) updateData["system.bonus"] = Number(system.bonus) || 1;
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";
  if (system.hook === null || system.hook === undefined) updateData["system.hook"] = "";

  return updateData;
}

// ==========================================
// ITEM-21: MIGRATION INTEGRITY REPORT
// ==========================================

/**
 * Lightweight anomaly detection sweep. Runs after all migration passes so that
 * any fixable data problems are already resolved before we flag them.
 * Only checks for known, cheap-to-detect conditions — this is not a deep audit.
 *
 * @param {object} report - The shared report object { successes, failures, warnings }
 */
function _detectAnomalies(report) {
  const _warn = (name, type, message) => report.warnings.push({ name, type, message });

  // --- World Items ---
  for (const item of game.items) {
    const sys = item.toObject().system || {};
    if (item.type === "weapon") {
      if ((sys.pool ?? "") === "" && (sys.skillKey ?? "") === "") {
        _warn(item.name, "weapon", "No attack pool or skill binding — weapon will produce 0 dice on roll");
      }
      if ((sys.damage ?? "") === "") {
        _warn(item.name, "weapon", "Empty damage formula");
      }
    }
  }

  // --- World Actors and their embedded items ---
  for (const actor of game.actors) {
    const source = actor.toObject();
    const sys = source.system || {};

    if (actor.type === "character") {
      for (const [key, val] of Object.entries(sys.attributes || {})) {
        if (val?.value == null || isNaN(parseInt(val.value))) {
          _warn(actor.name, "character", `Attribute "${key}" has an invalid value`);
        }
      }
      for (const [key, val] of Object.entries(sys.skills || {})) {
        if (val?.value == null || isNaN(parseInt(val.value))) {
          _warn(actor.name, "character", `Skill "${key}" has an invalid value`);
        }
      }
    }

    for (const item of actor.items) {
      const iSys = item.toObject().system || {};
      if (item.type === "weapon") {
        if ((iSys.pool ?? "") === "" && (iSys.skillKey ?? "") === "") {
          _warn(`${item.name} (on ${actor.name})`, "weapon", "No attack pool or skill binding — weapon will produce 0 dice on roll");
        }
        if ((iSys.damage ?? "") === "") {
          _warn(`${item.name} (on ${actor.name})`, "weapon", "Empty damage formula");
        }
      }
    }
  }

  // --- Unlinked token actors ---
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actor || token.actorLink) continue;
      for (const item of token.actor.items) {
        const iSys = item.toObject().system || {};
        if (item.type === "weapon") {
          if ((iSys.pool ?? "") === "" && (iSys.skillKey ?? "") === "") {
            _warn(`${item.name} (token: ${token.name}, scene: ${scene.name})`, "weapon", "No attack pool or skill binding — weapon will produce 0 dice on roll");
          }
        }
      }
    }
  }
}

/**
 * Posts a GM-only chat card summarising the migration run.
 * If any failures occurred, additionally writes a persistent Journal Entry
 * with full error detail so the GM can review after a reload or share for
 * bug reports.
 *
 * @param {object} report - { successes: [], failures: [], warnings: [] }
 */
async function _postMigrationReport(report) {
  const { successes, failures, warnings } = report;

  // --- Success summary grouped by entity type ---
  const typeGroups = {};
  for (const s of successes) {
    typeGroups[s.type] = (typeGroups[s.type] || 0) + 1;
  }
  const successSummary = Object.entries(typeGroups)
    .map(([t, n]) => `${n} ${t}${n !== 1 ? "s" : ""}`)
    .join(", ") || "none";

  // --- Build chat card HTML ---
  let html = `<div class="reign-chat-card"><h3 style="margin-top:0">⚙️ Reign — Migration Report</h3>`;

  if (successes.length === 0 && failures.length === 0 && warnings.length === 0) {
    html += `<p>✅ Migration complete — no changes required.</p>`;
  } else {
    if (successes.length > 0) {
      html += `<p>✅ <strong>Updated:</strong> ${successSummary}</p>`;
    }
    if (warnings.length > 0) {
      html += `<p>⚠️ <strong>Warnings (${warnings.length}):</strong></p><ul style="margin:0 0 8px 16px;padding:0">`;
      for (const w of warnings) {
        html += `<li><em>${foundry.utils.escapeHTML(w.name)}</em> [${w.type}] — ${foundry.utils.escapeHTML(w.message)}</li>`;
      }
      html += `</ul>`;
    }
    if (failures.length > 0) {
      html += `<p>❌ <strong>Failures (${failures.length}):</strong></p><ul style="margin:0 0 8px 16px;padding:0">`;
      for (const f of failures) {
        html += `<li><em>${foundry.utils.escapeHTML(f.name)}</em> [${f.type}] — ${foundry.utils.escapeHTML(f.error)}</li>`;
      }
      html += `</ul>`;
      const dateStr = new Date().toLocaleDateString();
      html += `<p class="reign-text-small reign-text-muted">Full detail → Journal Entry: <em>"Reign Migration Report – ${dateStr}"</em></p>`;
    }
  }
  html += `</div>`;

  // Post GM-only chat message
  await ChatMessage.create({
    content: html,
    whisper: ChatMessage.getWhisperRecipients("GM"),
    speaker: { alias: "Reign System" }
  });

  // Create a Journal Entry for failure detail (persistent across reloads)
  if (failures.length > 0) {
    const dateStr = new Date().toLocaleDateString();
    const journalContent = failures.map(f =>
      `<h3>${foundry.utils.escapeHTML(f.name)} [${f.type}]</h3><p>${foundry.utils.escapeHTML(f.error)}</p>`
    ).join("\n");

    try {
      await JournalEntry.create({
        name: `Reign Migration Report – ${dateStr}`,
        pages: [{
          name: "Failure Detail",
          type: "text",
          text: { content: journalContent, format: 1 }
        }]
      });
    } catch (err) {
      // Journal creation failing is non-fatal — the chat card already has the failure list.
      console.error("Reign | Could not create migration failure journal:", err);
    }
  }
}
