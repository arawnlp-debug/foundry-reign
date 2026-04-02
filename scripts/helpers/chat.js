// scripts/helpers/chat.js
import { parseORE, getHitLocation, getHitLocationLabel } from "./ore-engine.js";

/**
 * SPRINT 4 (B5.2): Handlebars Partial Helper
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
 * SPRINT 4, 6 & Healing Engine: generateOREChatHTML
 * Refactored to separate Primary Set damage/healing from Scattered Waste effects.
 */
export async function generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);
  
  const isSpell = itemData && itemData.type === "spell";
  const spellIntensity = isSpell ? (parseInt(itemData.system.intensity) || 0) : 0;
  const difficulty = flags.difficulty || 0;

  // Primary Formula extraction
  let rawDmgStr = itemData?.system?.damageFormula || itemData?.system?.damage || "";
  if (!rawDmgStr && flags.isAttack && itemData?.type === "weapon") {
      rawDmgStr = "Width Shock";
  }

  // HEALING ENGINE: Detect if this is a first aid roll or a healing spell
  const isFirstAid = /healing|medicine/i.test(label);
  const isHealingSpell = isSpell && /healing/i.test(rawDmgStr);

  // SECONDARY DAMAGE ENGINE: Extract Waste Damage/Healing Configuration
  let wasteType = null;
  let wasteAp = itemData?.system?.qualities?.armorPiercing || 0;
  const wasteMatch = rawDmgStr.match(/waste\s+(shock|killing|healing)/i);
  if (wasteMatch) {
      wasteType = wasteMatch[1].toLowerCase();
  }

  // Ensure healing magic isn't falsely flagged as a combat attack
  const isAttack = (!!flags.isAttack || (isSpell && rawDmgStr.trim() !== "")) && !isHealingSpell;

  // Build the secondary waste object if unmatched dice exist
  let wasteData = null;
  if (wasteType && parsed.waste.length > 0) {
      const wasteFaces = parsed.waste.map(f => parseInt(f, 10));
      const wasteLocs = wasteFaces.map(f => getHitLocationLabel(getHitLocation(f)).split(" (")[0]);
      wasteData = {
          type: wasteType.charAt(0).toUpperCase() + wasteType.slice(1),
          faces: JSON.stringify(wasteFaces),
          locations: wasteLocs.join(", "),
          ap: wasteAp,
          isHealing: wasteType === "healing"
      };
  }

  const templateData = {
    actorType,
    label: foundry.utils.escapeHTML(label),
    totalPool,
    wasCapped: !!flags.wasCapped,
    isAttack: isAttack,
    isHealingSpell: isHealingSpell,
    isFirstAid: isFirstAid,
    isMinion: !!flags.isMinion,
    multiActions: flags.multiActions || 1,
    calledShot: flags.calledShot || 0,
    expertDie: expertDie || 0,
    masterDiceCount: masterDiceCount || 0,
    sets: [],
    waste: getDiceData(parsed.waste, false, true),
    wasteDmg: wasteData, // Injected for scattered damage/healing UI
    itemUuid: itemData?.uuid || null,
    hasEffects: !!itemData?.hasEffects 
  };

  // Process Primary Sets for Template
  parsed.sets.forEach(s => {
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
      text: s.text,
      location: (actorType === "character" && (isAttack || isHealingSpell || isFirstAid)) ? getHitLocationLabel(locKey) : null,
      isSuccess,
      failReason,
      dice: getDiceData(Array(s.width).fill(s.height), isSuccess, false),
      dmg: null,
      heal: null
    };

    // Calculate Primary Attack / Spell Damage / Healing data
    if ((isAttack || isHealingSpell) && rawDmgStr.trim() !== "") {
      // Clean the formula: Remove the Waste portion so it doesn't break primary set math
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
                ap: itemData.system.qualities?.armorPiercing || 0,
                slow: itemData.system.qualities?.slow || 0,
                twoHanded: !!itemData.system.qualities?.twoHanded,
                massive: !!itemData.system.qualities?.massive,
                area: parseInt(itemData.system.qualities?.area) || 0
            };
        }
      }
    }

    if (actorType === "company" && flags.targetQuality && flags.targetQuality !== "none") {
      setObj.companyDmg = { width: s.width, quality: flags.targetQuality.toUpperCase() };
    }

    templateData.sets.push(setObj);
  });

  return await foundry.applications.handlebars.renderTemplate("systems/reign/templates/chat/ore-roll.hbs", templateData);
}

export async function postOREChat(actor, label, totalPool, results, expertDie, masterDiceCount, item = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);

  if (game.combat && actor && parsed.sets.length > 0) {
    const fastestSet = parsed.sets.reduce((max, set) => {
      if (set.width > max.width) return set;
      if (set.width === max.width && set.height > max.height) return set;
      return max;
    });
    
    let initValue = (fastestSet.width * 10) + fastestSet.height; 
    
    const isDefense = /dodge|parry|counterspell/i.test(label);
    if (isDefense) {
        initValue += 0.90;
    } 
    else if (flags.isAttack && item?.type === "weapon") {
        const rangeStr = (item.system.range || "0").toLowerCase().trim();
        let rangeWeight = 0;
        const rangeMap = { "touch": 1, "point": 1, "blank": 1, "short": 2, "medium": 3, "long": 4, "extreme": 6 };
        
        const keyword = Object.keys(rangeMap).find(k => rangeStr.includes(k));
        if (keyword) {
            rangeWeight = rangeMap[keyword];
        } else {
            const match = rangeStr.match(/(\d+)/);
            rangeWeight = match ? parseInt(match[1]) : 0;
        }
        initValue += Math.min(rangeWeight * 0.01, 0.89);
    }
    
    if (flags.isMinion) {
        initValue -= 0.50; 
    }

    const combatants = game.combat.combatants.filter(c => c.actorId === actor.id);
    
    if (item?.type === "weapon" && item.system.qualities?.slow > 0 && combatants.length > 0) {
        const slowRounds = item.system.qualities.slow;
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
        actorType, label, totalPool, results, expertDie, masterDiceCount, 
        itemData, rollFlags: flags 
    } 
  };

  await ChatMessage.create({ 
    speaker: ChatMessage.getSpeaker({ actor }), 
    content: flavor, 
    flags: messageFlags 
  });
}