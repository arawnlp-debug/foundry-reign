// scripts/combat/damage.js
const { DialogV2 } = foundry.applications.api;
import { computeLocationDamage, getHitLocation, getHitLocationLabel, parseORE, calculateInitiative } from "../helpers/ore-engine.js";
import { generateOREChatHTML } from "../helpers/chat.js";
import { reignDialog, reignAlert, reignClose } from "../helpers/dialog-util.js";
import { HIT_LOCATIONS } from "../helpers/config.js";

/**
 * Compares a localHealth object to the actor's current system.health and writes only deltas.
 * Ensures syncCharacterStatusEffects is always called after updates.
 * @param {Actor} actor - The target actor document.
 * @param {Object} localHealth - The modified health state keyed by location.
 * @returns {Promise<boolean>} True if any health values were actually changed.
 */
async function commitHealth(actor, localHealth) {
  const healthUpdates = {};
  for (const k of HIT_LOCATIONS) {
    if (localHealth[k].shock !== actor.system.health[k].shock) {
      healthUpdates[`system.health.${k}.shock`] = localHealth[k].shock;
    }
    if (localHealth[k].killing !== actor.system.health[k].killing) {
      healthUpdates[`system.health.${k}.killing`] = localHealth[k].killing;
    }
  }
  const changed = !foundry.utils.isEmpty(healthUpdates);
  if (changed) {
    await actor.update(healthUpdates);
  }
  await syncCharacterStatusEffects(actor);
  return changed;
}

/**
 * Safely evaluates a math string formula, substituting "width" where necessary.
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
 * Shared threat damage handler used by both direct and scattered damage paths.
 * Applies magnitude damage, runs morale checks, posts chat, and optionally notifies parent company.
 * @param {Actor} targetActor - The threat actor being damaged.
 * @param {number} magDmg - Pre-calculated magnitude damage to apply.
 * @param {string} headerText - Chat card header (e.g. "Battlefield Attrition").
 * @param {Object} [options={}]
 * @param {boolean} [options.checkParent=false] - Whether to post a GM whisper about the parent company.
 * @returns {Promise<void>}
 */
async function applyThreatDamageInternal(targetActor, magDmg, headerText, { checkParent = false } = {}) {
  const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

  let currentMag = targetActor.system.magnitude.value;
  let newMag = Math.max(0, currentMag - magDmg);
  let publicContent = `<div class="reign-chat-card reign-card-danger"><h3 class="reign-text-danger">${headerText}</h3><p>${safeTargetName} took <strong>${magDmg} Magnitude</strong> damage.</p>`;

  let moralePool = targetActor.system.morale?.value ?? targetActor.system.threatLevel ?? 0;
  let moraleUpdate = null;

  if (newMag > 0 && moralePool > 0) {
    const roll = new Roll(`${moralePool}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];
    const parsed = parseORE(results);

    publicContent += `<hr><h4>Automatic Morale Check (Pool: ${moralePool})</h4>`;

    if (parsed.sets.length > 0) {
      publicContent += `<p class="reign-text-success reign-text-bold reign-mb-0">SUCCESS!</p><p class="reign-mt-small">The horde holds its ground.</p>`;
    } else {
      let currentMorale = targetActor.system.morale?.value || 0;
      let newMorale = Math.max(0, currentMorale - 1);
      moraleUpdate = newMorale;

      publicContent += `<p class="reign-text-danger reign-text-bold reign-mb-0">FAILURE!</p><p class="reign-mt-small">Morale drops to ${newMorale}.</p>`;
      if (newMorale === 0) {
        publicContent += `<div class="reign-status-banner dead">THE HORDE ROUTS (Zero Morale)</div>`;
        newMag = 0;
      }
    }
  }

  const threatUpdates = { "system.magnitude.value": newMag };
  if (moraleUpdate !== null) threatUpdates["system.morale.value"] = moraleUpdate;
  await targetActor.update(threatUpdates);

  publicContent += `</div>`;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: publicContent });

  if (checkParent) {
    const parentId = targetActor.system.parentCompany;
    if (parentId) {
      const parentComp = game.actors.get(parentId);
      if (parentComp) {
        const safeParentName = foundry.utils.escapeHTML(parentComp.name);
        let gmNotice = `<p><strong>Command Link:</strong> This horde belongs to <strong>${safeParentName}</strong>. Their loss of ${magDmg} Magnitude should reduce the company's Temporary <em>Might</em> or <em>Influence</em>.</p>`;
        if (newMag === 0) gmNotice += `<p class="reign-text-danger reign-text-bold">Rout! The complete destruction of this unit warrants an immediate Company-level penalty.</p>`;

        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
          content: `<div class="reign-chat-card"><h3 class="reign-text-danger">Command Link Alert</h3>${gmNotice}</div>`,
          whisper: ChatMessage.getWhisperRecipients("GM")
        });
      }
    }
  }

  if (newMag === 0) ui.notifications.warn(`The ${safeTargetName} has been completely routed or destroyed!`);
}

/**
 * Calculates the total Armor Rating (AR) provided by equipped shields for a specific location.
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
 */
function buildDamageSummaryLine(locKey, finalShock, finalKilling, shockSoaked, killingSoaked, convertedShock, totalCoverAr, overflowKilling) {
  const locName = getHitLocationLabel(locKey).split(" (")[0];
  let summaryText = `<strong>${locName}:</strong> `;

  if (finalKilling > 0) summaryText += `<span class="reign-text-danger">${finalKilling} Kill</span> `;
  if (finalShock > 0) summaryText += `<span>${finalShock} Shock</span> `;

  if (convertedShock > 0) {
    summaryText += ` <span class="reign-text-warning reign-text-small">(${convertedShock} Shock → Killing)</span> `;
  }

  if (shockSoaked > 0 || killingSoaked > 0) {
    const shieldNote = totalCoverAr > 0 ? ` (incl. ${totalCoverAr} Shield AR)` : "";
    summaryText += `<span class="reign-text-muted reign-text-small">(Armor${shieldNote} stopped ${shockSoaked}S/${killingSoaked}K)</span>`;
  }

  if (overflowKilling > 0 && locKey !== "torso" && locKey !== "head") {
    summaryText += `<br><span class="reign-text-danger reign-text-small">(+${overflowKilling} Killing overflow to Torso)</span>`;
  }

  return summaryText;
}

/**
 * Generates an HTML banner alert based on the target's new health status.
 */
function getStatusAlertHtml(targetActor, localHealth) {
    const em = targetActor.system.effectiveMax;
    const headMax = em.head || 4;
    const torsoMax = em.torso || 10;
    const armLMax = em.armL || 5;
    const armRMax = em.armR || 5;
    const legLMax = em.legL || 5;
    const legRMax = em.legR || 5;
    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    if (localHealth.head.killing >= headMax) {
      return `<div class="reign-status-banner dead">☠ ${safeTargetName} IS DEAD (Head destroyed)</div>`;
    } else if (localHealth.torso.killing >= torsoMax) {
      return `<div class="reign-status-banner dead">☠ ${safeTargetName} IS DEAD (Torso destroyed)</div>`;
    } else if (localHealth.head.shock + localHealth.head.killing >= headMax) {
      return `<div class="reign-status-banner unconscious">💫 ${safeTargetName} IS UNCONSCIOUS (Head full of Shock)</div>`;
    } else if (localHealth.torso.shock + localHealth.torso.killing >= torsoMax) {
      return `<div class="reign-status-banner dazed">⚡ ${safeTargetName} IS DAZED (−1d all actions)</div>`;
    } else {
      const isMaimed = (localHealth.armL.killing >= armLMax) ||
                       (localHealth.armR.killing >= armRMax) ||
                       (localHealth.legL.killing >= legLMax) ||
                       (localHealth.legR.killing >= legRMax);
      if (isMaimed) {
        return `<div class="reign-status-banner maimed">🩸 ${safeTargetName} IS MAIMED AND BLEEDING (Limb destroyed)</div>`;
      }
    }
    return "";
}

/**
 * Calculates and applies standard primary attack damage.
 * V14 UPDATE: Injects Advanced Combat Modifiers (Bonus Damage, Hit Shifting, Armor Bypass, Appended Maneuvers)
 */
export async function applyDamageToTarget(width, height, dmgString, ap = 0, isMassive = false, areaDice = 0, attackerActor = null, advancedMods = null) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");

  // Extract Attacker Modifiers
  let combatMods = advancedMods;
  if (!combatMods) {
      const attacker = attackerActor || canvas?.tokens?.controlled?.[0]?.actor || game.user?.character;
      combatMods = attacker?.system?.modifiers?.combat || {};
  }

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

  // Apply Active Effect Bonus Damage
  baseShock += (combatMods.bonusDamageShock || 0);
  baseKilling += (combatMods.bonusDamageKilling || 0);
  const ignoreAr = combatMods.ignoreArmorTarget || 0;

  if (baseShock <= 0 && baseKilling <= 0 && areaDice <= 0) {
      ui.notifications.info(`The attack evaluated to 0 damage. The attack has no physical effect.`);
      return;
  }

  if (isMassive && areaDice === 0) baseKilling += 1;

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor) continue;

    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    // THREAT / MINION DAMAGE LOGIC
    if (targetActor.type === "threat") {
      let magDmg = baseKilling > 0 ? baseKilling : Math.floor(baseShock / 2);
      if (magDmg < 1) {
        ui.notifications.info(`${safeTargetName} shrugged off the weak attack! (Shock damage must be 2+ to reduce Magnitude)`);
        continue;
      }
      await applyThreatDamageInternal(targetActor, magDmg, "Battlefield Attrition", { checkParent: true });
      continue;
    }

    if (targetActor.type !== "character") continue;

    // BASE CHARACTER DAMAGE LOGIC
    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let damageSummary = [];
    let tookDamage = false;

    // ACTIVE EFFECT: Hit Location Shifting & Forcing
    let effHeight = height;
    if (combatMods.shiftHitLocationUp) effHeight += combatMods.shiftHitLocationUp;
    
    let mainLocKey = getHitLocation(effHeight);
    if (combatMods.forceHitLocation > 0) {
        mainLocKey = getHitLocation(combatMods.forceHitLocation);
    }
    
    if (mainLocKey === "unknown" && areaDice === 0) continue;

    // AREA OF EFFECT WEAPONS
    if (areaDice > 0) {
      const splashRoll = new Roll(`${areaDice}d10`);
      await splashRoll.evaluate();
      const hitLocs = splashRoll.dice[0].results.map(r => getHitLocation(r.result));
      const locCounts = {};
      hitLocs.forEach(l => {
        if (l !== "unknown") locCounts[l] = (locCounts[l] || 0) + 1;
      });

      const orderedLocations = HIT_LOCATIONS;
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

        // ACTIVE EFFECT: Hit Redirection (e.g. Missing Limb)
        let redirectTarget = targetActor.system.modifiers?.hitRedirects?.[locKey];
        if (redirectTarget && redirectTarget.trim() !== "") {
            ui.notifications.info(`${safeTargetName}'s ${getHitLocationLabel(locKey)} is missing/redirected! Damage routed to ${redirectTarget.trim()}.`);
            locKey = redirectTarget.trim();
        }

        let finalKilling = isKillingWeapon ? hits : 0;
        let finalShock = isShockWeapon ? hits : 0;

        if (isMassive && locKey === primaryLoc && finalKilling > 0) finalKilling += 1;

        let loc = localHealth[locKey];
        const totalCoverAr = getProtectedShieldCoverAR(targetActor, locKey);
        
        // ACTIVE EFFECT: Armor Bypass
        const effectiveAr = Math.max(0, (targetActor.system.effectiveArmor?.[locKey] || 0) + totalCoverAr - ap - ignoreAr);
        
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
    } else {
      // STANDARD SINGLE TARGET WEAPONS
      
      // ACTIVE EFFECT: Hit Redirection (e.g. Missing Limb)
      let redirectTarget = targetActor.system.modifiers?.hitRedirects?.[mainLocKey];
      if (redirectTarget && redirectTarget.trim() !== "") {
          ui.notifications.info(`${safeTargetName}'s ${getHitLocationLabel(mainLocKey)} is missing/redirected! Damage routed to ${redirectTarget.trim()}.`);
          mainLocKey = redirectTarget.trim();
      }

      const loc = localHealth[mainLocKey];
      const totalCoverAr = getProtectedShieldCoverAR(targetActor, mainLocKey);
      
      // ACTIVE EFFECT: Armor Bypass
      const effectiveAr = Math.max(0, (targetActor.system.effectiveArmor?.[mainLocKey] || 0) + totalCoverAr - ap - ignoreAr);

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

    // Apply Math Back to Database
    await commitHealth(targetActor, localHealth);

    // Render Results
    let maneuverHtml = "";
    if (combatMods.appendManeuvers && combatMods.appendManeuvers.length > 0) {
        maneuverHtml = `<p class="reign-text-info reign-mt-small"><strong>Forced Effects:</strong> ${combatMods.appendManeuvers.map(m => m.toUpperCase()).join(", ")} applied to target!</p>`;
    }

    const statusAlert = getStatusAlertHtml(targetActor, localHealth);
    const summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br><br>") : "<em>All damage harmlessly deflected by armor!</em>";
    const chatContent = `<div class="reign-chat-card"><h3 class="reign-text-danger">Damage Applied</h3><p class="reign-mb-small"><strong>Target:</strong> ${safeTargetName} ${areaDice > 0 ? "<em>(Area Effect)</em>" : ""}</p><div class="reign-callout reign-callout-danger">${summaryHtml}</div>${maneuverHtml}${statusAlert}</div>`;

    await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });

    if (tookDamage) {
        await checkAndSpoilSet(targetActor);
    }
  }
}

/**
 * Calculates and applies scattered/waste damage or healing.
 * V14 UPDATE: Includes Hit Redirections and Armor Bypass
 */
export async function applyScatteredDamageToTarget(facesArrayStr, damageType, ap = 0, attackerActor = null, advancedMods = null) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token first!");

  let faces;
  try {
    faces = JSON.parse(facesArrayStr);
  } catch (err) {
    console.error("Reign | Failed to parse scattered damage faces:", err);
    return ui.notifications.error("Damage data is malformed. The chat card may be corrupted.");
  }
  if (!faces || faces.length === 0) return;

  const isKilling = String(damageType).toLowerCase() === "killing";
  const isShock = String(damageType).toLowerCase() === "shock";
  const isHealing = String(damageType).toLowerCase() === "healing";

  let combatMods = advancedMods;
  if (!combatMods) {
      const attacker = attackerActor || canvas?.tokens?.controlled?.[0]?.actor || game.user?.character;
      combatMods = attacker?.system?.modifiers?.combat || {};
  }
  const ignoreAr = combatMods.ignoreArmorTarget || 0;

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
      await applyThreatDamageInternal(targetActor, magDmg, "Scattered Attrition");
      continue;
    }

    if (targetActor.type !== "character") continue;

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let damageSummary = [];
    let tookDamage = false;

    const locCounts = {};
    for (let face of faces) {
      let locKey = getHitLocation(face);
      
      // ACTIVE EFFECT: Hit Redirection
      let redirectTarget = targetActor.system.modifiers?.hitRedirects?.[locKey];
      if (redirectTarget && redirectTarget.trim() !== "") {
          locKey = redirectTarget.trim();
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
              if (healedKilling > 0) healText += `<span class="reign-text-danger">Recovered ${healedKilling} Kill</span> `;
              if (healedShock > 0) healText += `<span class="reign-text-success">Recovered ${healedShock} Shock</span>`;
              damageSummary.push(healText);
          }
          continue;
      }

      let finalKilling = isKilling ? hits : 0;
      let finalShock = isShock ? hits : 0;

      let loc = localHealth[locKey];
      const totalCoverAr = getProtectedShieldCoverAR(targetActor, locKey);
      
      // ACTIVE EFFECT: Armor Bypass
      const effectiveAr = Math.max(0, (targetActor.system.effectiveArmor?.[locKey] || 0) + totalCoverAr - ap - ignoreAr);

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

    await commitHealth(targetActor, localHealth);

    if (isHealing) {
        const summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br>") : "<em>No damage required healing!</em>";
        const chatContent = `<div class="reign-chat-card"><h3 class="reign-text-success">Waste Healing Applied</h3><p class="reign-mb-small"><strong>Target:</strong> ${safeTargetName}</p><div class="reign-callout reign-callout-success">${summaryHtml}</div></div>`;
        await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });
    } else {
        const statusAlert = getStatusAlertHtml(targetActor, localHealth);
        const summaryHtml = damageSummary.length > 0 ? damageSummary.join("<br><br>") : "<em>All waste hits harmlessly deflected by armor!</em>";
        const chatContent = `<div class="reign-chat-card"><h3 class="reign-text-critical">Scattered Damage Applied</h3><p class="reign-mb-small"><strong>Target:</strong> ${safeTargetName} <em>(Waste Hits)</em></p><div class="reign-callout reign-callout-critical">${summaryHtml}</div>${statusAlert}</div>`;
        await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });
        
        if (tookDamage) {
            await checkAndSpoilSet(targetActor);
        }
    }
  }
}

/**
 * Applies targeted magical healing to a character's hit location.
 * V14 UPDATE: Includes Hit Redirections
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

    let mainLocKey = getHitLocation(height);
    if (mainLocKey === "unknown") continue;

    // ACTIVE EFFECT: Hit Redirection
    let redirectTarget = targetActor.system.modifiers?.hitRedirects?.[mainLocKey];
    if (redirectTarget && redirectTarget.trim() !== "") {
        mainLocKey = redirectTarget.trim();
    }

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
        await commitHealth(targetActor, localHealth);
        
        const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
        const locName = getHitLocationLabel(mainLocKey).split(" (")[0];
        
        let healHtml = `<div class="reign-chat-card"><h3 class="reign-text-success">Magical Healing Applied</h3><p class="reign-mb-small"><strong>Target:</strong> ${safeTargetName}</p><div class="reign-callout reign-callout-success"><strong>${locName}:</strong> `;
        if (healedKilling > 0) healHtml += `<span class="reign-text-danger">Recovered ${healedKilling} Kill</span> `;
        if (healedShock > 0) healHtml += `<span class="reign-text-success">Recovered ${healedShock} Shock</span>`;
        healHtml += `</div></div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: healHtml });
    } else {
        ui.notifications.info(`${targetActor.name}'s ${mainLocKey} is already fully healed.`);
    }
  }
}

/**
 * Applies RAW standard non-magical First Aid to a target character.
 * P3 FIX: Now requires a Knowledge + Healing roll.
 */
export async function applyFirstAidToTarget(width) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a token to treat!");

  // Ensure the user controlling the macro/button has an assigned actor
  const healer = canvas?.tokens?.controlled?.[0]?.actor || game.user?.character;
  if (!healer || healer.type !== "character") {
    return ui.notifications.warn("You must control a character token to perform First Aid.");
  }

  const content = `
    <div class="reign-dialog-form">
      <p class="reign-text-center reign-text-large">Select the hit location to treat.</p>
      <p class="reign-text-small reign-text-muted reign-text-center reign-mb-medium">Requires a Knowledge + Healing roll.<br>Converts <strong>1 Killing</strong> damage to Shock on success.</p>
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

  let locKey = await reignDialog(
      "Apply First Aid",
      content,
      (e, b, d) => d.element.querySelector('[name="locKey"]').value,
      { defaultLabel: "Attempt Treatment" }
  );

  if (!locKey) return;

  // Perform the Healing Roll
  const knowledge = parseInt(healer.system.attributes.knowledge?.value) || 0;
  const healingSkill = parseInt(healer.system.skills.healing?.value) || 0;
  const expert = healer.system.skills.healing?.expert ? 1 : 0;
  const master = healer.system.skills.healing?.master ? 1 : 0;

  let pool = knowledge + healingSkill;
  if (pool < 1 && expert === 0 && master === 0) {
      return ui.notifications.warn(`${healer.name} lacks the Knowledge or Healing skill to attempt First Aid.`);
  }

  // Cap pool at 10 for normal dice
  const normalDice = Math.min(10, pool);
  let rollStr = `${normalDice}d10`;
  
  // Handle Master/Expert dice natively if needed for chat, 
  // but for the raw mechanical check we can just evaluate the normal dice and inject the M/E.
  const r = new Roll(rollStr);
  await r.evaluate();
  let results = r.dice[0].results.map(d => d.result);

  if (master > 0) results.push(10); // Auto-assign MD to 10 for easiest success
  if (expert > 0) {
      // If they have an ED but no MD, we find a die to pair it with, or just default it to 10.
      if (results.length > 0) {
          results.push(results[0]); 
      } else {
          results.push(10);
      }
  }

  const parsed = parseORE(results);

  if (parsed.sets.length === 0) {
      await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: healer }),
          content: `<div class="reign-chat-card"><h3 class="reign-text-danger">First Aid Failed</h3><p>${healer.name} attempted First Aid but found no matches.</p></div>`
      });
      return;
  }

  // The roll succeeded! Apply the conversion.
  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor || targetActor.type !== "character") continue;

    // ACTIVE EFFECT: Hit Redirection
    let redirectTarget = targetActor.system.modifiers?.hitRedirects?.[locKey];
    if (redirectTarget && redirectTarget.trim() !== "") {
        locKey = redirectTarget.trim();
    }

    let localHealth = foundry.utils.deepClone(targetActor.system.health);
    let loc = localHealth[locKey];
    
    let converted = 0;
    if (loc.killing > 0) {
      loc.killing -= 1;
      loc.shock += 1;
      converted = 1;
    }

    if (converted > 0) {
        await commitHealth(targetActor, localHealth);
        
        const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
        const locName = getHitLocationLabel(locKey).split(" (")[0];
        const bestSet = parsed.sets[0];
        
        let chatHtml = `<div class="reign-chat-card"><h3 class="reign-text-info"><i class="fas fa-notes-medical"></i> First Aid Successful</h3>
            <p class="reign-mb-small"><strong>Healer:</strong> ${healer.name} (Rolled ${bestSet.text})<br><strong>Patient:</strong> ${safeTargetName}</p>
            <div class="reign-callout reign-callout-info"><strong>${locName}:</strong> Converted <strong>1 Killing</strong> damage to Shock.</div></div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: healer }), content: chatHtml });
    } else {
        ui.notifications.warn(`${targetActor.name} has no Killing damage on their ${locKey} to treat.`);
    }
  }
}

/**
 * P3 FIX: Tracks pre-combat Shock to ensure Post-Combat Recovery doesn't over-heal.
 */
Hooks.on("combatStart", async (combat, context) => {
    if (!game.user.isGM) return;
    
    // Snapshot the current Shock of all combatants
    const updates = [];
    for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (actor && actor.type === "character") {
            const h = actor.system.health;
            const snapshot = {
                head: h.head.shock,
                torso: h.torso.shock,
                armR: h.armR.shock,
                armL: h.armL.shock,
                legR: h.legR.shock,
                legL: h.legL.shock
            };
            updates.push({ _id: actor.id, "flags.reign.preCombatShock": snapshot });
        }
    }
    
    if (updates.length > 0) {
        await Actor.updateDocuments(updates);
    }
});

/**
 * P3 FIX: Cleaned up Post-Combat Recovery. 
 * Exported so `character-sheet.js` can call it directly, preventing duplicate logic.
 */
export async function performPostCombatRecovery(actor) {
    if (actor.type !== "character") return;
    
    const system = actor.system;
    const preCombatShock = actor.getFlag("reign", "preCombatShock") || {
        head: 0, torso: 0, armR: 0, armL: 0, legR: 0, legL: 0
    };
    
    const updates = {};
    let totalRecovered = 0;

    HIT_LOCATIONS.forEach(loc => {
        let currentShock = parseInt(system.health[loc].shock) || 0;
        let baselineShock = parseInt(preCombatShock[loc]) || 0;
        
        // Only heal the shock SUSTAINED in THIS fight
        let sustainedShock = Math.max(0, currentShock - baselineShock);
        
        if (sustainedShock > 0) {
            let amountToHeal = Math.ceil(sustainedShock / 2);
            let newShock = currentShock - amountToHeal; 
            totalRecovered += amountToHeal;
            updates[`system.health.${loc}.shock`] = newShock;
        }
    });

    if (totalRecovered > 0) {
        await actor.update(updates);
        // Clear the flag so it doesn't pollute the next fight
        await actor.unsetFlag("reign", "preCombatShock");
        await syncCharacterStatusEffects(actor);
        
        const safeName = foundry.utils.escapeHTML(actor.name);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Post-Combat Recovery</h3><p>Catching their breath, ${safeName} recovers <strong>${totalRecovered} Shock</strong> damage sustained during the battle.</p></div>`
        });
    } else {
        ui.notifications.info(`${actor.name} took no new Shock damage this fight to recover.`);
    }
}

/**
 * Checks a character's current health values and applies or removes condition ActiveEffects.
 */
export async function syncCharacterStatusEffects(actor) {
  if (actor.type !== "character") return;
  const health = actor.system.health;

  const em = actor.system.effectiveMax;
  const headMax = em?.head || 4;
  const torsoMax = em?.torso || 10;
  const armLMax = em?.armL || 5;
  const armRMax = em?.armR || 5;
  const legLMax = em?.legL || 5;
  const legRMax = em?.legR || 5;

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
      const statusObj = CONFIG.statusEffects.find ? CONFIG.statusEffects.find(e => e.id === statusId) : CONFIG.statusEffects[statusId];
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
 */
async function checkAndSpoilSet(targetActor) {
    if (!game.combat || !game.combat.started) return;

    const combatant = game.combat.combatants.find(c => c.actorId === targetActor.id);
    if (!combatant || combatant.initiative === null) return;

    const latestMsg = game.messages.contents.slice(-50).reverse().find(m => 
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
                <p class="reign-text-center reign-text-large reign-text-danger reign-text-bold">Concentration Broken!</p>
                <p class="reign-text-center">You took damage before your action resolved. Per RAW, you must lose 1 die from one of your available sets.</p>
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
        
        const spoilBanner = `<div class="reign-status-banner spoiled"><i class="fas fa-bolt"></i> CONCENTRATION BROKEN! Lost 1 die from height ${chosenHeight} due to damage.</div>`;
        const finalHtml = newHtml.replace('<div class="reign-chat-card">', `<div class="reign-chat-card">${spoilBanner}`);
        
        await latestMsg.update({
            content: finalHtml,
            "flags.reign.results": newResults
        });

        const newParsed = parseORE(newResults, reignFlags.rollFlags?.isMinion);
        let newInit = 0;
        if (newParsed.sets.length > 0) {
            const flags = reignFlags.rollFlags || {};
            const isDefense = flags.isDefense || /dodge|parry|counterspell/i.test(reignFlags.label);
            const range = reignFlags.itemData?.type === "weapon" ? (reignFlags.itemData.system.range || "0") : "0";
            newInit = calculateInitiative(newParsed.sets, isDefense, flags.isAttack, flags.isMinion, range);
        }
        
        await combatant.update({ initiative: newInit });
        ui.notifications.warn(`${targetActor.name}'s action was spoiled by the attack!`);
    }
}