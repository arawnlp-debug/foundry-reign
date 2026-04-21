// scripts/helpers/chat.js
import { parseORE, getHitLocation, getHitLocationLabel, calculateInitiative } from "./ore-engine.js";

/**
 * Generates data for visual 10-sided dice icons.
 */
function getDiceData(diceArray, isSuccess = true, isWaste = false) {
  if (!diceArray || diceArray.length === 0) return [];
  
  return diceArray.map(rawFaceValue => {
    const faceValue = parseInt(rawFaceValue, 10);
    if (isNaN(faceValue)) return null;

    let cssClass = "matched";
    if (isWaste) cssClass = "waste";
    else if (!isSuccess) cssClass = "failed";

    return { value: faceValue, cssClass };
  }).filter(d => d !== null);
}

/**
 * Generates the full ORE chat card HTML from roll results.
 * * Gobble Dice Flow (V2.0.0 RAW Fix):
 * - On defense rolls: if flags.gobbleDice is undefined AND there is >1 set, we prompt the user.
 * - If there is only 1 set, we auto-assign it.
 *
 * @param {string} actorType - The type of actor rolling.
 * @param {string} label - The roll label.
 * @param {number} totalPool - Total dice in the pool.
 * @param {Array} results - Array of individual die face results.
 * @param {number} expertDie - The Expert Die face value (0 if none).
 * @param {number} masterDiceCount - Number of Master Dice used.
 * @param {Object|null} itemData - The serialized item data, if any.
 * @param {Object} flags - Additional roll flags (isAttack, isDefense, gobbleDice, etc).
 * @param {Object|null} [parsedOverride=null] - Pre-parsed ORE result to avoid redundant re-parsing.
 */
export async function generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData = null, flags = {}, parsedOverride = null) {
  const parsed = parsedOverride || parseORE(results, flags.isMinion);
  
  const isSpell = itemData && itemData.type === "spell";
  const spellIntensity = isSpell ? (parseInt(itemData.system.intensity) || 0) : 0;
  const difficulty = flags.difficulty || 0;

  // AUDIT FIX P2: Security - Escape all raw string inputs from items to prevent XSS
  let rawDmgStr = itemData?.system?.damageFormula || itemData?.system?.damage || "";
  if (typeof rawDmgStr === "string") rawDmgStr = foundry.utils.escapeHTML(rawDmgStr);
  
  if (!rawDmgStr && flags.isAttack && itemData?.type === "weapon") {
      rawDmgStr = "Width Shock";
  }

  const safeLabel = foundry.utils.escapeHTML(label);
  const isDefense = flags.isDefense || /dodge|parry|counterspell/i.test(safeLabel);
  let defenseType = "none";
  if (isDefense) {
      if (/dodge/i.test(safeLabel)) defenseType = "dodge";
      else if (/parry/i.test(safeLabel)) defenseType = "parry";
      else if (/counterspell/i.test(safeLabel)) defenseType = "counterspell";
      else defenseType = "generic";
  }

  // P1 RAW FIX: Stop auto-gobbling all sets.
  let gobbleDice = flags.gobbleDice;
  let needsGobbleSelection = false;
  
  if (isDefense && gobbleDice === undefined) {
      if (parsed.sets.length === 1) {
          // If only one set was rolled, auto-assign it for UX speed
          gobbleDice = [];
          for (let i = 0; i < parsed.sets[0].width; i++) gobbleDice.push(parsed.sets[0].height);
      } else if (parsed.sets.length > 1) {
          // If multiple sets were rolled, flag the template to show the selection buttons
          needsGobbleSelection = true;
          gobbleDice = null;
      }
  }

  const isFirstAid = /healing|medicine/i.test(safeLabel);
  const isHealingSpell = isSpell && /healing/i.test(rawDmgStr);

  let wasteType = null;
  let wasteAp = itemData?.system?.qualities?.armorPiercing || 0;
  const wasteMatch = rawDmgStr.match(/waste\s+(shock|killing|healing)/i);
  if (wasteMatch) {
      wasteType = foundry.utils.escapeHTML(wasteMatch[1].toLowerCase());
  }

  const isAttack = (!!flags.isAttack || (isSpell && rawDmgStr.trim() !== "")) && !isHealingSpell && !isDefense;

  let wasteData = null;
  if (wasteType && parsed.waste.length > 0 && !isDefense) {
      const wasteFaces = parsed.waste.map(f => parseInt(f, 10));
      const wasteLocs = wasteFaces.map(f => getHitLocationLabel(getHitLocation(f)).split(" (")[0]);
      wasteData = {
          type: wasteType.charAt(0).toUpperCase() + wasteType.slice(1),
          faces: JSON.stringify(wasteFaces),
          locations: foundry.utils.escapeHTML(wasteLocs.join(", ")),
          ap: parseInt(wasteAp) || 0,
          isHealing: wasteType === "healing"
      };
  }

  // PHASE 4: MAGIC TRANSFER SYSTEM
  // Check if at least one set actually succeeded to reveal the Apply Effect button
  let hasSuccessfulSet = false;

  const setsData = [];
  parsed.sets.forEach((s, index) => {
    let locKey = getHitLocation(s.height);
    let isSuccess = true;
    let failReason = "";

    if (s.height < difficulty) {
      isSuccess = false;
      failReason = `Difficulty ${difficulty} Required`;
    } else if (isSpell && s.height < spellIntensity) {
      isSuccess = false;
      failReason = `Intensity ${spellIntensity} Required`;
    }

    if (isSuccess) hasSuccessfulSet = true;

    const setObj = {
      width: s.width,
      height: s.height,
      text: foundry.utils.escapeHTML(s.text),
      location: (actorType === "character" && (isAttack || isHealingSpell || isFirstAid) && !isDefense) ? foundry.utils.escapeHTML(getHitLocationLabel(locKey)) : null,
      isSuccess,
      failReason: foundry.utils.escapeHTML(failReason),
      dice: getDiceData(Array(s.width).fill(s.height), isSuccess, false),
      dmg: null,
      heal: null,
      companyDmg: null,
      initBtn: parsed.sets.length > 1
    };

    if ((isAttack || isHealingSpell) && rawDmgStr.trim() !== "") {
      let primaryStr = rawDmgStr.replace(/waste\s+(shock|killing|healing)/ig, "").replace(/^\s*\+\s*/, "").replace(/\s*\+\s*$/, "").trim();

      if (primaryStr.length > 0) {
        let calculatedVal = primaryStr.replace(/width/ig, s.width);
        calculatedVal = calculatedVal.replace(/(\d+)\s*\+\s*(\d+)/g, (match, a, b) => parseInt(a) + parseInt(b));
        
        if (isHealingSpell) {
            setObj.heal = {
                formula: foundry.utils.escapeHTML(calculatedVal)
            };
        } else {
            setObj.dmg = {
                formula: foundry.utils.escapeHTML(calculatedVal),
                ap: parseInt(itemData?.system?.qualities?.armorPiercing) || 0,
                slow: parseInt(itemData?.system?.qualities?.slow) || 0,
                twoHanded: !!itemData?.system?.qualities?.twoHanded,
                massive: !!itemData?.system?.qualities?.massive,
                area: parseInt(itemData?.system?.qualities?.area) || 0
            };
        }
      }
    }

    if (actorType === "company" && flags.targetQuality && flags.targetQuality !== "none") {
      setObj.companyDmg = { width: s.width, quality: foundry.utils.escapeHTML(flags.targetQuality.toUpperCase()) };
    }

    setsData.push(setObj);
  });

  const templateData = {
    actorType: foundry.utils.escapeHTML(actorType),
    label: safeLabel,
    totalPool,
    wasCapped: !!flags.wasCapped,
    poolBreakdown: flags.poolBreakdown || [],
    isAttack: isAttack,
    isDefense: isDefense,
    defenseType: defenseType,
    defenseTypeLabel: defenseType !== "none" ? (defenseType.charAt(0).toUpperCase() + defenseType.slice(1)) : "",
    needsGobbleSelection: needsGobbleSelection,
    gobbleDice: gobbleDice,
    gobbleCount: gobbleDice ? gobbleDice.length : 0,
    isHealingSpell: isHealingSpell,
    isFirstAid: isFirstAid,
    isMinion: !!flags.isMinion,
    multiActions: flags.multiActions || 1,
    calledShot: flags.calledShot || 0,
    expertDie: expertDie || 0,
    masterDiceCount: masterDiceCount || 0,
    sets: setsData,
    hasSuccessfulSet: hasSuccessfulSet, 
    waste: getDiceData(parsed.waste, false, true),
    wasteDmg: wasteData, 
    itemUuid: itemData?.uuid || null,
    hasEffects: !!itemData?.hasEffects 
  };

  return await foundry.applications.handlebars.renderTemplate("systems/reign/templates/chat/ore-roll.hbs", templateData);
}

/**
 * Posts a complete ORE roll result to the chat log.
 * Handles initiative calculation, Gobble Dice generation for defense rolls,
 * slow weapon cooldowns, and Dice So Nice integration.
 *
 * @param {Actor} actor - The rolling actor.
 * @param {string} label - The roll label.
 * @param {number} totalPool - Total dice in the pool.
 * @param {Array} results - Array of individual die face results.
 * @param {number} expertDie - The Expert Die face value (0 if none).
 * @param {number} masterDiceCount - Number of Master Dice used.
 * @param {Item|null} item - The source item, if any.
 * @param {Object} flags - Additional roll flags.
 * @param {Roll|null} rollInstance - The Foundry Roll object for Dice So Nice.
 * @param {Object} advancedMods - Snapshot of active modifier data to prevent state desync.
 */
export async function postOREChat(actor, label, totalPool, results, expertDie, masterDiceCount, item = null, flags = {}, rollInstance = null, advancedMods = {}) {
  const parsed = parseORE(results, flags.isMinion);

  const safeLabel = foundry.utils.escapeHTML(label);
  const isDefense = flags.isDefense || /dodge|parry|counterspell/i.test(safeLabel);
  let defenseType = "none";
  if (isDefense) {
      if (/dodge/i.test(safeLabel)) defenseType = "dodge";
      else if (/parry/i.test(safeLabel)) defenseType = "parry";
      else if (/counterspell/i.test(safeLabel)) defenseType = "counterspell";
      else defenseType = "generic";
  }

  // P1 RAW FIX: Stop auto-gobbling all sets. Only auto-gobble if exactly 1 set.
  let gobbleDice = flags.gobbleDice;
  if (isDefense && gobbleDice === undefined) {
      if (parsed.sets.length === 1) {
          gobbleDice = [];
          for (let i = 0; i < parsed.sets[0].width; i++) gobbleDice.push(parsed.sets[0].height);
          flags.gobbleDice = gobbleDice;
      }
  }

  if (game.combat && actor && parsed.sets.length > 0) {
    const range = item?.type === "weapon" ? (item.system.range || "0") : "0";
    const initValue = calculateInitiative(parsed.sets, isDefense, flags.isAttack, flags.isMinion, foundry.utils.escapeHTML(range));

    const combatants = game.combat.combatants.filter(c => c.actorId === actor.id);
    
    if (item?.type === "weapon" && item.system.qualities?.slow > 0 && combatants.length > 0) {
        const slowRounds = parseInt(item.system.qualities.slow) || 0;
        const currentRound = game.combat.round;
        const updates = combatants.map(c => ({ _id: c.id, initiative: initValue, "flags.reign.slowCooldown": currentRound + slowRounds }));
        await game.combat.updateEmbeddedDocuments("Combatant", updates);
    } else if (combatants.length > 0) {
        const updates = combatants.map(c => ({ _id: c.id, initiative: initValue }));
        await game.combat.updateEmbeddedDocuments("Combatant", updates);
    }
  }

  const actorType = actor?.type || "character";
  
  // Slim projection: only serialize the fields actually consumed by chat cards and damage applicators.
  // Avoids bloating ChatMessage documents with full item notes/HTML/effect arrays.
  const itemData = item ? {
    uuid: item.uuid,
    name: item.name,
    type: item.type,
    hasEffects: item.effects ? (item.effects.size > 0 || item.effects.contents?.length > 0) : false,
    system: {
      damageFormula: item.system.damageFormula,
      damage: item.system.damage,
      range: item.system.range,
      intensity: item.system.intensity,
      pool: item.system.pool,
      castingStat: item.system.castingStat,
      qualities: item.system.qualities ? foundry.utils.deepClone(item.system.qualities) : {}
    }
  } : null;
  
  const flavor = await generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData, flags, parsed);

  // ✅ Serialize `advancedMods` natively into `rollFlags`
  const messageFlags = { 
    reign: { 
        actorType, label: safeLabel, totalPool, results, expertDie, masterDiceCount, 
        itemData, rollFlags: { ...flags, advancedMods },
        isDefense, defenseType, gobbleDice
    } 
  };

  const messageData = { 
    speaker: ChatMessage.getSpeaker({ actor }), 
    content: flavor, 
    flags: messageFlags 
  };

  if (rollInstance) {
      messageData.rolls = [rollInstance];
  }

  await ChatMessage.create(messageData);
}

/**
 * P1 RAW FIX: Assigns a specific set to become the Gobble Dice pool.
 * This is triggered when a player clicks a set on a defense card with multiple options.
 */
export async function assignGobbleSet(message, width, height) {
    const flags = message.flags?.reign;
    if (!flags) return;

    const newGobbleArray = [];
    for (let i = 0; i < width; i++) {
        newGobbleArray.push(height);
    }

    const updatedRollFlags = foundry.utils.deepClone(flags.rollFlags || {});
    updatedRollFlags.gobbleDice = newGobbleArray;

    const newContent = await generateOREChatHTML(
        flags.actorType,
        flags.label,
        flags.totalPool,
        flags.results,
        flags.expertDie,
        flags.masterDiceCount,
        flags.itemData,
        updatedRollFlags
    );

    await message.update({
        content: newContent,
        "flags.reign.rollFlags": updatedRollFlags,
        "flags.reign.gobbleDice": newGobbleArray
    });
    
    ui.notifications.info(`Assigned ${width}x${height} as Gobble Dice.`);
}

/**
 * PHASE 4: MAGIC TRANSFER SYSTEM
 * Extracts Active Effects from a source Item and copies them to all currently targeted Tokens.
 * This is triggered by the UI button on a successful Spell or Technique chat card.
 */
export async function applyItemEffectsToTargets(itemUuid) {
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) return ui.notifications.warn("Please target at least one token to apply the effect to.");

    const item = await fromUuid(itemUuid);
    if (!item) return ui.notifications.error("Could not find the source item to extract effects from.");

    // Retrieve native Active Effects
    const effects = Array.from(item.effects || []);
    if (effects.length === 0) return ui.notifications.warn(`The item '${item.name}' has no Active Effects built into it.`);

    const effectsToApply = effects.map(e => {
        let effData = e.toObject();
        effData.origin = itemUuid;
        effData.disabled = false; // Force the effect to be active immediately when pasted onto the target
        delete effData._id;       // Strip ID to ensure Foundry creates a new instance on the target
        return effData;
    });

    for (const target of targets) {
        const actor = target.actor;
        if (!actor) continue;
        
        await actor.createEmbeddedDocuments("ActiveEffect", effectsToApply);
        
        const safeItemName = foundry.utils.escapeHTML(item.name);
        const safeTargetName = foundry.utils.escapeHTML(actor.name);
        
        // Post a stylized narrative chat message confirming the transfer
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: game.user.character }),
            content: `<div class="reign-chat-card reign-card-magic">
                        <h3 class="reign-text-magic"><i class="fas fa-sparkles"></i> Effect Applied</h3>
                        <p>The mystical effects of <strong>${safeItemName}</strong> wrap around <strong>${safeTargetName}</strong>.</p>
                      </div>`
        });
    }
    
    ui.notifications.success(`Successfully applied ${item.name} effects to ${targets.length} target(s).`);
}