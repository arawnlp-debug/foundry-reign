// scripts/combat/damage.js
// FIXED: Added parseORE to imports for the automatic Morale checks
import { computeLocationDamage, getHitLocation, getHitLocationLabel, getEffectiveMax, parseORE } from "../helpers/ore-engine.js";

export async function applyDamageToTarget(width, height, dmgString, ap = 0, isMassive = false, areaDice = 0) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");
  
  const safeDmgStr = String(dmgString || "Width Shock").toLowerCase();
  let baseShock = 0;
  let baseKilling = 0;

  const evalFormula = (match) => {
    if (!match) return 0;
    let expr = match[1].replace(/width/g, width).replace(/\s/g, "");
    
    try {
      let sum = 0;
      let terms = expr.replace(/-/g, '+-').split('+');
      for (let t of terms) {
        if (!t) continue;
        if (t.includes('*')) {
          sum += t.split('*').reduce((a,b) => (Number(a)||0) * (Number(b)||0), 1);
        } else if (t.includes('/')) {
          let [a,b] = t.split('/');
          sum += Math.floor((Number(a)||0) / (Number(b)||1));
        } else {
          sum += Number(t) || 0;
        }
      }
      return sum;
    } catch(e) {
      return parseInt(expr) || 0;
    }
  };

  const shockMatch = safeDmgStr.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*shock/);
  const killMatch = safeDmgStr.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*killing/);

  let displayFormula = dmgString;
  if (!shockMatch && !killMatch) {
    baseShock = evalFormula([null, safeDmgStr]);
    displayFormula += " (Assumed Shock)";
  }

  if (shockMatch) baseShock = evalFormula(shockMatch);
  if (killMatch) baseKilling = evalFormula(killMatch);

  if (isMassive && areaDice === 0) baseKilling += 1;

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor) continue;
    
    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    if (targetActor.type === "threat") {
        let magDmg = baseKilling > 0 ? baseKilling : Math.floor(baseShock / 2);
        if (magDmg < 1) {
            ui.notifications.info(`${safeTargetName} shrugged off the weak attack! (Shock damage must be 2+ to reduce Magnitude)`);
            continue;
        }
        
        let currentMag = targetActor.system.magnitude.value;
        let newMag = Math.max(0, currentMag - magDmg);
        await targetActor.update({ "system.magnitude.value": newMag });
        
        let publicContent = `<div class="reign-chat-card" style="border-color: #8b1f1f;"><h3 style="color: #8b1f1f;">Battlefield Attrition</h3><p>${safeTargetName} took <strong>${magDmg} Magnitude</strong> damage.</p>`;

        // NEW: AUTOMATIC MORALE ROLL WHEN MAGNITUDE IS LOST
        let threatLevel = targetActor.system.threatLevel || 0;
        if (newMag > 0 && threatLevel > 0) {
            const roll = new Roll(`${threatLevel}d10`);
            await roll.evaluate();
            const results = roll.dice[0]?.results.map(r => r.result) || [];
            const parsed = parseORE(results);
            
            publicContent += `<hr><h4>Automatic Morale Check (Pool: ${threatLevel})</h4>`;
            
            if (parsed.sets.length > 0) {
                publicContent += `<p style="color: #2d5a27; font-weight: bold; margin-bottom: 0;">SUCCESS!</p><p style="margin-top: 2px;">The horde holds its ground.</p>`;
            } else {
                let currentMorale = targetActor.system.morale?.value || 0;
                let newMorale = Math.max(0, currentMorale - 1);
                await targetActor.update({ "system.morale.value": newMorale });
                
                publicContent += `<p style="color: #8b1f1f; font-weight: bold; margin-bottom: 0;">FAILURE!</p><p style="margin-top: 2px;">Morale drops to ${newMorale}.</p>`;
                if (newMorale === 0) {
                    publicContent += `<div style="background: #4a0000; color: #fff; padding: 5px; text-align: center; font-weight: bold; font-size: 1.1em; margin-top: 8px; border-radius: 3px;">THE HORDE ROUTS (Zero Morale)</div>`;
                    newMag = 0; 
                    await targetActor.update({ "system.magnitude.value": 0 });
                }
            }
        }
        
        publicContent += `</div>`;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: targetActor}), content: publicContent });

        const parentId = targetActor.system.parentCompany;
        if (parentId) {
            const parentComp = game.actors.get(parentId);
            if (parentComp) {
                const safeParentName = foundry.utils.escapeHTML(parentComp.name);
                let gmNotice = `<p><strong>Command Link:</strong> This horde belongs to <strong>${safeParentName}</strong>. Their loss of ${magDmg} Magnitude should reduce the company's Temporary <em>Might</em> or <em>Influence</em>.</p>`;
                if (newMag === 0) gmNotice += `<p style="color: #8b1f1f; font-weight: bold;">Rout! The complete destruction of this unit warrants an immediate Company-level penalty.</p>`;
                
                await ChatMessage.create({ 
                  speaker: ChatMessage.getSpeaker({actor: targetActor}), 
                  content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Command Link Alert</h3>${gmNotice}</div>`,
                  whisper: ChatMessage.getWhisperRecipients("GM")
                });
            }
        }
        if (newMag === 0) ui.notifications.warn(`The ${safeTargetName} has been completely routed or destroyed!`);
        continue; 
    }

    if (targetActor.type !== "character") continue;

    const mainLocKey = getHitLocation(height);
    if (mainLocKey === "unknown") continue;
    
    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let damageSummary = [];

    // RAW Area Attack calculation
    if (areaDice > 0) {
      const splashRoll = new Roll(`${areaDice}d10`);
      await splashRoll.evaluate();
      const hitLocs = splashRoll.dice[0].results.map(r => getHitLocation(r.result));
      const locCounts = {};
      hitLocs.forEach(l => locCounts[l] = (locCounts[l] || 0) + 1);

      let primaryLoc = Object.entries(locCounts).reduce((a, b) => b[1] > a[1] ? b : a, ["", 0])[0];
      
      let isKillingWeapon = baseKilling > 0;
      let isShockWeapon = baseShock > 0 && baseKilling === 0;

      for (let [locKey, hits] of Object.entries(locCounts)) {
        if (locKey === "unknown") continue;
        
        let finalKilling = isKillingWeapon ? hits : 0;
        let finalShock = isShockWeapon ? hits : 0;
        
        if (isMassive && locKey === primaryLoc && finalKilling > 0) finalKilling += 1;

        let loc = localHealth[locKey];
        let effectiveMax = getEffectiveMax(targetActor, locKey); 
        let result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, effectiveMax);
        
        loc.shock = result.newShock;
        loc.killing = result.newKilling;

        let locName = getHitLocationLabel(locKey).split(" (")[0];
        let summaryText = `<strong>${locName}:</strong> <span style="color: #8b1f1f;">${finalKilling} Kill</span> <span>${finalShock} Shock</span>`;

        if (result.convertedShock > 0) summaryText += ` <span style="font-size: 0.85em; color: #d97706;">(${result.convertedShock} Shock → Killing)</span>`;

        if (result.overflowKilling > 0 && locKey !== "torso" && locKey !== "head") {
             let torso = localHealth.torso;
             let torsoEffectiveMax = getEffectiveMax(targetActor, "torso"); 
             let tResult = computeLocationDamage(torso.shock || 0, torso.killing || 0, 0, result.overflowKilling, torsoEffectiveMax);
             torso.shock = tResult.newShock;
             torso.killing = tResult.newKilling;
             summaryText += `<br><span style="color: #8b1f1f; font-size: 0.85em;">(+${result.overflowKilling} Killing overflow to Torso)</span>`;
        }
        damageSummary.push(summaryText);
      }
    } 
    else {
      let loc = localHealth[mainLocKey];
      
      const equippedShields = targetActor.items.filter(i => i.type === "shield" && i.system.equipped);
      const totalCoverAr = equippedShields.reduce((sum, s) => sum + (Number(s.system.coverAR) || 0), 0);
      
      let rawAr = loc.armor || 0; 
      let combinedAr = rawAr + totalCoverAr; 
      let effectiveAr = Math.max(0, combinedAr - ap); 
      
      let finalKilling = baseKilling;
      let finalShock = baseShock;

      let shockSoaked = Math.min(finalShock, effectiveAr);
      let killingSoaked = Math.min(finalKilling, effectiveAr);

      finalShock = Math.max(0, finalShock - effectiveAr);
      finalKilling = Math.max(0, finalKilling - effectiveAr);

      let effectiveMax = getEffectiveMax(targetActor, mainLocKey); 
      let result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, effectiveMax);
      loc.shock = result.newShock;
      loc.killing = result.newKilling;

      if (finalShock > 0 || finalKilling > 0 || shockSoaked > 0 || killingSoaked > 0) {
          let locName = getHitLocationLabel(mainLocKey).split(" (")[0];
          let summaryText = `<strong>${locName}:</strong> `;
          if (finalKilling > 0) summaryText += `<span style="color: #8b1f1f;">${finalKilling} Kill</span> `;
          if (finalShock > 0) summaryText += `<span>${finalShock} Shock</span> `;
          
          if (result.convertedShock > 0) summaryText += ` <span style="font-size: 0.85em; color: #d97706;">(${result.convertedShock} Shock → Killing)</span> `;
          
          if (shockSoaked > 0 || killingSoaked > 0) {
            const shieldNote = totalCoverAr > 0 ? ` (incl. ${totalCoverAr} Shield AR)` : "";
            summaryText += `<span style="font-size: 0.85em; color: #666;">(Armor${shieldNote} stopped ${shockSoaked}S/${killingSoaked}K)</span>`;
          }
          
          if (result.overflowKilling > 0 && mainLocKey !== "torso" && mainLocKey !== "head") {
               let torso = localHealth.torso;
               let torsoEffectiveMax = getEffectiveMax(targetActor, "torso"); 
               let tResult = computeLocationDamage(torso.shock || 0, torso.killing || 0, 0, result.overflowKilling, torsoEffectiveMax);
               torso.shock = tResult.newShock;
               torso.killing = tResult.newKilling;
               summaryText += `<br><span style="color: #8b1f1f; font-size: 0.85em;">(+${result.overflowKilling} Killing overflow to Torso)</span>`;
          }
          damageSummary.push(summaryText);
      }
    }
    
    await targetActor.update({ "system.health": localHealth });

    let headMax = getEffectiveMax(targetActor, "head");
    let torsoMax = getEffectiveMax(targetActor, "torso");

    let statusAlert = "";
    if (localHealth.head.killing >= headMax) {
      statusAlert = `<div style="background: #4a0000; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.2em; margin-top: 8px; border-radius: 3px;">☠ ${safeTargetName} IS DEAD (Head destroyed)</div>`;
    } else if (localHealth.torso.killing >= torsoMax) {
      statusAlert = `<div style="background: #4a0000; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.2em; margin-top: 8px; border-radius: 3px;">☠ ${safeTargetName} IS DEAD (Torso destroyed)</div>`;
    } else if (localHealth.head.shock + localHealth.head.killing >= headMax) {
      statusAlert = `<div style="background: #1a237e; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.1em; margin-top: 8px; border-radius: 3px;">💫 ${safeTargetName} IS UNCONSCIOUS (Head full of Shock)</div>`;
    } else if (localHealth.torso.shock + localHealth.torso.killing >= torsoMax) {
      statusAlert = `<div style="background: #e65100; color: #fff; padding: 6px; text-align: center; font-weight: bold; font-size: 0.95em; margin-top: 8px; border-radius: 3px;">⚡ ${safeTargetName} IS DAZED (−1d all actions)</div>`;
    }

    let summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br><br>") : "<em>All damage harmlessly deflected by armor!</em>";
    let chatContent = `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Damage Applied</h3><p style="margin-bottom: 5px;"><strong>Target:</strong> ${safeTargetName} ${areaDice > 0 ? '<em>(Area Effect)</em>' : ''}</p><div style="background: rgba(0,0,0,0.05); padding: 5px; border-left: 3px solid #8b1f1f;">${summaryHtml}</div>${statusAlert}</div>`;
    
    await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({actor: targetActor}) });
  }
}

export async function applyCompanyDamageToTarget(width, qualityKey) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a Company token first!");

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "company") {
        ui.notifications.warn(`${target.name} is not a Company!`);
        continue;
    }
    
    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    const currentVal = targetActor.system.qualities[qualityKey].current;
    let newVal = Math.max(0, currentVal - width);
    
    await targetActor.update({
      [`system.qualities.${qualityKey}.current`]: newVal
    });
    
    ui.notifications.info(`Dealt ${width} damage to ${safeTargetName}'s Temporary ${qualityKey.toUpperCase()} (Now ${newVal}).`);
    
    if (newVal === 0) {
        ui.notifications.error(`CRITICAL WARNING: ${safeTargetName}'s Temporary ${qualityKey.toUpperCase()} has fallen to 0! Their Permanent Rating is at risk!`);
    }
  }
}