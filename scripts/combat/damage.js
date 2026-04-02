// scripts/combat/damage.js
const { DialogV2 } = foundry.applications.api;
import { computeLocationDamage, getHitLocation, getHitLocationLabel, getEffectiveMax, parseORE } from "../helpers/ore-engine.js";

function evaluateMathString(exprStr, widthValue) {
  let expr = String(exprStr ?? "").toLowerCase().replace(/width/g, widthValue).replace(/\s/g, "");
  try {
    let sum = 0;
    let terms = expr.replace(/-/g, "+-").split("+");
    for (let t of terms) {
      if (!t) continue;
      if (t.includes("*")) {
        sum += t.split("*").reduce((a, b) => (parseInt(a) || 0) * (parseInt(b) || 0), 1);
      } else if (t.includes("/")) {
        let [a, b] = t.split("/");
        sum += Math.floor((parseInt(a) || 0) / (parseInt(b) || 1));
      } else {
        sum += parseInt(t) || 0;
      }
    }
    return sum;
  } catch (e) {
    return parseInt(expr) || 0;
  }
}

function getProtectedShieldCoverAR(actor, locKey) {
  if (!actor?.items) return 0;
  const equippedShields = actor.items.filter(i => i.type === "shield" && i.system.equipped);
  return equippedShields.reduce((sum, shield) => {
    const sys = shield.system || {};
    const effectiveLocs = sys.effectiveLocations || sys.protectedLocations || {};
    const isProtected = !!effectiveLocs[locKey];
    return sum + (isProtected ? (Number(sys.coverAR) || 0) : 0);
  }, 0);
}

function applyOverflowToTorso(localHealth, actor, overflowKilling) {
  if (overflowKilling <= 0) return;
  const torso = localHealth.torso;
  const torsoEffectiveMax = getEffectiveMax(actor, "torso");
  const torsoResult = computeLocationDamage(
    torso.shock || 0,
    torso.killing || 0,
    0,
    overflowKilling,
    torsoEffectiveMax
  );
  torso.shock = torsoResult.newShock;
  torso.killing = torsoResult.newKilling;
}

function buildDamageSummaryLine(locKey, finalShock, finalKilling, shockSoaked, killingSoaked, convertedShock, totalCoverAr, overflowKilling) {
  const locName = getHitLocationLabel(locKey).split(" (")[0];
  let summaryText = `<strong>${locName}:</strong> `;

  if (finalKilling > 0) summaryText += `<span style="color: #8b1f1f;">${finalKilling} Kill</span> `;
  if (finalShock > 0) summaryText += `<span>${finalShock} Shock</span> `;

  if (convertedShock > 0) {
    summaryText += ` <span style="font-size: 0.85em; color: #d97706;">(${convertedShock} Shock → Killing)</span> `;
  }

  if (shockSoaked > 0 || killingSoaked > 0) {
    const shieldNote = totalCoverAr > 0 ? ` (incl. ${totalCoverAr} Shield AR)` : "";
    summaryText += `<span style="font-size: 0.85em; color: #666;">(Armor${shieldNote} stopped ${shockSoaked}S/${killingSoaked}K)</span>`;
  }

  if (overflowKilling > 0 && locKey !== "torso" && locKey !== "head") {
    summaryText += `<br><span style="color: #8b1f1f; font-size: 0.85em;">(+${overflowKilling} Killing overflow to Torso)</span>`;
  }

  return summaryText;
}

function getStatusAlertHtml(targetActor, localHealth) {
    const headMax = getEffectiveMax(targetActor, "head");
    const torsoMax = getEffectiveMax(targetActor, "torso");
    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    if (localHealth.head.killing >= headMax) {
      return `<div style="background: #4a0000; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.2em; margin-top: 8px; border-radius: 3px;">☠ ${safeTargetName} IS DEAD (Head destroyed)</div>`;
    } else if (localHealth.torso.killing >= torsoMax) {
      return `<div style="background: #4a0000; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.2em; margin-top: 8px; border-radius: 3px;">☠ ${safeTargetName} IS DEAD (Torso destroyed)</div>`;
    } else if (localHealth.head.shock + localHealth.head.killing >= headMax) {
      return `<div style="background: #1a237e; color: #fff; padding: 8px; text-align: center; font-weight: bold; font-size: 1.1em; margin-top: 8px; border-radius: 3px;">💫 ${safeTargetName} IS UNCONSCIOUS (Head full of Shock)</div>`;
    } else if (localHealth.torso.shock + localHealth.torso.killing >= torsoMax) {
      return `<div style="background: #e65100; color: #fff; padding: 6px; text-align: center; font-weight: bold; font-size: 0.95em; margin-top: 8px; border-radius: 3px;">⚡ ${safeTargetName} IS DAZED (−1d all actions)</div>`;
    } else {
      const isMaimed = (localHealth.armL.killing >= getEffectiveMax(targetActor, "armL")) ||
                       (localHealth.armR.killing >= getEffectiveMax(targetActor, "armR")) ||
                       (localHealth.legL.killing >= getEffectiveMax(targetActor, "legL")) ||
                       (localHealth.legR.killing >= getEffectiveMax(targetActor, "legR"));
      if (isMaimed) {
        return `<div style="background: #8b1f1f; color: #fff; padding: 6px; text-align: center; font-weight: bold; font-size: 0.95em; margin-top: 8px; border-radius: 3px;">🩸 ${safeTargetName} IS MAIMED AND BLEEDING (Limb destroyed)</div>`;
      }
    }
    return "";
}

export async function applyDamageToTarget(width, height, dmgString, ap = 0, isMassive = false, areaDice = 0) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");

  const safeDmgStr = String(dmgString || "Width Shock").toLowerCase();
  let baseShock = 0;
  let baseKilling = 0;

  const shockMatch = safeDmgStr.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*shock/);
  const killMatch = safeDmgStr.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*killing/);

  if (!shockMatch && !killMatch) {
    baseShock = evaluateMathString(safeDmgStr, width);
  }

  if (shockMatch) baseShock = evaluateMathString(shockMatch[1], width);
  if (killMatch) baseKilling = evaluateMathString(killMatch[1], width);

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

      let publicContent = `<div class="reign-chat-card" style="border-color: #8b1f1f;"><h3 style="color: #8b1f1f;">Battlefield Attrition</h3><p>${safeTargetName} took <strong>${magDmg} Magnitude</strong> damage.</p>`;

      let moralePool = targetActor.system.morale?.value ?? targetActor.system.threatLevel ?? 0;
      let moraleUpdate = null;

      if (newMag > 0 && moralePool > 0) {
        const roll = new Roll(`${moralePool}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        const parsed = parseORE(results);

        publicContent += `<hr><h4>Automatic Morale Check (Pool: ${moralePool})</h4>`;

        if (parsed.sets.length > 0) {
          publicContent += `<p style="color: #2d5a27; font-weight: bold; margin-bottom: 0;">SUCCESS!</p><p style="margin-top: 2px;">The horde holds its ground.</p>`;
        } else {
          let currentMorale = targetActor.system.morale?.value || 0;
          let newMorale = Math.max(0, currentMorale - 1);
          moraleUpdate = newMorale;

          publicContent += `<p style="color: #8b1f1f; font-weight: bold; margin-bottom: 0;">FAILURE!</p><p style="margin-top: 2px;">Morale drops to ${newMorale}.</p>`;
          if (newMorale === 0) {
            publicContent += `<div style="background: #4a0000; color: #fff; padding: 5px; text-align: center; font-weight: bold; font-size: 1.1em; margin-top: 8px; border-radius: 3px;">THE HORDE ROUTS (Zero Morale)</div>`;
            newMag = 0;
          }
        }
      }

      const threatUpdates = { "system.magnitude.value": newMag };
      if (moraleUpdate !== null) threatUpdates["system.morale.value"] = moraleUpdate;
      await targetActor.update(threatUpdates);

      publicContent += `</div>`;
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: publicContent });

      const parentId = targetActor.system.parentCompany;
      if (parentId) {
        const parentComp = game.actors.get(parentId);
        if (parentComp) {
          const safeParentName = foundry.utils.escapeHTML(parentComp.name);
          let gmNotice = `<p><strong>Command Link:</strong> This horde belongs to <strong>${safeParentName}</strong>. Their loss of ${magDmg} Magnitude should reduce the company's Temporary <em>Might</em> or <em>Influence</em>.</p>`;
          if (newMag === 0) gmNotice += `<p style="color: #8b1f1f; font-weight: bold;">Rout! The complete destruction of this unit warrants an immediate Company-level penalty.</p>`;

          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: targetActor }),
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

    if (areaDice > 0) {
      const splashRoll = new Roll(`${areaDice}d10`);
      await splashRoll.evaluate();
      const hitLocs = splashRoll.dice[0].results.map(r => getHitLocation(r.result));
      const locCounts = {};
      hitLocs.forEach(l => {
        if (l !== "unknown") locCounts[l] = (locCounts[l] || 0) + 1;
      });

      const orderedLocations = ["head", "torso", "armR", "armL", "legR", "legL"];
      let primaryLoc = "";
      let primaryCount = -1;
      for (const locKey of orderedLocations) {
        const count = locCounts[locKey] || 0;
        if (count > primaryCount) {
          primaryCount = count;
          primaryLoc = locKey;
        }
      }

      const isKillingWeapon = baseKilling > 0;
      const isShockWeapon = baseShock > 0 && baseKilling === 0;

      for (let [locKey, hits] of Object.entries(locCounts)) {
        if (locKey === "unknown") continue;

        let finalKilling = isKillingWeapon ? hits : 0;
        let finalShock = isShockWeapon ? hits : 0;

        if (isMassive && locKey === primaryLoc && finalKilling > 0) finalKilling += 1;

        let loc = localHealth[locKey];
        const totalCoverAr = 0;
        const effectiveAr = 0;
        const shockSoaked = 0;
        const killingSoaked = 0;

        const effectiveMax = getEffectiveMax(targetActor, locKey);
        const result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, effectiveMax);

        loc.shock = result.newShock;
        loc.killing = result.newKilling;

        if (result.overflowKilling > 0 && locKey !== "torso" && locKey !== "head") {
          applyOverflowToTorso(localHealth, targetActor, result.overflowKilling);
        }

        if (finalShock > 0 || finalKilling > 0 || shockSoaked > 0 || killingSoaked > 0) {
          damageSummary.push(
            buildDamageSummaryLine(locKey, finalShock, finalKilling, shockSoaked, killingSoaked, result.convertedShock, totalCoverAr, result.overflowKilling)
          );
        }
      }
    } else {
      const loc = localHealth[mainLocKey];
      const totalCoverAr = getProtectedShieldCoverAR(targetActor, mainLocKey);
      const effectiveAr = Math.max(0, (loc.armor || 0) + totalCoverAr - ap);

      let finalKilling = baseKilling;
      let finalShock = baseShock;

      const shockSoaked = Math.min(finalShock, effectiveAr);
      const killingSoaked = Math.min(finalKilling, effectiveAr);

      finalShock = Math.max(0, finalShock - effectiveAr);
      finalKilling = Math.max(0, finalKilling - effectiveAr);

      const effectiveMax = getEffectiveMax(targetActor, mainLocKey);
      const result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, effectiveMax);

      loc.shock = result.newShock;
      loc.killing = result.newKilling;

      if (result.overflowKilling > 0 && mainLocKey !== "torso" && mainLocKey !== "head") {
        applyOverflowToTorso(localHealth, targetActor, result.overflowKilling);
      }

      if (finalShock > 0 || finalKilling > 0 || shockSoaked > 0 || killingSoaked > 0) {
        damageSummary.push(
          buildDamageSummaryLine(mainLocKey, finalShock, finalKilling, shockSoaked, killingSoaked, result.convertedShock, totalCoverAr, result.overflowKilling)
        );
      }
    }

    await targetActor.update({ "system.health": localHealth });
    await syncCharacterStatusEffects(targetActor);

    const statusAlert = getStatusAlertHtml(targetActor, localHealth);
    const summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br><br>") : "<em>All damage harmlessly deflected by armor!</em>";
    const chatContent = `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Damage Applied</h3><p style="margin-bottom: 5px;"><strong>Target:</strong> ${safeTargetName} ${areaDice > 0 ? "<em>(Area Effect)</em>" : ""}</p><div style="background: rgba(0,0,0,0.05); padding: 5px; border-left: 3px solid #8b1f1f;">${summaryHtml}</div>${statusAlert}</div>`;

    await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });
  }
}

export async function applyScatteredDamageToTarget(facesArrayStr, damageType, ap = 0) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");

  const faces = JSON.parse(facesArrayStr);
  if (!faces || faces.length === 0) return;

  const isKilling = String(damageType).toLowerCase() === "killing";
  const isShock = String(damageType).toLowerCase() === "shock";
  const isHealing = String(damageType).toLowerCase() === "healing";

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor) continue;

    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    if (targetActor.type === "threat") {
      let magDmg = isKilling ? faces.length : Math.floor(faces.length / 2);
      if (magDmg < 1) {
        ui.notifications.info(`${safeTargetName} shrugged off the scattered attack! (Shock damage must be 2+ to reduce Magnitude)`);
        continue;
      }

      let currentMag = targetActor.system.magnitude.value;
      let newMag = Math.max(0, currentMag - magDmg);
      let publicContent = `<div class="reign-chat-card" style="border-color: #8b1f1f;"><h3 style="color: #8b1f1f;">Scattered Attrition</h3><p>${safeTargetName} took <strong>${magDmg} Magnitude</strong> damage from scattered hits.</p>`;

      let moralePool = targetActor.system.morale?.value ?? targetActor.system.threatLevel ?? 0;
      let moraleUpdate = null;

      if (newMag > 0 && moralePool > 0) {
        const roll = new Roll(`${moralePool}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        const parsed = parseORE(results);

        publicContent += `<hr><h4>Automatic Morale Check (Pool: ${moralePool})</h4>`;

        if (parsed.sets.length > 0) {
          publicContent += `<p style="color: #2d5a27; font-weight: bold; margin-bottom: 0;">SUCCESS!</p><p style="margin-top: 2px;">The horde holds its ground.</p>`;
        } else {
          let currentMorale = targetActor.system.morale?.value || 0;
          let newMorale = Math.max(0, currentMorale - 1);
          moraleUpdate = newMorale;

          publicContent += `<p style="color: #8b1f1f; font-weight: bold; margin-bottom: 0;">FAILURE!</p><p style="margin-top: 2px;">Morale drops to ${newMorale}.</p>`;
          if (newMorale === 0) {
            publicContent += `<div style="background: #4a0000; color: #fff; padding: 5px; text-align: center; font-weight: bold; font-size: 1.1em; margin-top: 8px; border-radius: 3px;">THE HORDE ROUTS (Zero Morale)</div>`;
            newMag = 0;
          }
        }
      }

      const threatUpdates = { "system.magnitude.value": newMag };
      if (moraleUpdate !== null) threatUpdates["system.morale.value"] = moraleUpdate;
      await targetActor.update(threatUpdates);

      publicContent += `</div>`;
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: publicContent });

      if (newMag === 0) ui.notifications.warn(`The ${safeTargetName} has been completely routed or destroyed!`);
      continue;
    }

    if (targetActor.type !== "character") continue;

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let damageSummary = [];

    const locCounts = {};
    for (let face of faces) {
      const locKey = getHitLocation(face);
      if (locKey !== "unknown") locCounts[locKey] = (locCounts[locKey] || 0) + 1;
    }

    for (let [locKey, hits] of Object.entries(locCounts)) {
      
      // HEALING ENGINE: Handle Waste Healing logic!
      if (isHealing) {
          let loc = localHealth[locKey];
          let healedKilling = 0;
          let healedShock = 0;
          let remainingHeal = hits;

          while(remainingHeal > 0 && loc.killing > 0) {
              loc.killing -= 1;
              healedKilling += 1;
              remainingHeal -= 1;
          }
          while(remainingHeal > 0 && loc.shock > 0) {
              loc.shock -= 1;
              healedShock += 1;
              remainingHeal -= 1;
          }

          if (healedKilling > 0 || healedShock > 0) {
              const locName = getHitLocationLabel(locKey).split(" (")[0];
              let healText = `<strong>${locName}:</strong> `;
              if (healedKilling > 0) healText += `<span style="color: #8b1f1f;">Recovered ${healedKilling} Kill</span> `;
              if (healedShock > 0) healText += `<span style="color: #2d5a27;">Recovered ${healedShock} Shock</span>`;
              damageSummary.push(healText);
          }
          continue;
      }

      let finalKilling = isKilling ? hits : 0;
      let finalShock = isShock ? hits : 0;

      let loc = localHealth[locKey];
      const totalCoverAr = getProtectedShieldCoverAR(targetActor, locKey);
      const effectiveAr = Math.max(0, (loc.armor || 0) + totalCoverAr - ap);

      const shockSoaked = Math.min(finalShock, effectiveAr);
      const killingSoaked = Math.min(finalKilling, effectiveAr);

      finalShock = Math.max(0, finalShock - effectiveAr);
      finalKilling = Math.max(0, finalKilling - effectiveAr);

      const effectiveMax = getEffectiveMax(targetActor, locKey);
      const result = computeLocationDamage(loc.shock || 0, loc.killing || 0, finalShock, finalKilling, effectiveMax);

      loc.shock = result.newShock;
      loc.killing = result.newKilling;

      if (result.overflowKilling > 0 && locKey !== "torso" && locKey !== "head") {
        applyOverflowToTorso(localHealth, targetActor, result.overflowKilling);
      }

      if (finalShock > 0 || finalKilling > 0 || shockSoaked > 0 || killingSoaked > 0) {
        damageSummary.push(
          buildDamageSummaryLine(locKey, finalShock, finalKilling, shockSoaked, killingSoaked, result.convertedShock, totalCoverAr, result.overflowKilling)
        );
      }
    }

    await targetActor.update({ "system.health": localHealth });
    await syncCharacterStatusEffects(targetActor);

    if (isHealing) {
        const summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br>") : "<em>No damage required healing!</em>";
        const chatContent = `<div class="reign-chat-card"><h3 style="color: #2e7d32;">Waste Healing Applied</h3><p style="margin-bottom: 5px;"><strong>Target:</strong> ${safeTargetName}</p><div style="background: rgba(0,0,0,0.05); padding: 5px; border-left: 3px solid #2e7d32;">${summaryHtml}</div></div>`;
        await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });
    } else {
        const statusAlert = getStatusAlertHtml(targetActor, localHealth);
        const summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br><br>") : "<em>All waste hits harmlessly deflected by armor!</em>";
        const chatContent = `<div class="reign-chat-card"><h3 style="color: #c62828;">Scattered Damage Applied</h3><p style="margin-bottom: 5px;"><strong>Target:</strong> ${safeTargetName} <em>(Waste Hits)</em></p><div style="background: rgba(0,0,0,0.05); padding: 5px; border-left: 3px solid #c62828;">${summaryHtml}</div>${statusAlert}</div>`;
        await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });
    }
  }
}

export async function applyCompanyDamageToTarget(width, qualityKey) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a Company token first!");

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "company") continue;

    const latestActor = game.actors.get(targetActor.id);
    if (!latestActor) continue;
    if (!qualityKey || !latestActor.system?.qualities?.[qualityKey]) {
      ui.notifications.warn(`Invalid company quality: ${qualityKey}`);
      continue;
    }

    const safeTargetName = foundry.utils.escapeHTML(latestActor.name);
    const qualityData = latestActor.system.qualities[qualityKey];
    const currentTemp = qualityData.current || 0;
    const currentPerm = qualityData.permanent || 0;

    let newTemp = currentTemp - width;
    let newPerm = currentPerm;
    let overflow = 0;

    if (newTemp < 0) {
      overflow = Math.abs(newTemp);
      newTemp = 0;
      newPerm = Math.max(0, currentPerm - overflow);
    }

    const updates = {
      [`system.qualities.${qualityKey}.current`]: newTemp
    };
    
    if (overflow > 0) {
      updates[`system.qualities.${qualityKey}.permanent`] = newPerm;
    }

    await latestActor.update(updates);
    
    if (overflow > 0) {
      ui.notifications.warn(`Dealt ${width} damage to ${safeTargetName}'s ${qualityKey.toUpperCase()}. Temporary broke, overflowing ${overflow} damage into Permanent (Now ${newPerm})!`);
    } else {
      ui.notifications.info(`Dealt ${width} damage to ${safeTargetName}'s Temporary ${qualityKey.toUpperCase()} (Now ${newTemp}).`);
    }
  }
}

/**
 * HEALING ENGINE: Magical Primary Healing
 */
export async function applyHealingToTarget(width, height, healString) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");

  const safeHealStr = String(healString || "Width Healing").toLowerCase();
  let baseHeal = 0;
  
  const healMatch = safeHealStr.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*healing/);
  if (healMatch) {
      baseHeal = evaluateMathString(healMatch[1], width);
  } else {
      baseHeal = evaluateMathString(safeHealStr.replace(/healing/gi, ""), width);
  }

  if (baseHeal <= 0) return ui.notifications.info("No healing points generated by this formula.");

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "character") continue;

    const mainLocKey = getHitLocation(height);
    if (mainLocKey === "unknown") continue;

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let loc = localHealth[mainLocKey];
    
    let healedKilling = 0;
    let healedShock = 0;
    let remainingHeal = baseHeal;

    while(remainingHeal > 0 && loc.killing > 0) {
        loc.killing -= 1;
        healedKilling += 1;
        remainingHeal -= 1;
    }
    while(remainingHeal > 0 && loc.shock > 0) {
        loc.shock -= 1;
        healedShock += 1;
        remainingHeal -= 1;
    }

    if (healedKilling > 0 || healedShock > 0) {
        await targetActor.update({ "system.health": localHealth });
        await syncCharacterStatusEffects(targetActor);
        
        const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
        const locName = getHitLocationLabel(mainLocKey).split(" (")[0];
        
        let healHtml = `<div class="reign-chat-card"><h3 style="color: #2e7d32;">Magical Healing Applied</h3><p style="margin-bottom: 5px;"><strong>Target:</strong> ${safeTargetName}</p><div style="background: rgba(0,0,0,0.05); padding: 5px; border-left: 3px solid #2e7d32;"><strong>${locName}:</strong> `;
        if (healedKilling > 0) healHtml += `<span style="color: #8b1f1f;">Recovered ${healedKilling} Kill</span> `;
        if (healedShock > 0) healHtml += `<span style="color: #2d5a27;">Recovered ${healedShock} Shock</span>`;
        healHtml += `</div></div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: healHtml });
    } else {
        ui.notifications.info(`${targetActor.name}'s ${mainLocKey} is already fully healed.`);
    }
  }
}

/**
 * HEALING ENGINE: First Aid (Medicine/Healing Skill)
 */
export async function applyFirstAidToTarget(width) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token to treat!");

  const content = `
    <div class="reign-dialog-form">
      <p style="text-align: center; font-size: 1.1em;">Select the hit location to treat.</p>
      <p style="font-size: 0.85em; color: #555; text-align: center; margin-bottom: 10px;">(Converts up to <strong>${width} Killing</strong> damage back to Shock)</p>
      <div class="form-group">
        <label>Body Part:</label>
        <select name="locKey">
          <option value="head">Head</option>
          <option value="torso">Torso</option>
          <option value="armR">Right Arm</option>
          <option value="armL">Left Arm</option>
          <option value="legR">Right Leg</option>
          <option value="legL">Left Leg</option>
        </select>
      </div>
    </div>
  `;

  const locKey = await DialogV2.wait({
      classes: ["reign-dialog-window"],
      window: { title: "Apply First Aid" },
      content: content,
      rejectClose: false, // P2-6 FIX: Safe Cancellation
      buttons: [{
          action: "confirm", label: "Treat Wound", default: true,
          callback: (e, b, d) => {
              const val = d.element.querySelector('[name="locKey"]').value;
              if (d && typeof d.close === 'function') d.close({ animate: false });
              return val;
          }
      }]
  });

  // P2-6 FIX: Ensure we stop if the dialog was closed without a selection
  if (!locKey) return;

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "character") continue;

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let loc = localHealth[locKey];
    
    let converted = 0;
    for (let i = 0; i < width; i++) {
      if (loc.killing > 0) {
        loc.killing -= 1;
        loc.shock += 1;
        converted += 1;
      }
    }

    if (converted > 0) {
        await targetActor.update({ "system.health": localHealth });
        await syncCharacterStatusEffects(targetActor);
        
        const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
        const locName = getHitLocationLabel(locKey).split(" (")[0];
        
        let chatHtml = `<div class="reign-chat-card"><h3 style="color: #0277bd;"><i class="fas fa-notes-medical"></i> First Aid Applied</h3><p style="margin-bottom: 5px;"><strong>Patient:</strong> ${safeTargetName}</p><div style="background: #e3f2fd; padding: 5px; border-left: 3px solid #0277bd;"><strong>${locName}:</strong> Converted <strong>${converted} Killing</strong> damage back to Shock.</div></div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: chatHtml });
    } else {
        ui.notifications.warn(`${targetActor.name} has no Killing damage on their ${locKey} to treat.`);
    }
  }
}

export async function syncCharacterStatusEffects(actor) {
  if (actor.type !== "character") return;
  const health = actor.system.health;

  const headMax = getEffectiveMax(actor, "head");
  const torsoMax = getEffectiveMax(actor, "torso");
  const armLMax = getEffectiveMax(actor, "armL");
  const armRMax = getEffectiveMax(actor, "armR");
  const legLMax = getEffectiveMax(actor, "legL");
  const legRMax = getEffectiveMax(actor, "legR");

  const isDead = (health.head.killing >= headMax) || (health.torso.killing >= torsoMax);
  const isUnconscious = !isDead && (health.head.shock + health.head.killing >= headMax);
  const isDazed = !isDead && (health.torso.shock + health.torso.killing >= torsoMax);
  
  const isMaimed = !isDead && (
    (health.armL.killing >= armLMax) ||
    (health.armR.killing >= armRMax) ||
    (health.legL.killing >= legLMax) ||
    (health.legR.killing >= legRMax)
  );

  const toggle = async (statusId, active) => {
    const hasStatus = actor.statuses.has(statusId);
    if (active && !hasStatus) return actor.toggleStatusEffect(statusId, { active: true });
    else if (!active && hasStatus) return actor.toggleStatusEffect(statusId, { active: false });
  };

  await toggle("dead", isDead);
  await toggle("unconscious", isUnconscious);
  await toggle("dazed", isDazed);
  await toggle("maimed", isMaimed);
  await toggle("bleeding", isMaimed);
}