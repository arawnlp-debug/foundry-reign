/**
 * Reign: Realities of Lords and Leaders
 * Targeted for Foundry VTT v13+ (ApplicationV2)
 */

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

// ----------------------------------------------------
// ORE CORE HELPER FUNCTIONS
// ----------------------------------------------------

function getArmorWeight(health) {
  const locs = {
    head: health.head.armor || 0,
    torso: health.torso.armor || 0,
    armL: health.armL.armor || 0,
    armR: health.armR.armor || 0,
    legL: health.legL.armor || 0,
    legR: health.legR.armor || 0,
  };

  let coversArms = (locs.armL >= 1 || locs.armR >= 1);
  let coversLegs = (locs.legL >= 1 || locs.legR >= 1);
  let maxAR = Math.max(...Object.values(locs));

  // Heavy: covers arms AND legs with AR 2+
  if (coversArms && coversLegs && maxAR >= 2) return "heavy";

  // Light: AR 2 or less on at most 2 locations
  let coveredCount = Object.values(locs).filter(v => v > 0).length;
  if (maxAR <= 2 && coveredCount <= 2) return "light";

  // Everything else is Medium
  if (maxAR > 0) return "medium";

  return "none";
}

function computeLocationDamage(currentShock, currentKilling, incomingShock, incomingKilling, max) {
  // Step 1: Apply Killing first
  let newKilling = currentKilling + incomingKilling;
  let newShock = currentShock + incomingShock;

  // Step 2: If total Shock exceeds remaining non-Killing boxes, excess becomes Killing
  let shockCapacity = max - newKilling;
  if (shockCapacity < 0) shockCapacity = 0;

  let excessShock = Math.max(0, newShock - shockCapacity);
  if (excessShock > 0) {
    newShock -= excessShock;
    newKilling += excessShock;
  }

  // Step 3: Calculate overflow
  let overflowKilling = Math.max(0, newKilling - max);
  newKilling = Math.min(newKilling, max);
  newShock = Math.max(0, Math.min(newShock, max - newKilling));

  return { newShock, newKilling, overflowKilling, convertedShock: excessShock };
}

function parseORE(results, isMinion = false) {
  const counts = {};
  results.forEach(n => counts[n] = (counts[n] || 0) + 1);
  const sets = [], waste = [];
  Object.entries(counts).forEach(([height, width]) => {
    let h = parseInt(height);
    
    if (isMinion) {
      while (width >= 2) {
        if (width === 4) { sets.push({ width: 2, height: h, text: `2x${h}` }); sets.push({ width: 2, height: h, text: `2x${h}` }); width = 0; }
        else if (width >= 3) { sets.push({ width: 3, height: h, text: `3x${h}` }); width -= 3; }
        else if (width === 2) { sets.push({ width: 2, height: h, text: `2x${h}` }); width -= 2; }
      }
      for(let i=0; i<width; i++) waste.push(h);
    } else {
      if (width >= 2) {
        sets.push({ width, height: h, text: `${width}x${h}` });
      } else {
        for(let i=0; i<width; i++) waste.push(h);
      }
    }
  });
  sets.sort((a, b) => b.height - a.height);
  waste.sort((a, b) => b - a);
  return { sets, waste };
}

function getHitLocation(height) {
  if (height === 10) return "head";
  if (height >= 7) return "torso";
  if (height >= 5) return "armR";
  if (height >= 3) return "armL";
  if (height === 2) return "legR";
  if (height === 1) return "legL";
  return "unknown";
}

function getHitLocationLabel(key) {
  const labels = { head: "Head (10)", torso: "Torso (7-9)", armR: "Right Arm (5-6)", armL: "Left Arm (3-4)", legR: "Right Leg (2)", legL: "Left Leg (1)" };
  return labels[key] || "Unknown";
}

function generateOREChatHTML(actorType, label, totalPool, results, expertDie, masterDiceCount, itemData = null, flags = {}) {
  const parsed = parseORE(results, flags.isMinion);
  let setsHtml = "";

  const isSpell = itemData && itemData.type === "spell";
  const spellIntensity = isSpell ? (parseInt(itemData.system.intensity) || 0) : 0;
  const difficulty = flags.difficulty || 0;

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

        let ap = itemData?.system?.qualities?.armorPiercing || 0;
        let slow = itemData?.system?.qualities?.slow || 0;
        let isTwoHanded = itemData?.system?.qualities?.twoHanded || false;
        let isMassive = itemData?.system?.qualities?.massive || false;
        let isArea = itemData?.system?.qualities?.area || false;

        let qualityTags = "";
        if (ap > 0) qualityTags += `<span style="background:#333; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">AP ${ap}</span> `;
        if (slow > 0) qualityTags += `<span style="background:#555; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">SLOW ${slow}</span> `;
        if (isTwoHanded) qualityTags += `<span style="background:#4a4a8a; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">2H</span> `;
        if (isMassive) qualityTags += `<span style="background:#6b3a1f; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">MASSIVE</span> `;
        if (isArea) qualityTags += `<span style="background:#d97706; color:#fff; padding: 1px 4px; font-size: 0.7em; border-radius: 3px;">AREA</span>`;

        buttonsHtml += `
          <button class="apply-dmg-btn" data-width="${s.width}" data-height="${s.height}" data-dmg-string="${calculatedDmgStr}" data-ap="${ap}" data-massive="${isMassive}" data-area="${isArea}" style="flex: 0 0 30px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Apply Damage to Target" ${!isSuccess ? 'disabled' : ''}>
            <i class="fas fa-hand-fist"></i>
          </button>`;
          
        dmgFooterHtml = `<div style="font-size: 0.85em; color: #333; margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
            <span><strong>Damage:</strong> ${calculatedDmgStr}</span>
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
  
  let flavor = `<div class="reign-chat-card"><header><h3>Rolling ${label}</h3></header>`;
  flavor += flagsHtml;
  flavor += `<div class="pool-details">Pool: ${totalPool}d10 ${flags.wasCapped ? "(Penalties absorbed by pool overflow)" : ""}</div><hr>`;
  flavor += `<div class="sets-result">${setsHtml}</div><hr>`;
  flavor += `<div class="waste-result"><strong>Unmatched:</strong> ${wasteString}</div>`;
  if (expertDie > 0) flavor += `<div class="ed-result"><strong>Expert Die:</strong> ${expertDie}</div>`;
  if (masterDiceCount > 0) flavor += `<div class="md-result"><strong>Master Dice:</strong> ${masterDiceCount}</div>`;
  flavor += `</div>`;

  return flavor;
}

async function postOREChat(actor, label, totalPool, results, expertDie, masterDiceCount, item = null, flags = {}) {
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

// ----------------------------------------------------
// DAMAGE AUTOMATION MATH (Personal Combat)
// ----------------------------------------------------

async function applyDamageToTarget(width, height, dmgString, ap = 0, isMassive = false, isArea = false) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");
  
  const safeDmgStr = String(dmgString || "Width Shock").toLowerCase();
  let baseShock = 0;
  let baseKilling = 0;

  const evalFormula = (match) => {
    if (!match) return 0;
    let expr = match[1].replace(/width/g, width).replace(/\s/g, "");
    try { return Function(`'use strict'; return (${expr})`)(); }
    catch(e) { return parseInt(expr) || 0; }
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

  if (isMassive && !isArea) baseKilling += 1;

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor) continue;

    if (targetActor.type === "threat") {
        let magDmg = baseKilling > 0 ? baseKilling : Math.floor(baseShock / 2);
        if (magDmg < 1) {
            ui.notifications.info(`${targetActor.name} shrugged off the weak attack! (Shock damage must be 2+ to reduce Magnitude)`);
            continue;
        }
        
        let currentMag = targetActor.system.magnitude.value;
        let newMag = Math.max(0, currentMag - magDmg);
        await targetActor.update({ "system.magnitude.value": newMag });
        
        const publicContent = `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Battlefield Attrition</h3><p>${targetActor.name} took <strong>${magDmg} Magnitude</strong> damage.</p></div>`;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: targetActor}), content: publicContent });

        const parentId = targetActor.system.parentCompany;
        if (parentId) {
            const parentComp = game.actors.get(parentId);
            if (parentComp) {
                let gmNotice = `<p><strong>Command Link:</strong> This horde belongs to <strong>${parentComp.name}</strong>. Their loss of ${magDmg} Magnitude should reduce the company's Temporary <em>Might</em> or <em>Influence</em>.</p>`;
                if (newMag === 0) gmNotice += `<p style="color: #8b1f1f; font-weight: bold;">Rout! The complete destruction of this unit warrants an immediate Company-level penalty.</p>`;
                
                await ChatMessage.create({ 
                  speaker: ChatMessage.getSpeaker({actor: targetActor}), 
                  content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Command Link Alert</h3>${gmNotice}</div>`,
                  whisper: ChatMessage.getWhisperRecipients("GM")
                });
            }
        }
        if (newMag === 0) ui.notifications.warn(`The ${targetActor.name} has been completely routed or destroyed!`);
        continue; 
    }

    if (targetActor.type !== "character") continue;

    const mainLocKey = getHitLocation(height);
    if (mainLocKey === "unknown") continue;
    
    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let damageSummary = [];

    if (isArea) {
      const splashRoll = new Roll(`${width}d10`);
      await splashRoll.evaluate();
      const hitLocs = splashRoll.dice[0].results.map(r => getHitLocation(r.result));
      const locCounts = {};
      hitLocs.forEach(l => locCounts[l] = (locCounts[l] || 0) + 1);

      let primaryLoc = Object.entries(locCounts).reduce((a, b) => b[1] > a[1] ? b : a, ["", 0])[0];

      for (let [locKey, hits] of Object.entries(locCounts)) {
        if (locKey === "unknown") continue;
        
        let finalKilling = baseKilling > 0 ? hits : 0;
        let finalShock = baseShock > 0 ? hits : 0;
        if (isMassive && locKey === primaryLoc && finalKilling > 0) finalKilling += 1;

        let loc = localHealth[locKey];
        let result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, loc.max);
        
        loc.shock = result.newShock;
        loc.killing = result.newKilling;

        let locName = getHitLocationLabel(locKey).split(" ")[0];
        let summaryText = `<strong>${locName}:</strong> <span style="color: #8b1f1f;">${finalKilling} Kill</span> <span>${finalShock} Shock</span>`;

        if (result.convertedShock > 0) summaryText += ` <span style="font-size: 0.85em; color: #d97706;">(${result.convertedShock} Shock → Killing)</span>`;

        if (result.overflowKilling > 0 && locKey !== "torso" && locKey !== "head") {
             let torso = localHealth.torso;
             let tResult = computeLocationDamage(torso.shock || 0, torso.killing || 0, 0, result.overflowKilling, torso.max);
             torso.shock = tResult.newShock;
             torso.killing = tResult.newKilling;
             summaryText += `<br><span style="color: #8b1f1f; font-size: 0.85em;">(+${result.overflowKilling} Killing overflow to Torso)</span>`;
        }
        damageSummary.push(summaryText);
      }
    } 
    else {
      let loc = localHealth[mainLocKey];
      let rawAr = loc.armor || 0; 
      let effectiveAr = Math.max(0, rawAr - ap); 
      
      let finalKilling = baseKilling;
      let finalShock = baseShock;

      let shockSoaked = Math.min(finalShock, effectiveAr);
      let killingSoaked = Math.min(finalKilling, effectiveAr);

      finalShock = Math.max(0, finalShock - effectiveAr);
      finalKilling = Math.max(0, finalKilling - effectiveAr);

      let result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, loc.max);
      loc.shock = result.newShock;
      loc.killing = result.newKilling;

      if (finalShock > 0 || finalKilling > 0 || shockSoaked > 0 || killingSoaked > 0) {
          let locName = getHitLocationLabel(mainLocKey).split(" ")[0];
          let summaryText = `<strong>${locName}:</strong> `;
          if (finalKilling > 0) summaryText += `<span style="color: #8b1f1f;">${finalKilling} Kill</span> `;
          if (finalShock > 0) summaryText += `<span>${finalShock} Shock</span> `;
          
          if (result.convertedShock > 0) summaryText += ` <span style="font-size: 0.85em; color: #d97706;">(${result.convertedShock} Shock → Killing)</span> `;
          if (shockSoaked > 0 || killingSoaked > 0) summaryText += `<span style="font-size: 0.85em; color: #666;">(Armor stopped ${shockSoaked}S/${killingSoaked}K)</span>`;
          
          if (result.overflowKilling > 0 && mainLocKey !== "torso" && mainLocKey !== "head") {
               let torso = localHealth.torso;
               let tResult = computeLocationDamage(torso.shock || 0, torso.killing || 0, 0, result.overflowKilling, torso.max);
               torso.shock = tResult.newShock;
               torso.killing = tResult.newKilling;
               summaryText += `<br><span style="color: #8b1f1f; font-size: 0.85em;">(+${result.overflowKilling} Killing overflow to Torso)</span>`;
          }
          damageSummary.push(summaryText);
      }
    }
    
    await targetActor.update({ "system.health": localHealth });

    let statusAlert = "";
    if (localHealth.head.killing >= localHealth.head.max) {
      statusAlert = `<div style="background: #4a0000; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.2em; margin-top: 8px; border-radius: 3px;">☠ ${targetActor.name} IS DEAD (Head destroyed)</div>`;
    } else if (localHealth.torso.killing >= localHealth.torso.max) {
      statusAlert = `<div style="background: #4a0000; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.2em; margin-top: 8px; border-radius: 3px;">☠ ${targetActor.name} IS DEAD (Torso destroyed)</div>`;
    } else if (localHealth.head.shock + localHealth.head.killing >= localHealth.head.max) {
      statusAlert = `<div style="background: #1a237e; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.1em; margin-top: 8px; border-radius: 3px;">💫 ${targetActor.name} IS UNCONSCIOUS (Head full of Shock)</div>`;
    } else if (localHealth.torso.shock + localHealth.torso.killing >= localHealth.torso.max) {
      statusAlert = `<div style="background: #e65100; color: #fff; padding: 6px; text-align: center; font-weight: bold; font-size: 0.95em; margin-top: 8px; border-radius: 3px;">⚡ ${targetActor.name} IS DAZED (−1d all actions)</div>`;
    }

    let summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br><br>") : "<em>All damage harmlessly deflected by armor!</em>";
    let chatContent = `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Damage Applied</h3><p style="margin-bottom: 5px;"><strong>Target:</strong> ${targetActor.name} ${isArea ? '<em>(Area Effect)</em>' : ''}</p><div style="background: rgba(0,0,0,0.05); padding: 5px; border-left: 3px solid #8b1f1f;">${summaryHtml}</div>${statusAlert}</div>`;
    
    await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({actor: targetActor}) });
  }
}

// ----------------------------------------------------
// DAMAGE AUTOMATION MATH (Company Warfare)
// ----------------------------------------------------

async function applyCompanyDamageToTarget(width, qualityKey) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a Company token first!");

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "company") {
        ui.notifications.warn(`${target.name} is not a Company!`);
        continue;
    }

    const currentVal = targetActor.system.qualities[qualityKey].current;
    let newVal = Math.max(0, currentVal - width);
    
    await targetActor.update({
      [`system.qualities.${qualityKey}.current`]: newVal
    });
    
    ui.notifications.info(`Dealt ${width} damage to ${targetActor.name}'s Temporary ${qualityKey.toUpperCase()} (Now ${newVal}).`);
    
    if (newVal === 0) {
        ui.notifications.error(`CRITICAL WARNING: ${targetActor.name}'s Temporary ${qualityKey.toUpperCase()} has fallen to 0! Their Permanent Rating is at risk!`);
    }
  }
}

// ----------------------------------------------------
// SHEET CLASSES
// ----------------------------------------------------

class ReignItemSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = { tag: "form", classes: ["reign", "sheet", "item"], position: { width: 450, height: "auto" }, form: { submitOnChange: true, closeOnSubmit: false } };
  static PARTS = { sheet: { template: "systems/reign/templates/item/item-sheet.hbs" } };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.document;
    context.system = this.document.system;
    context.isWeapon = this.document.type === "weapon";
    context.isTechnique = this.document.type === "technique";
    context.isSpell = this.document.type === "spell";
    context.isDiscipline = this.document.type === "discipline";
    context.isGear = this.document.type === "gear";
    return context;
  }
}

class ReignCompanySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor", "company"], position: { width: 700, height: 800 }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollCompanyStat: async function(event, target) {
        const key1 = target.dataset.key;
        const system = this.document.system;
        const baseValue = system.qualities[key1]?.current || 0;
        const q1Label = key1.toUpperCase();
        
        let content = `<form class="reign-dialog-form">
          <div class="form-group"><label>Primary Quality:</label><input type="text" disabled value="${q1Label} (${baseValue})"/></div>
          <div class="dialog-grid dialog-grid-2">
            <div class="form-group"><label>Secondary Quality:</label><select name="q2"><option value="none">None</option><option value="might">Might</option><option value="treasure">Treasure</option><option value="influence">Influence</option><option value="territory">Territory</option><option value="sovereignty">Sovereignty</option></select></div>
            <div class="form-group"><label>Mod Dice:</label><input type="number" name="mod" value="0"/></div>
          </div>
          <div class="form-group" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ccc;">
            <label>Target Quality (If Attacking an Enemy Company):</label>
            <select name="targetQuality">
                <option value="none">None (Just rolling a general action)</option>
                <option value="might">Might</option>
                <option value="treasure">Treasure</option>
                <option value="influence">Influence</option>
                <option value="territory">Territory</option>
                <option value="sovereignty">Sovereignty</option>
            </select>
          </div>
        </form>`;
        
        const rollData = await DialogV2.wait({ 
          classes: ["reign-dialog-window"], 
          window: { title: `Company Action` }, 
          content: content, 
          buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
            const f = d.element.querySelector("form"); 
            return { 
                q2: f.querySelector('[name="q2"]').value, 
                mod: parseInt(f.querySelector('[name="mod"]').value) || 0,
                targetQuality: f.querySelector('[name="targetQuality"]').value
            }; 
          } }] 
        });
        
        if (!rollData) return;
        let val2 = rollData.q2 !== "none" ? (system.qualities[rollData.q2]?.current || 0) : 0;
        
        let intendedPool = baseValue + val2 + rollData.mod;
        let diceToRoll = Math.min(intendedPool, 10);
        let wasCapped = intendedPool > 10;
        
        if (diceToRoll < 1) return ui.notifications.warn("Company dice pool reduced below 1. Action fails.");

        const roll = new Roll(`${diceToRoll}d10`); 
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];

        await postOREChat(this.document, "Company Action", diceToRoll, results, 0, 0, null, { targetQuality: rollData.targetQuality, wasCapped: wasCapped });
      }
    }
  };
  static PARTS = { sheet: { template: "systems/reign/templates/actor/company-sheet.hbs" } };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    const qs = context.system.qualities || {};
    context.qualities = ["might", "treasure", "influence", "territory", "sovereignty"].map(k => ({ key: k, label: k.toUpperCase(), ...qs[k] }));
    return context;
  }
}

class ReignThreatSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor", "threat"], position: { width: 500, height: "auto" }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollThreat: async function(event, target) {
        const system = this.document.system;
        const basePool = system.threatLevel || 0;
        
        let content = `<form class="reign-dialog-form">
          <div class="form-group"><label>Base Threat Level:</label><input type="number" disabled value="${basePool}"/></div>
          <div class="dialog-grid dialog-grid-2">
            <div class="form-group"><label>Ganging Up / Bonus Dice (+d):</label><input type="number" name="bonus" value="0"/></div>
            <div class="form-group"><label>Penalty Dice (-d):</label><input type="number" name="penalty" value="0"/></div>
          </div>
        </form>`;
        
        const rollData = await DialogV2.wait({
          classes: ["reign-dialog-window"],
          window: { title: `Roll Threat Action` },
          content: content,
          buttons: [{
            action: "roll", label: "Roll Horde", default: true,
            callback: (e, b, d) => {
              const f = d.element.querySelector("form");
              return {
                bonus: parseInt(f.querySelector('[name="bonus"]').value) || 0,
                penalty: parseInt(f.querySelector('[name="penalty"]').value) || 0
              };
            }
          }]
        });
        
        if (!rollData) return;
        
        let intendedPool = basePool + rollData.bonus - rollData.penalty;
        let diceToRoll = Math.min(intendedPool, 15);
        let wasCapped = intendedPool > 15;
        
        if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced the horde's dice pool below 1. They hesitate or miss entirely!");
        
        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        
        const pseudoWeapon = { type: "weapon", system: { damageFormula: system.damageFormula || "Width Shock" } };
        await postOREChat(this.document, "Horde Attack", diceToRoll, results, 0, 0, pseudoWeapon, { wasCapped, isAttack: true, isMinion: true });
      },
      rollMorale: async function(event, target) {
        const system = this.document.system;
        const pool = system.threatLevel || 0;
        if (pool < 1) return ui.notifications.warn("Threat Level is 0! The horde cannot roll Morale.");

        const roll = new Roll(`${pool}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        const parsed = parseORE(results);

        let content = `<div class="reign-chat-card"><header><h3>Morale Check</h3></header>`;
        content += `<div class="pool-details">Pool: ${pool}d10</div><hr>`;

        if (parsed.sets.length > 0) {
            content += `<div class="sets-result"><span style="color: #2d5a27; font-weight: bold;">SUCCESS!</span> The horde holds its ground.</div>`;
        } else {
            content += `<div class="sets-result"><span style="color: #8b1f1f; font-weight: bold;">FAILURE!</span> Morale breaks.</div>`;
            let currentMorale = system.morale?.value || 0;
            let newMorale = Math.max(0, currentMorale - 1);
            await this.document.update({ "system.morale.value": newMorale });
            content += `<div class="waste-result">Morale drops to ${newMorale}.</div>`;
            
            if (newMorale === 0) {
                content += `<div class="waste-result" style="color: #8b1f1f; font-weight: bold; font-size: 1.2em; text-align: center; margin-top: 10px;">THE HORDE ROUTS!</div>`;
            }
        }
        content += `</div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
      }
    }
  };
  
  static PARTS = { sheet: { template: "systems/reign/templates/actor/threat-sheet.hbs" } };
  
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    
    const companyList = {};
    game.actors.filter(a => a.type === "company").forEach(c => {
      companyList[c.id] = c.name;
    });
    context.companies = companyList;
    
    return context;
  }
}

class ReignActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor"], position: { width: 800, height: 850 }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      toggleProgression: async function(event, target) {
        const current = this.document.getFlag("reign", "progressionMode") || false;
        await this.document.setFlag("reign", "progressionMode", !current);
      },
      upgradeStat: async function(event, target) {
        const { type, key, label } = target.dataset;
        const isCustom = target.dataset.iscustom === "true";
        const system = this.document.system;
        
        let currentVal = 0, cost = 0, newPath = "", newVal = 0, upgradeText = "";
        let removeEdPath = null;

        if (type === "attribute") {
          currentVal = system.attributes[key].value;
          if (currentVal >= 6) return ui.notifications.warn("Attributes cannot be upgraded past 6.");
          cost = 5; 
          newPath = `system.attributes.${key}.value`;
          newVal = currentVal + 1;
          upgradeText = `${label} Attribute to ${newVal}`;
        } else if (type === "skill" || type === "customSkill" || type === "esoterica") {
          let skillPath;
          if (type === "esoterica") {
            skillPath = `system.esoterica.${key}`;
            currentVal = system.esoterica[key];
          } else {
            skillPath = type === "customSkill" ? `system.customSkills.${key}` : `system.skills.${key}`;
            currentVal = foundry.utils.getProperty(system, skillPath.replace("system.", "")).value;
          }
          
          if (currentVal >= 6) return ui.notifications.warn("Skills cannot be upgraded past 6.");
          
          cost = 1; 
          newPath = type === "esoterica" ? skillPath : `${skillPath}.value`;
          newVal = currentVal + 1;
          upgradeText = `${label} to ${newVal}`;
        } else if (type === "ed") {
          cost = 1; 
          newPath = isCustom ? `system.customSkills.${key}.expert` : `system.skills.${key}.expert`;
          newVal = true;
          upgradeText = `Expert Die for ${label}`;
        } else if (type === "md") {
          const hasEd = target.dataset.hased === "true";
          cost = hasEd ? 5 : 6; 
          newPath = isCustom ? `system.customSkills.${key}.master` : `system.skills.${key}.master`;
          newVal = true;
          upgradeText = `Master Die for ${label}`;
          if (hasEd) removeEdPath = isCustom ? `system.customSkills.${key}.expert` : `system.skills.${key}.expert`;
        }

        const unspent = system.xp?.value || 0;
        if (cost > unspent) {
          return ui.notifications.error(`Insufficient XP. Upgrading ${label} requires ${cost} XP, but you only have ${unspent}.`);
        }

        const confirm = await DialogV2.confirm({
          window: { title: "Confirm Advancement" },
          content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Spend <strong>${cost} XP</strong> to acquire <strong>${upgradeText}</strong>?</p></div>`,
          rejectClose: false
        });

        if (confirm) {
          const updates = {
            "system.xp.value": unspent - cost,
            "system.xp.spent": (system.xp?.spent || 0) + cost,
            [newPath]: newVal
          };
          if (removeEdPath) updates[removeEdPath] = false; 
          
          await this.document.update(updates);
          ui.notifications.info(`Successfully spent ${cost} XP on ${upgradeText}.`);
        }
      },
      rollStat: async function(event, target) {
        const { type, key, label } = target.dataset;
        const system = this.document.system;

        if (system.health.head.killing >= system.health.head.max || system.health.torso.killing >= system.health.torso.max) {
             return ui.notifications.error("Character is dead and cannot act.");
        }
        if (system.health.head.shock + system.health.head.killing >= system.health.head.max) {
             return ui.notifications.warn("Character is unconscious and cannot act.");
        }

        let baseValue = 0; let defaultAttr = "none"; let defaultSkill = "none"; let itemRef = null;
        let hasExpert = false; let hasMaster = false;

        if (type === "attribute") baseValue = system.attributes[key]?.value || 0;
        else if (type === "skill") { 
            baseValue = system.skills[key]?.value || 0; 
            hasExpert = system.skills[key]?.expert; 
            hasMaster = system.skills[key]?.master; 
        }
        else if (type === "customSkill") { 
            baseValue = system.customSkills[key]?.value || 0; 
            hasExpert = system.customSkills[key]?.expert; 
            hasMaster = system.customSkills[key]?.master; 
        }
        else if (type === "esoterica") { baseValue = system.esoterica[key] || 0; }
        else if (type === "move") {
          const m = system.customMoves[key];
          let aVal = m.attrKey !== "none" ? (system.attributes[m.attrKey]?.value || 0) : 0;
          let sVal = 0;
          if (m.skillKey !== "none") {
            if (system.skills[m.skillKey]) { 
                sVal = system.skills[m.skillKey].value; 
                hasExpert = system.skills[m.skillKey].expert; 
                hasMaster = system.skills[m.skillKey].master;
            }
            else if (system.customSkills[m.skillKey]) { 
                sVal = system.customSkills[m.skillKey].value; 
                hasExpert = system.customSkills[m.skillKey].expert; 
                hasMaster = system.customSkills[m.skillKey].master;
            }
          }
          baseValue = aVal + sVal + (m.modifier || 0);
        } 
        else if (type === "item") { 
          itemRef = this.document.items.get(key); 
          const poolRaw = itemRef?.system?.pool || ""; 
          
          if (itemRef?.type === "spell") {
            defaultSkill = "esoterica_sorcery";
            baseValue = 0;
            defaultAttr = "knowledge"; 
          } else {
            const matchedStatic = Object.keys(system.skills).find(k => k.toLowerCase() === poolRaw.toLowerCase());
            const matchedCustom = Object.entries(system.customSkills || {}).find(([id, cSk]) => cSk.customLabel.toLowerCase() === poolRaw.toLowerCase());
            
            if (matchedStatic) {
              defaultSkill = `static_${matchedStatic}`;
              baseValue = 0; 
              hasExpert = system.skills[matchedStatic].expert;
              hasMaster = system.skills[matchedStatic].master;
            } else if (matchedCustom) {
              defaultSkill = `custom_${matchedCustom[0]}`;
              baseValue = 0;
              hasExpert = matchedCustom[1].expert;
              hasMaster = matchedCustom[1].master;
            } else {
              baseValue = parseInt(poolRaw) || 0; 
            }
            defaultAttr = "coordination"; 
          }
        }

        if (type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.slow > 0) {
          const combatant = game.combat?.combatants.find(c => c.actorId === this.document.id);
          if (combatant && game.combat) {
            const cooldownUntil = combatant.getFlag("reign", "slowCooldown") || 0;
            if (game.combat.round <= cooldownUntil) {
              return ui.notifications.warn(`${itemRef.name} is still being readied. Available on round ${cooldownUntil + 1}.`);
            }
          }
        }

        let woundPenalty = 0;
        if (system.health.head.shock + system.health.head.killing >= system.health.head.max) woundPenalty += 1;
        if (system.health.torso.shock + system.health.torso.killing >= system.health.torso.max) woundPenalty += 1;

        let armorWeight = getArmorWeight(system.health);
        let rawSkillKey = defaultSkill.replace("static_", "").replace("custom_", "").replace("esoterica_", "");
        
        let encumbDiff = 0;
        let encumbPen = 0;
        let encumbImpossible = false;

        if (armorWeight === "heavy") {
          if (rawSkillKey === "stealth") encumbImpossible = true;
          else if (rawSkillKey === "climb" || rawSkillKey === "run") encumbPen = 2;
          else if (rawSkillKey === "endurance" || rawSkillKey === "athletics") encumbDiff = 4;
        } else if (armorWeight === "medium") {
          if (["stealth", "climb", "run", "endurance", "athletics"].includes(rawSkillKey)) {
            encumbDiff = 3;
          }
        }

        if (encumbImpossible) return ui.notifications.error("Stealth is impossible in heavy armor. Action auto-fails.");
        
        let isAgility = defaultAttr === "coordination" || ["athletics", "dodge", "run", "stealth", "vigor", "ride"].includes(rawSkillKey);
        let autoPenalty = woundPenalty;
        let penaltyTitle = `Wound penalties auto-added`;
        
        if (isAgility && (encumbPen > 0 || encumbDiff > 0)) {
            autoPenalty += encumbPen;
            penaltyTitle = `Wounds (−${woundPenalty}d) & Armor (−${encumbPen}d, Diff ${encumbDiff}) auto-added. (GM Note: If swimming, armor penalties differ)`;
        }

        const showAttrSelect = (type === "skill" || type === "customSkill" || type === "item" || type === "esoterica");
        const showSkillSelect = (type === "item");
        const isCombatRoll = (type === "item" && itemRef?.type === "weapon") || (type === "skill" && key === "fight") || (type === "move");

        let initialEdValue = hasExpert ? 10 : 0;
        let initialMdValue = hasMaster ? 1 : 0; 

        let content = `<form class="reign-dialog-form">`;
        
        if (showAttrSelect) {
          content += `<div class="form-group"><label>Attribute:</label><select name="attr"><option value="none">None</option><option value="body" ${defaultAttr==='body'?'selected':''}>Body</option><option value="coordination" ${defaultAttr==='coordination'?'selected':''}>Coordination</option><option value="sense">Sense</option><option value="knowledge">Knowledge</option><option value="command">Command</option><option value="charm">Charm</option></select></div>`;
        }
        if (showSkillSelect) {
          let skOpts = `<option value="none">None</option>`;
          Object.keys(system.skills || {}).sort().forEach(sk => { skOpts += `<option value="static_${sk}" ${defaultSkill===('static_'+sk)?'selected':''}>${sk.toUpperCase()}</option>`; });
          if (system.customSkills) Object.entries(system.customSkills).forEach(([cid, cSk]) => { skOpts += `<option value="custom_${cid}" ${defaultSkill===('custom_'+cid)?'selected':''}>${(cSk.customLabel||"Custom").toUpperCase()}</option>`; });
          skOpts += `<option value="esoterica_sorcery" ${defaultSkill==='esoterica_sorcery'?'selected':''}>SORCERY</option>`;
          content += `<div class="form-group"><label>Linked Skill:</label><select name="skillKey">${skOpts}</select></div>`;
        }

        content += `<div class="dialog-grid ${isCombatRoll ? 'dialog-grid-2' : ''}">`;
        if (isCombatRoll) {
          content += `
            <div class="form-group">
              <label>Called Shot (-1d):</label>
              <select name="calledShot">
                <option value="0">None</option>
                <option value="10">Head (10)</option>
                <option value="9">Torso High (9)</option>
                <option value="8">Torso Mid (8)</option>
                <option value="7">Torso Low (7)</option>
                <option value="6">Right Arm High (6)</option>
                <option value="5">Right Arm Low (5)</option>
                <option value="4">Left Arm High (4)</option>
                <option value="3">Left Arm Low (3)</option>
                <option value="2">Right Leg (2)</option>
                <option value="1">Left Leg (1)</option>
              </select>
            </div>`;
        }
        content += `
            <div class="form-group">
              <label>Difficulty (Min Height):</label>
              <input type="number" name="difficulty" value="${isAgility ? encumbDiff : 0}" min="0" max="10"/>
            </div>
          </div>
          
          <div class="dialog-grid dialog-grid-3">
            <div class="form-group">
              <label>Total Actions:</label>
              <input type="number" name="multiActions" value="1" min="1" title="Penalty: -1d per extra action"/>
            </div>
            <div class="form-group">
              <label>Bonus Dice (+d):</label>
              <input type="number" name="bonus" value="0"/>
            </div>
            <div class="form-group">
              <label>Penalty Dice (-d):</label>
              <input type="number" name="penalty" value="${autoPenalty}" title="${penaltyTitle}"/>
            </div>
          </div>
            
          <div class="form-group">
            <label>Passions (+1d each):</label>
            <div class="checkbox-group">
              <label><input type="checkbox" name="pMiss"/> Mission</label>
              <label><input type="checkbox" name="pDuty"/> Duty</label>
              <label><input type="checkbox" name="pCrav"/> Craving</label>
            </div>
          </div>
          
          <div class="dialog-grid dialog-grid-2" style="margin-top: 15px;">
            <div class="form-group"><label>Expert Die (1-10, 0=None):</label><input type="number" name="ed" value="${initialEdValue}" min="0" max="10"/></div>
            <div class="form-group"><label>Master Dice Count (Max 1):</label><input type="number" name="md" value="${initialMdValue}" min="0" max="1"/></div>
          </div>
        </form>`;

        const rollData = await DialogV2.wait({ 
          classes: ["reign-dialog-window"],
          window: { title: `Roll ${label || 'Action'}` }, 
          content: content, 
          render: (event, html) => {
            let element;
            if (event instanceof Event && event.target?.element) {
                element = event.target.element; 
            } else if (event.querySelector) {
                element = event; 
            } else if (event[0] && event[0].querySelector) {
                element = event[0]; 
            }
            
            if (!element) return;
            
            const edInput = element.querySelector('[name="ed"]');
            const mdInput = element.querySelector('[name="md"]');
            
            if (!edInput || !mdInput) return;
            
            const enforceExclusivity = () => {
              let edVal = parseInt(edInput.value) || 0;
              let mdVal = parseInt(mdInput.value) || 0;
              
              if (edVal > 0) {
                mdInput.value = 0;
                mdInput.disabled = true;
              } else {
                mdInput.disabled = false;
              }
              
              if (mdVal > 0) {
                edInput.value = 0;
                edInput.disabled = true;
              } else {
                edInput.disabled = false;
              }
            };
            
            edInput.addEventListener('input', enforceExclusivity);
            mdInput.addEventListener('input', enforceExclusivity);
            enforceExclusivity(); 
          },
          buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
            const f = d.element.querySelector("form"); 
            return { 
              attr: f.querySelector('[name="attr"]')?.value || "none", 
              skillKey: f.querySelector('[name="skillKey"]')?.value || "none",
              calledShot: parseInt(f.querySelector('[name="calledShot"]')?.value) || 0,
              difficulty: parseInt(f.querySelector('[name="difficulty"]')?.value) || 0,
              multiActions: Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1),
              bonus: parseInt(f.querySelector('[name="bonus"]')?.value) || 0, 
              penalty: parseInt(f.querySelector('[name="penalty"]')?.value) || 0, 
              passionBonus: (f.querySelector('[name="pMiss"]')?.checked ? 1 : 0) + (f.querySelector('[name="pDuty"]')?.checked ? 1 : 0) + (f.querySelector('[name="pCrav"]')?.checked ? 1 : 0),
              ed: parseInt(f.querySelector('[name="ed"]')?.value) || 0, 
              md: parseInt(f.querySelector('[name="md"]')?.value) || 0 
            }; 
          } }] 
        });
        
        if (!rollData) return;
        
        let attrVal = rollData.attr !== "none" ? (system.attributes[rollData.attr]?.value || 0) : 0;
        let itemSkillValue = 0;
        if (showSkillSelect && rollData.skillKey !== "none") {
           if (rollData.skillKey.startsWith("static_")) itemSkillValue = system.skills[rollData.skillKey.replace("static_", "")]?.value || 0;
           else if (rollData.skillKey.startsWith("custom_")) itemSkillValue = system.customSkills[rollData.skillKey.replace("custom_", "")]?.value || 0;
           else if (rollData.skillKey === "esoterica_sorcery") itemSkillValue = system.esoterica.sorcery || 0;
        }

        if (rollData.ed > 0 && rollData.md > 0) {
            return ui.notifications.error("Reign rules strictly forbid using both Expert and Master dice in the same pool.");
        }

        let actualMd = rollData.md > 0 ? 1 : 0;
        let actualEd = rollData.ed > 0 ? 1 : 0;
        let remainingPenalty = rollData.penalty;

        if (remainingPenalty > 0 && actualMd > 0) { actualMd = 0; remainingPenalty--; }
        if (remainingPenalty > 0 && actualEd > 0) { actualEd = 0; remainingPenalty--; }

        let baseDice = baseValue + attrVal + itemSkillValue + rollData.bonus + rollData.passionBonus;
        let multiActionPenalty = rollData.multiActions > 1 ? (rollData.multiActions - 1) : 0;
        let calledShotPenalty = rollData.calledShot > 0 ? 1 : 0;
        
        let intendedPool = baseDice - remainingPenalty - multiActionPenalty - calledShotPenalty;
        let diceToRoll = Math.min(intendedPool, 10);
        let wasCapped = intendedPool > 10;

        if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced your dice pool below 1. Action fails.");

        let specialDiceCount = actualEd + actualMd + (rollData.calledShot > 0 ? 1 : 0);
        if (specialDiceCount > diceToRoll) return ui.notifications.warn("You cannot assign more Expert/Master/Called Shot dice than your total remaining pool limit!");

        let randomDiceCount = diceToRoll - specialDiceCount;
        let results = [];

        if (randomDiceCount > 0) {
          const roll = new Roll(`${randomDiceCount}d10`);
          await roll.evaluate();
          results = roll.dice[0]?.results.map(r => r.result) || [];
        }

        if (actualEd > 0) results.push(rollData.ed);
        if (rollData.calledShot > 0) results.push(rollData.calledShot);
        
        if (actualMd > 0) {
          results.sort((a, b) => b - a); 
          
          let mdHtml = `<form class="reign-dialog-form">
            <p style="margin-top: 0; font-size: 1.1em;"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None (All Master Dice)"}</p>
            <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Assign a face value to your Master Dice to build or improve sets.</p>
            <div class="dialog-grid dialog-grid-2">`;
          for(let i=0; i<actualMd; i++) {
            mdHtml += `<div class="form-group"><label>Master Die ${i+1} Face:</label><input type="number" id="mdFace${i}" value="10" min="1" max="10"/></div>`;
          }
          mdHtml += `</div></form>`;

          const mdResult = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: `Assign Master Dice` },
            content: mdHtml,
            buttons: [{
              action: "assign",
              label: "Finalize Sets",
              default: true,
              callback: (event, button, dialog) => {
                const faces = [];
                for(let i=0; i<actualMd; i++) {
                  faces.push(parseInt(dialog.element.querySelector(`#mdFace${i}`).value) || 10);
                }
                return faces;
              }
            }]
          });

          if (mdResult) {
            results.push(...mdResult);
            await postOREChat(this.document, label || "Action", diceToRoll, results, actualEd > 0 ? rollData.ed : 0, actualMd, itemRef, {
                multiActions: rollData.multiActions,
                calledShot: rollData.calledShot,
                difficulty: rollData.difficulty,
                wasCapped: wasCapped,
                isAttack: isCombatRoll
            });
          }
        } else {
          await postOREChat(this.document, label || "Action", diceToRoll, results, actualEd > 0 ? rollData.ed : 0, 0, itemRef, {
              multiActions: rollData.multiActions,
              calledShot: rollData.calledShot,
              difficulty: rollData.difficulty,
              wasCapped: wasCapped,
              isAttack: isCombatRoll
          });
        }
      },
      changeTab: async function(event, target) { 
        await this.document.setFlag("reign", "activeTab", target.dataset.tab);
        this.render();
      },
      itemCreate: async function(event, target) { await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); },
      itemEdit: async function(event, target) { this.document.items.get(target.dataset.itemId)?.sheet.render(true); },
      itemDelete: async function(event, target) { await this.document.items.get(target.dataset.itemId)?.delete(); },
      addCustomSkill: async function(event, target) {
        const newId = foundry.utils.randomID();
        await this.document.update({ [`system.customSkills.${newId}`]: { attribute: target.dataset.attr, customLabel: "", value: 0, expert: false, master: false, isCombat: false } });
      },
      deleteCustomSkill: async function(event, target) { await this.document.update({ [`system.customSkills.-=${target.dataset.skillId}`]: null }); },
      addCustomMove: async function(event, target) {
        const newId = foundry.utils.randomID();
        await this.document.update({ [`system.customMoves.${newId}`]: { name: "", attrKey: "none", skillKey: "none", modifier: 0 } });
      },
      deleteCustomMove: async function(event, target) { await this.document.update({ [`system.customMoves.-=${target.dataset.moveId}`]: null }); },
      itemToChat: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        let content = `<div class="reign-chat-card"><h3>${item.name}</h3><p>${item.type.toUpperCase()}</p><hr><p>${item.system.notes || item.system.effect || ""}</p></div>`;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/character-sheet.hbs" } };

  _onRender(context, options) {
    super._onRender(context, options);
    
    this.element.querySelectorAll(".health-box").forEach(box => {
      box.addEventListener("mousedown", async (ev) => {
        ev.preventDefault();
        const locKey = ev.currentTarget.closest(".health-track").dataset.loc;
        const actor = this.document;
        let { shock, killing, max } = actor.system.health[locKey];
        
        if (ev.button === 0) { 
           if (shock + killing < max) shock++;
           else if (shock > 0) { shock--; killing++; } 
        } else if (ev.button === 2) { 
           if (shock > 0) shock--;
           else if (killing > 0) killing--;
        }
        await actor.update({ [`system.health.${locKey}.shock`]: shock, [`system.health.${locKey}.killing`]: killing });
      });
      box.addEventListener("contextmenu", ev => ev.preventDefault());
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.actor = this.document;
    context.system = system;
    
    context.progressionMode = this.document.getFlag("reign", "progressionMode") || false;
    
    this._activeTab = this.document.getFlag("reign", "activeTab") ?? "stats";
    context.tabs = { stats: this._activeTab === "stats" ? "active" : "", combat: this._activeTab === "combat" ? "active" : "", esoterica: this._activeTab === "esoterica" ? "active" : "", biography: this._activeTab === "biography" ? "active" : "" };

    const skillMapping = {
      body: [ { key: "athletics", label: "ATHLETICS" }, { key: "endurance", label: "ENDURANCE" }, { key: "fight", label: "FIGHT" }, { key: "parry", label: "PARRY" }, { key: "run", label: "RUN" }, { key: "vigor", label: "VIGOR" } ],
      coordination: [ { key: "climb", label: "CLIMB" }, { key: "dodge", label: "DODGE" }, { key: "ride", label: "RIDE" }, { key: "stealth", label: "STEALTH" } ],
      sense: [ { key: "direction", label: "DIRECTION" }, { key: "eerie", label: "EERIE" }, { key: "empathy", label: "EMPATHY" }, { key: "hearing", label: "HEARING" }, { key: "scrutinize", label: "SCRUTINIZE" }, { key: "sight", label: "SIGHT" }, { key: "taste_touch_smell", label: "TASTE, TOUCH & SMELL" } ],
      knowledge: [ { key: "counterspell", label: "COUNTERSPELL" }, { key: "healing", label: "HEALING" }, { key: "languageNative", label: "LANGUAGE (NATIVE)" }, { key: "lore", label: "LORE" }, { key: "strategy", label: "STRATEGY" }, { key: "tactics", label: "TACTICS" } ],
      command: [ { key: "haggle", label: "HAGGLE" }, { key: "inspire", label: "INSPIRE" }, { key: "intimidate", label: "INTIMIDATE" } ],
      charm: [ { key: "fascinate", label: "FASCINATE" }, { key: "graces", label: "GRACES" }, { key: "jest", label: "JEST" }, { key: "lie", label: "LIE" }, { key: "plead", label: "PLEAD" } ]
    };

    context.attributeOptions = {none: "None", body: "Body", coordination: "Coordination", sense: "Sense", knowledge: "Knowledge", command: "Command", charm: "Charm"};
    context.skillOptions = {none: "None"};
    for (const [attr, skills] of Object.entries(skillMapping)) { skills.forEach(s => context.skillOptions[s.key] = s.label); }
    if (system.customSkills) { for (const [id, cSkill] of Object.entries(system.customSkills)) { context.skillOptions[id] = cSkill.customLabel || "Custom"; } }

    context.reignStatBlocks = Object.entries(skillMapping).map(([attrKey, skills]) => {
      let compiledSkills = skills.map(s => ({
        key: s.key, label: s.label, isCustom: false,
        value: system.skills[s.key]?.value || 0, expert: system.skills[s.key]?.expert || false, master: system.skills[s.key]?.master || false
      }));
      if (system.customSkills) {
        Object.entries(system.customSkills).forEach(([id, cSk]) => {
          if (cSk.attribute === attrKey) compiledSkills.push({ key: id, isCustom: true, customLabel: cSk.customLabel, value: cSk.value, expert: cSk.expert, master: cSk.master });
        });
      }
      return { key: attrKey, label: attrKey.toUpperCase(), value: system.attributes[attrKey].value, skills: compiledSkills };
    });

    const bodyVal = system.attributes?.body?.value || 0;
    const coordVal = system.attributes?.coordination?.value || 0;
    const parryVal = system.skills?.parry?.value || 0;
    const dodgeVal = system.skills?.dodge?.value || 0;
    context.preferredMoves = { body: bodyVal, coord: coordVal, parry: parryVal, dodge: dodgeVal, parryTotal: bodyVal + parryVal, dodgeTotal: coordVal + dodgeVal };

    context.customMoves = [];
    if (system.customMoves) {
      for (const [id, move] of Object.entries(system.customMoves)) {
        let aVal = move.attrKey !== "none" ? (system.attributes[move.attrKey]?.value || 0) : 0;
        let sVal = 0;
        if (move.skillKey !== "none") {
          if (system.skills[move.skillKey]) sVal = system.skills[move.skillKey].value || 0;
          else if (system.customSkills[move.skillKey]) sVal = system.customSkills[move.skillKey].value || 0;
        }
        context.customMoves.push({ key: id, name: move.name || "", attrKey: move.attrKey, skillKey: move.skillKey, modifier: move.modifier, total: aVal + sVal + (move.modifier || 0) });
      }
    }

    context.reignHealth = ["head", "torso", "armR", "armL", "legR", "legL"].map(k => {
      const labelMap = { head: "Head (10)", torso: "Torso (7–9)", armR: "R. Arm (5–6)", armL: "L. Arm (3–4)", legR: "R. Leg (2)", legL: "L. Leg (1)" };
      const loc = system.health[k];
      
      let boxes = Array.from({length: loc.max}).map((_, i) => {
          if (i < loc.killing) return { state: "killing", icon: "X" };
          if (i < loc.killing + loc.shock) return { state: "shock", icon: "/" };
          return { state: "empty", icon: "" };
      });

      return { key: k, label: labelMap[k], boxes: boxes, armor: loc.armor };
    });
    
    const items = this.document.items;
    context.weapons = items.filter(i => i.type === "weapon");
    context.techniques = items.filter(i => i.type === "technique");
    context.spells = items.filter(i => i.type === "spell");
    context.disciplines = items.filter(i => i.type === "discipline");
    context.gear = items.filter(i => i.type === "gear");

    return context;
  }
}

// ----------------------------------------------------
// INITIALIZATION & V13 HOOKS
// ----------------------------------------------------

Hooks.once("init", () => {
  CONFIG.Combat.initiative = { formula: "0", decimals: 1 };

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "reign", ReignActorSheet, { types: ["character"], makeDefault: true });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "reign", ReignCompanySheet, { types: ["company"], makeDefault: true });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "reign", ReignThreatSheet, { types: ["threat"], makeDefault: true });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, "reign", ReignItemSheet, { makeDefault: true });
});

Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (actor.type !== "character") return;
  const skills = changes?.system?.skills;
  if (skills) {
    for (const [key, updates] of Object.entries(skills)) {
      if (updates?.master === true && actor.system.skills[key]?.expert) updates.expert = false;
      if (updates?.expert === true && actor.system.skills[key]?.master) updates.master = false;
    }
  }
  const custom = changes?.system?.customSkills;
  if (custom) {
    for (const [key, updates] of Object.entries(custom)) {
      if (updates?.master === true && actor.system.customSkills[key]?.expert) updates.expert = false;
      if (updates?.expert === true && actor.system.customSkills[key]?.master) updates.master = false;
    }
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
      const isArea = btn.dataset.area === "true";
      
      await applyDamageToTarget(width, height, dmgFormula, ap, isMassive, isArea);
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