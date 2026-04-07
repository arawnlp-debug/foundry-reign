// scripts/combat/damage.js
const { DialogV2 } = foundry.applications.api;
import { computeLocationDamage, getHitLocation, getHitLocationLabel, parseORE } from "../helpers/ore-engine.js";
import { generateOREChatHTML } from "../helpers/chat.js";
import { reignDialog } from "../helpers/dialog-util.js";

/**
 * Safely evaluates a math string formula, substituting "width" where necessary.
 * AUDIT FIX P2: Removed deprecated async fallback for pure V13 evaluateSync.
 * @param {string} exprStr - The raw math string (e.g., "Width + 1").
 * @param {number} widthValue - The width of the matched set.
 * @returns {number} The evaluated integer result.
 */
function evaluateMathString(exprStr, widthValue) {
  let expr = String(exprStr ?? "0").toLowerCase().replace(/width/gi, widthValue).replace(/\s/g, "");
  try {
      let r = new Roll(expr);
      return r.evaluateSync().total;
  } catch (e) { 
      return parseInt(expr) || 0; 
  }
}

/**
 * Calculates the total Armor Rating (AR) provided by equipped shields for a specific location.
 * @param {Actor} actor - The target actor document.
 * @param {string} locKey - The body location key (e.g., "head", "armL").
 * @returns {number} The total AR provided by shields covering this location.
 */
function getProtectedShieldCoverAR(actor, locKey) {
  if (!actor?.items) return 0;
  const equippedShields = actor.items.filter(i => i.type === "shield" && i.system.equipped);
  return equippedShields.reduce((sum, shield) => {
    const sys = shield.system || {};
    const isProtected = !!sys.effectiveLocations?.[locKey];
    return sum + (isProtected ? (Number(sys.coverAR) || 0) : 0);
  }, 0);
}

/**
 * Applies overflowing Killing damage from a destroyed limb to the character's Torso.
 * @param {Object} localHealth - The cloned health data object being modified.
 * @param {Actor} actor - The target actor document.
 * @param {number} overflowKilling - The amount of Killing damage exceeding the limb's max capacity.
 */
function applyOverflowToTorso(localHealth, actor, overflowKilling) {
  if (overflowKilling <= 0) return;
  const torso = localHealth.torso;
  const torsoEffectiveMax = actor.system.effectiveMax.torso; 
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

/**
 * Constructs the HTML string summarizing the damage dealt to a specific body location.
 * @param {string} locKey - The location key.
 * @param {number} finalShock - Shock damage successfully applied.
 * @param {number} finalKilling - Killing damage successfully applied.
 * @param {number} shockSoaked - Shock damage stopped by armor.
 * @param {number} killingSoaked - Killing damage stopped by armor.
 * @param {number} convertedShock - Shock converted to Killing due to box limits.
 * @param {number} totalCoverAr - The AR provided specifically by a shield.
 * @param {number} overflowKilling - Killing damage that spilled over to the torso.
 * @returns {string} The formatted HTML string for the chat card.
 */
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

/**
 * Generates an HTML banner alert based on the target's new health status (e.g., Dead, Unconscious, Dazed).
 * @param {Actor} targetActor - The target actor document.
 * @param {Object} localHealth - The updated health data object.
 * @returns {string} The formatted HTML banner string, or an empty string if no status applies.
 */
function getStatusAlertHtml(targetActor, localHealth) {
    const headMax = targetActor.system.effectiveMax.head || 4;
    const torsoMax = targetActor.system.effectiveMax.torso || 10;
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
      const isMaimed = (localHealth.armL.killing >= (targetActor.system.effectiveMax.armL || 5)) ||
                       (localHealth.armR.killing >= (targetActor.system.effectiveMax.armR || 5)) ||
                       (localHealth.legL.killing >= (targetActor.system.effectiveMax.legL || 5)) ||
                       (localHealth.legR.killing >= (targetActor.system.effectiveMax.legR || 5));
      if (isMaimed) {
        return `<div style="background: #8b1f1f; color: #fff; padding: 6px; text-align: center; font-weight: bold; font-size: 0.95em; margin-top: 8px; border-radius: 3px;">🩸 ${safeTargetName} IS MAIMED AND BLEEDING (Limb destroyed)</div>`;
      }
    }
    return "";
}

/**
 * Calculates and applies standard primary attack damage to the currently selected tokens.
 * Supports Area Effect, Massive, and Armor Piercing qualities.
 * @param {number} width - The width of the attacking set.
 * @param {number} height - The height of the attacking set (determines hit location).
 * @param {string} dmgString - The damage formula (e.g., "Width Shock", "Width + 1 Killing").
 * @param {number} [ap=0] - Armor Piercing value.
 * @param {boolean} [isMassive=false] - Whether the attack has the Massive quality.
 * @param {number} [areaDice=0] - The number of d10s to roll for Area Effect damage locations.
 */
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

  if (baseShock <= 0 && baseKilling <= 0 && areaDice <= 0) {
      ui.notifications.info(`The attack formula [${dmgString}] evaluated to 0 damage. The attack has no effect.`);
      return;
  }

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

    let mainLocKey = getHitLocation(height);
    if (mainLocKey === "unknown") continue;

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let damageSummary = [];
    let tookDamage = false;

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

        const isMissing = targetActor.items.some(i => i.type === "problem" && i.system.hook?.includes(`[${locKey}.missing]`));
        if (isMissing) {
            ui.notifications.info(`${safeTargetName}'s ${locKey} is missing! Damage redirected to Torso.`);
            locKey = "torso";
        }

        let finalKilling = isKillingWeapon ? hits : 0;
        let finalShock = isShockWeapon ? hits : 0;

        if (isMassive && locKey === primaryLoc && finalKilling > 0) finalKilling += 1;

        let loc = localHealth[locKey];
        const totalCoverAr = 0;
        const effectiveAr = 0;
        
        const shockSoaked = 0;
        const killingSoaked = 0;

        if (finalShock > 0 || finalKilling > 0) tookDamage = true;

        const effectiveMax = targetActor.system.effectiveMax?.[locKey] || 5;
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
      const isMissing = targetActor.items.some(i => i.type === "problem" && i.system.hook?.includes(`[${mainLocKey}.missing]`));
      if (isMissing) {
          ui.notifications.info(`${safeTargetName}'s ${mainLocKey} is missing! Damage redirected to Torso.`);
          mainLocKey = "torso";
      }

      const loc = localHealth[mainLocKey];
      const totalCoverAr = getProtectedShieldCoverAR(targetActor, mainLocKey);
      const effectiveAr = Math.max(0, (targetActor.system.effectiveArmor?.[mainLocKey] || 0) + totalCoverAr - ap);

      let finalKilling = baseKilling;
      let finalShock = baseShock;

      const shockSoaked = Math.min(finalShock, effectiveAr);
      const killingSoaked = Math.min(finalKilling, effectiveAr);

      finalShock = Math.max(0, finalShock - effectiveAr);
      finalKilling = Math.max(0, finalKilling - effectiveAr);

      if (finalShock > 0 || finalKilling > 0) tookDamage = true;

      const effectiveMax = targetActor.system.effectiveMax?.[mainLocKey] || 5;
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

    if (tookDamage) {
        await checkAndSpoilSet(targetActor);
    }
  }
}

/**
 * Calculates and applies scattered/waste damage or healing based on a raw array of unmatched dice faces.
 * @param {string} facesArrayStr - Stringified JSON array of unmatched face values.
 * @param {string} damageType - The type of effect ("killing", "shock", or "healing").
 * @param {number} [ap=0] - Armor Piercing value.
 */
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
    let tookDamage = false;

    const locCounts = {};
    for (let face of faces) {
      let locKey = getHitLocation(face);
      const isMissing = targetActor.items.some(i => i.type === "problem" && i.system.hook?.includes(`[${locKey}.missing]`));
      if (isMissing) {
          ui.notifications.info(`${safeTargetName}'s ${locKey} is missing! Scattered damage redirected to Torso.`);
          locKey = "torso";
      }

      if (locKey !== "unknown") locCounts[locKey] = (locCounts[locKey] || 0) + 1;
    }

    for (let [locKey, hits] of Object.entries(locCounts)) {
      
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
      const effectiveAr = Math.max(0, (targetActor.system.effectiveArmor?.[locKey] || 0) + totalCoverAr - ap);

      const shockSoaked = Math.min(finalShock, effectiveAr);
      const killingSoaked = Math.min(finalKilling, effectiveAr);

      finalShock = Math.max(0, finalShock - effectiveAr);
      finalKilling = Math.max(0, finalKilling - effectiveAr);

      if (finalShock > 0 || finalKilling > 0) tookDamage = true;

      const effectiveMax = targetActor.system.effectiveMax?.[locKey] || 5;
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
        
        if (tookDamage) {
            await checkAndSpoilSet(targetActor);
        }
    }
  }
}

/**
 * Applies damage directly to a specific Quality of a targeted Company actor.
 * Automatically handles overflow from Temporary into Permanent damage.
 * @param {number} width - The width of the attacking set (determines damage amount).
 * @param {string} qualityKey - The Company quality being targeted (e.g., "might").
 */
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
 * Applies targeted magical healing to a character's hit location.
 * @param {number} width - The width of the spell set.
 * @param {number} height - The height of the spell set (determines hit location).
 * @param {string} healString - The healing formula string (e.g., "Width Healing").
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
 * Applies RAW standard non-magical First Aid to a target character.
 * Prompts the user for a hit location and converts exactly 1 Killing damage to 1 Shock.
 * @param {number} width - The width of the Medicine/Healing roll (used to confirm success, but does not scale healing amount).
 */
export async function applyFirstAidToTarget(width) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token to treat!");

  const content = `
    <div class="reign-dialog-form">
      <p style="text-align: center; font-size: 1.1em;">Select the hit location to treat.</p>
      <p style="font-size: 0.85em; color: #555; text-align: center; margin-bottom: 10px;">(Converts <strong>1 Killing</strong> damage back to Shock)</p>
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

  const locKey = await reignDialog(
      "Apply First Aid",
      content,
      (e, b, d) => d.element.querySelector('[name="locKey"]').value,
      { defaultLabel: "Treat Wound" }
  );

  if (!locKey) return;

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "character") continue;

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let loc = localHealth[locKey];
    
    let converted = 0;
    if (loc.killing > 0) {
      loc.killing -= 1;
      loc.shock += 1;
      converted = 1;
    }

    if (converted > 0) {
        await targetActor.update({ "system.health": localHealth });
        await syncCharacterStatusEffects(targetActor);
        
        const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
        const locName = getHitLocationLabel(locKey).split(" (")[0];
        
        let chatHtml = `<div class="reign-chat-card"><h3 style="color: #0277bd;"><i class="fas fa-notes-medical"></i> First Aid Applied</h3><p style="margin-bottom: 5px;"><strong>Patient:</strong> ${safeTargetName}</p><div style="background: #e3f2fd; padding: 5px; border-left: 3px solid #0277bd;"><strong>${locName}:</strong> Converted <strong>1 Killing</strong> damage back to Shock.</div></div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: chatHtml });
    } else {
        ui.notifications.warn(`${targetActor.name} has no Killing damage on their ${locKey} to treat.`);
    }
  }
}

/**
 * Checks a character's current health values and applies or removes condition ActiveEffects 
 * (Dead, Unconscious, Dazed, Maimed, Bleeding) via an optimized batch update.
 * @param {Actor} actor - The target actor document to sync.
 */
export async function syncCharacterStatusEffects(actor) {
  if (actor.type !== "character") return;
  const health = actor.system.health;

  const headMax = actor.system.effectiveMax?.head || 4;
  const torsoMax = actor.system.effectiveMax?.torso || 10;
  const armLMax = actor.system.effectiveMax?.armL || 5;
  const armRMax = actor.system.effectiveMax?.armR || 5;
  const legLMax = actor.system.effectiveMax?.legL || 5;
  const legRMax = actor.system.effectiveMax?.legR || 5;

  const isDead = (health.head.killing >= headMax) || (health.torso.killing >= torsoMax);
  const isUnconscious = !isDead && (health.head.shock + health.head.killing >= headMax);
  const isDazed = !isDead && (health.torso.shock + health.torso.killing >= torsoMax);
  const isMaimed = !isDead && ((health.armL.killing >= armLMax) || (health.armR.killing >= armRMax) || (health.legL.killing >= legLMax) || (health.legR.killing >= legRMax));

  const targetStatuses = { dead: isDead, unconscious: isUnconscious, dazed: isDazed, maimed: isMaimed, bleeding: isMaimed };
  
  const toDelete = [];
  const toCreate = [];

  for (const [statusId, shouldBeActive] of Object.entries(targetStatuses)) {
    const existing = actor.effects.find(e => e.statuses.has(statusId));
    if (shouldBeActive && !existing) {
      const statusObj = CONFIG.statusEffects.find(e => e.id === statusId);
      if (statusObj) {
        const effectData = foundry.utils.deepClone(statusObj);
        effectData.statuses = [statusId];
        effectData.name = game.i18n.localize(statusObj.name) || statusObj.name;
        toCreate.push(effectData);
      }
    } else if (!shouldBeActive && existing) {
      toDelete.push(existing.id);
    }
  }

  if (toDelete.length > 0) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
  if (toCreate.length > 0) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
}

/**
 * Executes RAW Chapter 6 "Hit Spoils" mechanics.
 * If an actor takes damage while they have a pending combat action, they must lose 1 die
 * from their declared set. Removes old non-RAW speed/timing checks.
 * @param {Actor} targetActor - The actor who just took damage.
 */
async function checkAndSpoilSet(targetActor) {
    if (!game.combat || !game.combat.started) return;

    const combatant = game.combat.combatants.find(c => c.actorId === targetActor.id);
    if (!combatant || combatant.initiative === null) return;

    const latestMsg = game.messages.contents.slice().reverse().find(m => 
        m.speaker?.actor === targetActor.id && 
        m.flags?.reign?.results !== undefined
    );
    if (!latestMsg) return;

    const reignFlags = latestMsg.flags.reign;
    const parsed = parseORE(reignFlags.results, reignFlags.rollFlags?.isMinion);
    if (parsed.sets.length === 0) return;

    let newResults = [...reignFlags.results];
    
    const validSets = parsed.sets;
    let chosenHeight = validSets[0].height;

    if (validSets.length > 1) {
        let setOptions = validSets.map(s => `<option value="${s.height}">${s.width}x${s.height}</option>`).join("");
        const content = `
            <form class="reign-dialog-form">
                <p style="text-align: center; font-size: 1.1em; color: #8b1f1f; font-weight: bold;">Concentration Broken!</p>
                <p style="text-align: center;">You took damage before your action resolved. Per RAW, you must lose 1 die from one of your available sets.</p>
                <div class="form-group">
                    <label>Select Set to Spoil:</label>
                    <select name="spoiledHeight">${setOptions}</select>
                </div>
            </form>
        `;
        
        const choice = await reignDialog(
            "Action Spoiled",
            content,
            (e, b, d) => parseInt(d.element.querySelector('[name="spoiledHeight"]').value),
            { defaultLabel: "Lose Die" }
        );

        if (choice) chosenHeight = choice;
    }
    
    const index = newResults.indexOf(chosenHeight);
    if (index > -1) {
        newResults.splice(index, 1);
        
        const newHtml = await generateOREChatHTML(
            reignFlags.actorType,
            reignFlags.label,
            reignFlags.totalPool,
            newResults,
            reignFlags.expertDie,
            reignFlags.masterDiceCount,
            reignFlags.itemData,
            reignFlags.rollFlags
        );
        
        const spoilBanner = `<div style="background: #ffebee; border: 2px solid #ef5350; color: #c62828; padding: 8px; text-align: center; font-weight: bold; margin-bottom: 10px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"><i class="fas fa-bolt"></i> CONCENTRATION BROKEN! Lost 1 die from height ${chosenHeight} due to damage.</div>`;
        const finalHtml = newHtml.replace('<div class="reign-chat-card">', `<div class="reign-chat-card">${spoilBanner}`);
        
        await latestMsg.update({
            content: finalHtml,
            "flags.reign.results": newResults
        });

        const newParsed = parseORE(newResults, reignFlags.rollFlags?.isMinion);
        let newInit = 0;
        if (newParsed.sets.length > 0) {
            const newFastest = newParsed.sets.reduce((max, set) => {
                if (set.width > max.width) return set;
                if (set.width === max.width && set.height > max.height) return set;
                return max;
            });
            newInit = (newFastest.width * 10) + newFastest.height;
            
            const flags = reignFlags.rollFlags || {};
            const isDefense = flags.isDefense || /dodge|parry|counterspell/i.test(reignFlags.label);
            
            if (isDefense) {
                newInit += 0.90;
            } else if (flags.isAttack && reignFlags.itemData?.type === "weapon") {
                const rangeStr = (reignFlags.itemData.system.range || "0").toLowerCase().trim();
                let rangeWeight = 0;
                const rangeMap = { "touch": 1, "point": 1, "blank": 1, "short": 2, "medium": 3, "long": 4, "extreme": 6 };
                const keyword = Object.keys(rangeMap).find(k => rangeStr.includes(k));
                if (keyword) rangeWeight = rangeMap[keyword];
                else {
                    const match = rangeStr.match(/(\d+)/);
                    rangeWeight = match ? parseInt(match[1]) : 0;
                }
                newInit += Math.min(rangeWeight * 0.01, 0.89);
            }
            if (flags.isMinion) newInit -= 0.50;
        }
        
        await combatant.update({ initiative: newInit });
        ui.notifications.warn(`${targetActor.name}'s action was spoiled by the attack!`);
    }
}