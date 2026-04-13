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
 * * Gobble Dice Flow:
 * - On defense rolls: if flags.gobbleDice is undefined, auto-generates from matched sets.
 * - On defense regeneration (after consumption): flags.gobbleDice contains the REDUCED array,
 * so the template renders the correct remaining count.
 * - On attack rolls: gobbleDice is null/undefined — template hides the tracker.
 *
 * @param {string} actorType - The type of actor rolling.
 * @param {string} label - The roll label.
 * @param {number} totalPool - Total dice in the pool.
 * @param {Array} results - Array of individual die face results.
 * @param {number} expertDie - The Expert Die face value (0 if none).
 * @param {number} masterDiceCount - Number of Master Dice used.
 * @param {Object|null} itemData - The serialized item data, if any.
 * @param {Object} flags - Additional roll flags (isAttack, isDefense, gobbleDice, etc).
 */
export async function generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);
  
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

  // GOBBLE DICE: If this is a defense roll and no gobbleDice were passed in flags,
  // auto-generate from matched sets. If flags.gobbleDice IS provided (e.g. after consumption),
  // use it directly — this is how the tracker shows the remaining count after a die is spent.
  let gobbleDice = flags.gobbleDice;
  if (isDefense && gobbleDice === undefined) {
      gobbleDice = [];
      parsed.sets.forEach(s => {
          for(let i = 0; i < s.width; i++) gobbleDice.push(s.height);
      });
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
    gobbleDice: gobbleDice,
    gobbleCount: gobbleDice ? gobbleDice.length : 0,
    isHealingSpell: isHealingSpell,
    isFirstAid: isFirstAid,
    isMinion: !!flags.isMinion,
    multiActions: flags.multiActions || 1,
    calledShot: flags.calledShot || 0,
    expertDie: expertDie || 0,
    masterDiceCount: masterDiceCount || 0,
    sets: [],
    waste: getDiceData(parsed.waste, false, true),
    wasteDmg: wasteData, 
    itemUuid: itemData?.uuid || null,
    hasEffects: !!itemData?.hasEffects 
  };

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
        
        // AUDIT FIX P2: Final sanitization pass before sending payload to HTML bindings
        if (isHealingSpell) {
            setObj.heal = {
                formula: foundry.utils.escapeHTML(calculatedVal)
            };
        } else {
            setObj.dmg = {
                formula: foundry.utils.escapeHTML(calculatedVal),
                ap: parseInt(itemData.system.qualities?.armorPiercing) || 0,
                slow: parseInt(itemData.system.qualities?.slow) || 0,
                twoHanded: !!itemData.system.qualities?.twoHanded,
                massive: !!itemData.system.qualities?.massive,
                area: parseInt(itemData.system.qualities?.area) || 0
            };
        }
      }
    }

    if (actorType === "company" && flags.targetQuality && flags.targetQuality !== "none") {
      setObj.companyDmg = { width: s.width, quality: foundry.utils.escapeHTML(flags.targetQuality.toUpperCase()) };
    }

    templateData.sets.push(setObj);
  });

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
 */
export async function postOREChat(actor, label, totalPool, results, expertDie, masterDiceCount, item = null, flags = {}, rollInstance = null) {
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

  // GOBBLE DICE: Auto-generate for defense rolls if not explicitly provided.
  // These are stored in the message flags and consumed by damage.js consumeGobbleDie().
  let gobbleDice = flags.gobbleDice;
  if (isDefense && gobbleDice === undefined) {
      gobbleDice = [];
      parsed.sets.forEach(s => {
          for(let i = 0; i < s.width; i++) gobbleDice.push(s.height);
      });
      flags.gobbleDice = gobbleDice;
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
  const itemData = item ? (typeof item.toObject === "function" ? item.toObject() : item) : null;
  
  if (itemData && item) {
      itemData.uuid = item.uuid;
      itemData.hasEffects = (item.effects && item.effects.size > 0);
  }
  
  const flavor = await generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData, flags);

  const messageFlags = { 
    reign: { 
        actorType, label: safeLabel, totalPool, results, expertDie, masterDiceCount, 
        itemData, rollFlags: flags,
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