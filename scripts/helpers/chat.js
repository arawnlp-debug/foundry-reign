// scripts/helpers/chat.js
import { parseORE, getHitLocation, getHitLocationLabel } from "./ore-engine.js";

/**
 * SPRINT 4 (B5.2): Handlebars Partial Helper
 * Generates data for visual 10-sided dice icons.
 * This is now passed to the template as data objects rather than raw HTML strings.
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
 * SPRINT 4 (B5.2): generateOREChatHTML
 * Refactored to gather data and render via a Handlebars template.
 * This function is now ASYNC to support renderTemplate.
 */
export async function generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);
  
  const isSpell = itemData && itemData.type === "spell";
  const spellIntensity = isSpell ? (parseInt(itemData.system.intensity) || 0) : 0;
  const difficulty = flags.difficulty || 0;

  const templateData = {
    actorType,
    label: foundry.utils.escapeHTML(label),
    totalPool,
    wasCapped: !!flags.wasCapped,
    isAttack: !!flags.isAttack,
    isMinion: !!flags.isMinion,
    multiActions: flags.multiActions || 1,
    calledShot: flags.calledShot || 0,
    expertDie: expertDie || 0,
    masterDiceCount: masterDiceCount || 0,
    sets: [],
    waste: getDiceData(parsed.waste, false, true)
  };

  // Process Sets for Template
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
      location: (actorType === "character" && flags.isAttack) ? getHitLocationLabel(locKey) : null,
      isSuccess,
      failReason,
      dice: getDiceData(Array(s.width).fill(s.height), isSuccess, false),
      dmg: null
    };

    // Calculate Attack Damage data
    if (flags.isAttack && itemData) {
      let weaponDmgStr = itemData.system.damageFormula || itemData.system.damage || "Width Shock";
      let calculatedDmg = weaponDmgStr.replace(/width/ig, s.width);
      calculatedDmg = calculatedDmg.replace(/(\d+)\s*\+\s*(\d+)/g, (match, a, b) => parseInt(a) + parseInt(b));
      
      setObj.dmg = {
        formula: foundry.utils.escapeHTML(calculatedDmg),
        ap: itemData.system.qualities?.armorPiercing || 0,
        slow: itemData.system.qualities?.slow || 0,
        twoHanded: !!itemData.system.qualities?.twoHanded,
        massive: !!itemData.system.qualities?.massive,
        area: parseInt(itemData.system.qualities?.area) || 0
      };
    }

    // Calculate Company Damage data
    if (actorType === "company" && flags.targetQuality && flags.targetQuality !== "none") {
      setObj.companyDmg = {
        width: s.width,
        quality: flags.targetQuality.toUpperCase()
      };
    }

    templateData.sets.push(setObj);
  });

  // V13 FIX: Strict namespace access for renderTemplate to eliminate deprecation warnings
  return await foundry.applications.handlebars.renderTemplate("systems/reign/templates/chat/ore-roll.hbs", templateData);
}

/**
 * postOREChat
 * Handles the database logic and initiative calculation.
 */
export async function postOREChat(actor, label, totalPool, results, expertDie, masterDiceCount, item = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);

  if (game.combat && actor && parsed.sets.length > 0) {
    const fastestSet = parsed.sets.reduce((max, set) => {
      if (set.width > max.width) return set;
      if (set.width === max.width && set.height > max.height) return set;
      return max;
    });
    
    // TIER 1 & 2: Base Width and Height
    let initValue = (fastestSet.width * 10) + fastestSet.height; 
    
    // TIER 3: Active Defenses act first (+0.90)
    const isDefense = /dodge|parry|counterspell/i.test(label);
    if (isDefense) {
        initValue += 0.90;
    } 
    // TIER 4: Weapon Length Tie-Breaker
    else if (flags.isAttack && item?.type === "weapon") {
        const rangeStr = (item.system.range || "0").toLowerCase().trim();
        let rangeWeight = 0;

        // PERFECTED: Maps text strings directly to RAW ORE Weapon Lengths (1 to 6)
        const rangeMap = {
            "touch": 1, "point": 1, "blank": 1,
            "short": 2,
            "medium": 3,
            "long": 4,
            "extreme": 6
        };
        
        const keyword = Object.keys(rangeMap).find(k => rangeStr.includes(k));
        if (keyword) {
            rangeWeight = rangeMap[keyword];
        } else {
            const match = rangeStr.match(/(\d+)/);
            rangeWeight = match ? parseInt(match[1]) : 0;
        }
        
        // Multiplies the Length by 0.01 (e.g. Length 4 = 0.04)
        initValue += Math.min(rangeWeight * 0.01, 0.89);
    }
    
    // TIER 5: Minions lose all ties to PCs (-0.50)
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
  
  // SPRINT 4 (B5.2): generateOREChatHTML is now awaited
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