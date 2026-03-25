// scripts/helpers/chat.js
import { parseORE, getHitLocation, getHitLocationLabel } from "./ore-engine.js";

export function generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);
  let setsHtml = "";

  const isSpell = itemData && itemData.type === "spell";
  const spellIntensity = isSpell ? (parseInt(itemData.system.intensity) || 0) : 0;
  const difficulty = flags.difficulty || 0;
  
  // Escape the label to prevent XSS injection via custom skill/item names
  const safeLabel = foundry.utils.escapeHTML(label);

  if (parsed.sets.length > 0) {
    setsHtml = `<ul style="list-style: none; padding: 0; margin: 5px 0;">`;
    parsed.sets.forEach(s => {
      let locKey = getHitLocation(s.height);
      let locHtml = (actorType === "character" && flags.isAttack) ? ` &rarr; ${getHitLocationLabel(locKey)}` : "";
      
      let isSuccess = true;
      let failLabel = "";
      
      if (s.height < difficulty) {
        isSuccess = false;
        failLabel = `<span style="color: red; font-size: 0.8em; margin-left: 5px;">(Failed: Difficulty ${difficulty} Req.)</span>`;
      } 
      else if (isSpell && s.height < spellIntensity) {
        isSuccess = false;
        failLabel = `<span style="color: red; font-size: 0.8em; margin-left: 5px;">(Failed: Intensity ${spellIntensity} Req.)</span>`;
      }

      let buttonsHtml = `<div style="display: flex; gap: 5px;">`;
      
      buttonsHtml += `
        <button class="gobble-dmg-btn" data-height="${s.height}" style="flex: 0 0 30px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; background: #e0f2f1; border: 1px solid #00897b; border-radius: 3px; color: #00695c;" title="Gobble 1 Die (Active Defense)">
          <i class="fas fa-shield-alt"></i>
        </button>`;

      let dmgFooterHtml = "";

      if (flags.isAttack) {
        let weaponDmgStr = itemData?.system?.damageFormula || itemData?.system?.damage || "Width Shock";
        let calculatedDmgStr = weaponDmgStr.replace(/width/ig, s.width);
        calculatedDmgStr = calculatedDmgStr.replace(/(\d+)\s*\+\s*(\d+)/g, (match, a, b) => parseInt(a) + parseInt(b));
        
        // Escape the calculated damage string to prevent XSS via custom damage formulas
        let safeDmgStr = foundry.utils.escapeHTML(calculatedDmgStr);

        let ap = itemData?.system?.qualities?.armorPiercing || 0;
        let slow = itemData?.system?.qualities?.slow || 0;
        let isTwoHanded = itemData?.system?.qualities?.twoHanded || false;
        let isMassive = itemData?.system?.qualities?.massive || false;
        
        // FIXED: Area is now parsed as a number of dice instead of a boolean
        let areaDice = parseInt(itemData?.system?.qualities?.area) || 0;

        let qualityTags = "";
        if (ap > 0) qualityTags += `<span style="background:#333; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">AP ${ap}</span> `;
        if (slow > 0) qualityTags += `<span style="background:#555; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">SLOW ${slow}</span> `;
        if (isTwoHanded) qualityTags += `<span style="background:#4a4a8a; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">2H</span> `;
        if (isMassive) qualityTags += `<span style="background:#6b3a1f; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">MASSIVE</span> `;
        if (areaDice > 0) qualityTags += `<span style="background:#d97706; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">AREA ${areaDice}d</span>`;

        buttonsHtml += `
          <button class="apply-dmg-btn" data-width="${s.width}" data-height="${s.height}" data-dmg-string="${safeDmgStr}" data-ap="${ap}" data-massive="${isMassive}" data-area-dice="${areaDice}" style="flex: 0 0 30px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Apply Damage to Target" ${!isSuccess ? 'disabled' : ''}>
            <i class="fas fa-hand-fist"></i>
          </button>`;
          
        dmgFooterHtml = `<div style="font-size: 0.85em; color: #333; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
            <span><strong>Damage:</strong> ${safeDmgStr}</span>
            <div>${qualityTags}</div>
        </div>`;
      }
      
      if (actorType === "company" && flags.targetQuality && flags.targetQuality !== "none") {
        buttonsHtml += `
          <button class="apply-company-dmg-btn" data-width="${s.width}" data-quality="${flags.targetQuality}" style="flex: 0 0 30px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; background: #fff3e0; border: 1px solid #ff9800; color: #e65100;" title="Apply Width Damage to Target Company's Quality" ${!isSuccess ? 'disabled' : ''}>
            <i class="fas fa-chess-rook"></i>
          </button>`;
          
        dmgFooterHtml = `<div style="font-size: 0.85em; color: #e65100; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
            <span><strong>Company Damage:</strong> Width (${s.width}) to ${flags.targetQuality.toUpperCase()}</span>
        </div>`;
      }

      buttonsHtml += `</div>`;

      setsHtml += `
        <li class="ore-set-row" style="margin-bottom: 8px; padding: 5px; background: rgba(0,0,0,0.05); border-left: 3px solid ${isSuccess ? '#8b1f1f' : '#999'}; opacity: ${isSuccess ? '1' : '0.6'};">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 1.1em; font-weight: bold; color: ${isSuccess ? '#8b1f1f' : '#666'}; ${!isSuccess ? 'text-decoration: line-through;' : ''}">${s.text}${locHtml}${failLabel}</div>
            ${buttonsHtml}
          </div>
          ${dmgFooterHtml}
        </li>`;
    });
    setsHtml += `</ul>`;
  } else {
    setsHtml = `<div><em>No Sets Found</em></div>`;
  }

  let flagsHtml = "";
  if (flags.multiActions > 1) {
    flagsHtml += `<div style="background: #ffecb3; color: #d97706; padding: 4px; font-weight: bold; text-align: center; margin-bottom: 5px; border: 1px solid #d97706; border-radius: 3px; font-size: 0.9em;">ATTEMPTING ${flags.multiActions} ACTIONS<br><span style="font-size: 0.85em; font-weight: normal;">(Requires ${flags.multiActions} matched sets)</span></div>`;
  }
  if (flags.calledShot > 0) {
    flagsHtml += `<div style="background: #e0f2f1; color: #00695c; padding: 4px; font-weight: bold; text-align: center; margin-bottom: 5px; border: 1px solid #00897b; border-radius: 3px; font-size: 0.9em;">CALLED SHOT: Height ${flags.calledShot}</div>`;
  }

  const wasteString = parsed.waste.length > 0 ? parsed.waste.join(", ") : "None";
  
  let flavor = `<div class="reign-chat-card"><header><h3>Rolling ${safeLabel}</h3></header>`;
  flavor += flagsHtml;
  flavor += `<div class="pool-details">Pool: ${totalPool}d10 ${flags.wasCapped ? "(Penalties absorbed by pool overflow)" : ""}</div><hr>`;
  flavor += `<div class="sets-result">${setsHtml}</div><hr>`;
  flavor += `<div class="waste-result"><strong>Unmatched:</strong> ${wasteString}</div>`;
  if (expertDie > 0) flavor += `<div class="ed-result"><strong>Expert Die:</strong> ${expertDie}</div>`;
  if (masterDiceCount > 0) flavor += `<div class="md-result"><strong>Master Dice:</strong> ${masterDiceCount}</div>`;
  flavor += `</div>`;

  return flavor;
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
    
    if (flags.isMinion) {
        initValue -= 0.1; // Minions lose initiative ties
    }

    const combatants = game.combat.combatants.filter(c => c.actorId === actor.id);
    
    if (item?.type === "weapon" && item.system.qualities?.slow > 0 && combatants.length > 0) {
        const slowRounds = item.system.qualities.slow;
        const currentRound = game.combat.round;
        const updates = combatants.map(c => ({ _id: c.id, initiative: initValue, "flags.reign.slowCooldown": currentRound + slowRounds }));
        game.combat.updateEmbeddedDocuments("Combatant", updates);
    } else if (combatants.length > 0) {
        const updates = combatants.map(c => ({ _id: c.id, initiative: initValue }));
        game.combat.updateEmbeddedDocuments("Combatant", updates);
    }
  }

  const actorType = actor?.type || "character";
  const itemData = item ? (typeof item.toObject === 'function' ? item.toObject() : item) : null;
  const flavor = generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData, flags);

  const messageFlags = { reign: { actorType, label, totalPool, results, expertDie, masterDiceCount, itemData, rollFlags: flags } };
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: flavor, flags: messageFlags });
}