// scripts/system/migration.js

/**
 * Main entry point for the migration engine.
 * Triggered in reign.mjs when the system version exceeds the world's last saved version.
 */
export async function migrateWorld() {
  ui.notifications.info(`Reign System Migration started! Please do not close your game...`, { permanent: true });
  console.log("Reign | Beginning world migration...");

  let migrationCount = 0; // NEW: Track if anything actually migrates

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
        }
      }
    }
  }

  // FIXED: Only pop the success notification if we actually migrated something
  if (migrationCount > 0) {
    ui.notifications.info(`Reign System Migration complete! Migrated ${migrationCount} entities.`, { permanent: true });
  }
  console.log("Reign | World migration complete.");
}

/**
 * Route Actor data to specific migration functions based on type.
 */
function migrateActorData(actor) {
  let updateData = {};
  
  // Future-proofing: When we move to TypeDataModels, the old data will often be pushed
  // into a `system._source` object by Foundry. We check for what needs updating here.
  
  if (actor.type === "character") {
    // updateData = migrateCharacter(actor);
  } else if (actor.type === "company") {
    // updateData = migrateCompany(actor);
  } else if (actor.type === "threat") {
    // updateData = migrateThreat(actor);
  }

  return updateData;
}

/**
 * Route Item data to specific migration functions based on type.
 */
function migrateItemData(item) {
  let updateData = {};
  
  // Example future check:
  // if (item.type === "weapon") updateData = migrateWeapon(item);

  return updateData;
}