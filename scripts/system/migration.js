// scripts/system/migration.js

/**
 * Main entry point for the migration engine.
 * Triggered in reign.mjs when the system version exceeds the world's last saved version.
 */
export async function migrateWorld() {
  ui.notifications.info(`Reign System Migration started! Please do not close your game...`, { permanent: true });
  console.log("Reign | Beginning world migration...");

  let migrationCount = 0; // Track if anything actually migrates
  let failureCount = 0; // AUDIT FIX 2.3: Track failures for the version gate

  // 1. Migrate World Actors
  for (let actor of game.actors) {
    try {
      const updateData = migrateActorData(actor);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Reign | Migrating Actor ${actor.name}`);
        await actor.update(updateData);
        migrationCount++;
      }
    } catch (err) {
      console.error(`Reign | Failed to migrate Actor ${actor.name}:`, err);
      failureCount++;
    }
  }

  // 2. Migrate World Items
  for (let item of game.items) {
    try {
      const updateData = migrateItemData(item);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Reign | Migrating Item ${item.name}`);
        await item.update(updateData);
        migrationCount++;
      }
    } catch (err) {
      console.error(`Reign | Failed to migrate Item ${item.name}:`, err);
      failureCount++;
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
            migrationCount++;
          }
        } catch (err) {
          console.error(`Reign | Failed to migrate Token Actor ${token.name}:`, err);
          failureCount++;
        }
      }
    }
  }

  if (migrationCount > 0) {
    ui.notifications.info(`Reign System Migration complete! Migrated ${migrationCount} entities.`, { permanent: true });
  } else if (failureCount === 0) {
    ui.notifications.info(`Reign System Migration complete! No entities required migration.`, { permanent: true });
  }
  console.log("Reign | World migration complete.");
  
  // Return stats so reign.mjs knows whether it's safe to bump the version
  return { migrationCount, failureCount };
}

/**
 * Route Actor data to specific migration functions based on type.
 */
function migrateActorData(actor) {
  let updateData = {};

  if (actor.type === "character") {
    updateData = foundry.utils.mergeObject(updateData, migrateCharacter(actor));
  } else if (actor.type === "company") {
    updateData = foundry.utils.mergeObject(updateData, migrateCompany(actor));
  } else if (actor.type === "threat") {
    updateData = foundry.utils.mergeObject(updateData, migrateThreat(actor));
  }

  return updateData;
}

/**
 * Route Item data to specific migration functions based on type.
 */
function migrateItemData(item) {
  let updateData = {};

  if (item.type === "weapon") updateData = foundry.utils.mergeObject(updateData, migrateWeapon(item));
  else if (item.type === "armor") updateData = foundry.utils.mergeObject(updateData, migrateArmor(item));
  else if (item.type === "shield") updateData = foundry.utils.mergeObject(updateData, migrateShield(item));
  else if (item.type === "technique") updateData = foundry.utils.mergeObject(updateData, migrateMagicItem(item));
  else if (item.type === "discipline") updateData = foundry.utils.mergeObject(updateData, migrateMagicItem(item));
  else if (item.type === "spell") updateData = foundry.utils.mergeObject(updateData, migrateSpell(item));
  else if (item.type === "gear") updateData = foundry.utils.mergeObject(updateData, migrateGear(item));
  else if (item.type === "advantage") updateData = foundry.utils.mergeObject(updateData, migrateAdvantage(item));
  else if (item.type === "problem") updateData = foundry.utils.mergeObject(updateData, migrateProblem(item));

  return updateData;
}

function migrateCharacter(actor) {
  const updateData = {};
  const system = actor.system || {};

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
  if (!Number.isInteger(modifiers.pool)) updateData["system.modifiers.pool"] = Number(modifiers.pool) || 0;
  if (!Number.isInteger(modifiers.armor)) updateData["system.modifiers.armor"] = Number(modifiers.armor) || 0;
  if (!Number.isInteger(modifiers.speed)) updateData["system.modifiers.speed"] = Number(modifiers.speed) || 0;

  const esoterica = system.esoterica || {};
  if (esoterica.attunement === null || esoterica.attunement === undefined) {
    updateData["system.esoterica.attunement"] = "";
  }

  const xp = system.xp || {};
  if (!Number.isInteger(xp.value)) updateData["system.xp.value"] = Number(xp.value) || 0;
  if (!Number.isInteger(xp.spent)) updateData["system.xp.spent"] = Number(xp.spent) || 0;

  const wealth = system.wealth || {};
  if (!Number.isInteger(wealth.value)) updateData["system.wealth.value"] = Number(wealth.value) || 0;

  const health = system.health || {};
  const expectedHealth = {
    head: 4,
    torso: 10,
    armL: 5,
    armR: 5,
    legL: 5,
    legR: 5
  };

  for (const [loc, max] of Object.entries(expectedHealth)) {
    const current = health[loc] || {};
    if (!Number.isInteger(current.shock)) updateData[`system.health.${loc}.shock`] = Number(current.shock) || 0;
    if (!Number.isInteger(current.killing)) updateData[`system.health.${loc}.killing`] = Number(current.killing) || 0;
    if (!Number.isInteger(current.max)) updateData[`system.health.${loc}.max`] = max;
    if (!Number.isInteger(current.armor)) updateData[`system.health.${loc}.armor`] = Number(current.armor) || 0;
  }

  return updateData;
}

function migrateCompany(actor) {
  const updateData = {};
  const system = actor.system || {};
  const qualities = system.qualities || {};

  for (const key of ["might", "treasure", "influence", "territory", "sovereignty"]) {
    const quality = qualities[key] || {};
    if (!Number.isInteger(quality.permanent)) updateData[`system.qualities.${key}.permanent`] = Number(quality.permanent) || 0;
    if (!Number.isInteger(quality.current)) updateData[`system.qualities.${key}.current`] = Number(quality.current) || 0;
    if (quality.notes === null || quality.notes === undefined) updateData[`system.qualities.${key}.notes`] = "";
  }

  const biography = system.biography || {};
  if (biography.description === null || biography.description === undefined) updateData["system.biography.description"] = "";
  if (biography.assets === null || biography.assets === undefined) updateData["system.biography.assets"] = "";

  return updateData;
}

function migrateThreat(actor) {
  const updateData = {};
  const system = actor.system || {};

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

  return updateData;
}

function migrateWeapon(item) {
  const updateData = {};
  const system = item.system || {};
  const qualities = system.qualities || {};

  if (system.damage === null || system.damage === undefined || system.damage === "") {
    updateData["system.damage"] = "Width Shock";
  }

  if (system.pool === null || system.pool === undefined) updateData["system.pool"] = "";
  if (system.range === null || system.range === undefined) updateData["system.range"] = "";
  if (system.notes === null || system.notes === undefined) updateData["system.notes"] = "";
  
  // AUDIT FIX 2.1: Backfill missing equipped field
  if (typeof system.equipped !== "boolean") updateData["system.equipped"] = false;

  if (!Number.isInteger(qualities.armorPiercing)) updateData["system.qualities.armorPiercing"] = Number(qualities.armorPiercing) || 0;
  if (!Number.isInteger(qualities.slow)) updateData["system.qualities.slow"] = Number(qualities.slow) || 0;
  if (typeof qualities.twoHanded !== "boolean") updateData["system.qualities.twoHanded"] = false;
  if (typeof qualities.massive !== "boolean") updateData["system.qualities.massive"] = false;
  if (!Number.isInteger(qualities.area)) updateData["system.qualities.area"] = Number(qualities.area) || 0;

  return updateData;
}

function migrateArmor(item) {
  const updateData = {};
  const system = item.system || {};

  if (!["light", "medium", "heavy"].includes(system.armorWeight)) {
    updateData["system.armorWeight"] = "light";
  }

  if (typeof system.equipped !== "boolean") {
    updateData["system.equipped"] = false;
  }

  if (system.notes === null || system.notes === undefined) {
    updateData["system.notes"] = "";
  }

  return updateData;
}

function migrateShield(item) {
  const updateData = {};
  const system = item.system || {};

  if (!["small", "large", "tower"].includes(system.shieldSize)) {
    updateData["system.shieldSize"] = "small";
  }

  if (!["wood", "metal"].includes(system.material)) {
    updateData["system.material"] = "wood";
  }

  if (!["armL", "armR"].includes(system.shieldArm)) {
    updateData["system.shieldArm"] = "armL";
  }

  if (!Number.isInteger(system.parryBonus)) {
    updateData["system.parryBonus"] = Number(system.parryBonus) || 1;
  }

  if (!Number.isInteger(system.coverAR)) {
    updateData["system.coverAR"] = Number(system.coverAR) || 1;
  }

  if (typeof system.equipped !== "boolean") {
    updateData["system.equipped"] = false;
  }

  const protectedLocations = system.protectedLocations || {};
  for (const key of ["head", "torso", "armL", "armR", "legL", "legR"]) {
    if (typeof protectedLocations[key] !== "boolean") {
      updateData[`system.protectedLocations.${key}`] = false;
    }
  }

  if (system.notes === null || system.notes === undefined) {
    updateData["system.notes"] = "";
  }

  return updateData;
}

function migrateMagicItem(item) {
  const updateData = {};
  const system = item.system || {};

  if (system.path === null || system.path === undefined) updateData["system.path"] = "";
  if (!Number.isInteger(system.rank)) updateData["system.rank"] = Number(system.rank) || 1;
  if (system.page === null || system.page === undefined) updateData["system.page"] = "";
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";

  return updateData;
}

function migrateSpell(item) {
  const updateData = {};
  const system = item.system || {};

  if (!Number.isInteger(system.intensity)) updateData["system.intensity"] = Number(system.intensity) || 1;
  if (!Number.isInteger(system.castingTime)) updateData["system.castingTime"] = Number(system.castingTime) || 0;
  
  // NEW: Backfill castingStat for Sorcery flexibility
  if (!system.castingStat) updateData["system.castingStat"] = "knowledge"; 
  
  if (system.pool === null || system.pool === undefined) updateData["system.pool"] = "";
  if (system.page === null || system.page === undefined) updateData["system.page"] = "";
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";

  return updateData;
}

function migrateGear(item) {
  const updateData = {};
  const system = item.system || {};

  if (!Number.isInteger(system.quantity)) updateData["system.quantity"] = Number(system.quantity) || 1;
  if (system.notes === null || system.notes === undefined) updateData["system.notes"] = "";

  return updateData;
}

function migrateAdvantage(item) {
  const updateData = {};
  const system = item.system || {};

  if (!Number.isInteger(system.cost)) updateData["system.cost"] = Number(system.cost) || 1;
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";
  if (system.hook === null || system.hook === undefined) updateData["system.hook"] = "";

  return updateData;
}

function migrateProblem(item) {
  const updateData = {};
  const system = item.system || {};

  if (!Number.isInteger(system.bonus)) updateData["system.bonus"] = Number(system.bonus) || 1;
  if (system.effect === null || system.effect === undefined) updateData["system.effect"] = "";
  if (system.hook === null || system.hook === undefined) updateData["system.hook"] = "";

  return updateData;
}