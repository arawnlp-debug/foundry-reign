// scripts/combat/damage.js
const { DialogV2 } = foundry.applications.api;
import { computeLocationDamage, getHitLocation, getHitLocationLabel, parseORE, calculateInitiative, checkThreatElimination, calculateMoraleAttackRemoval, getCreatureHitLocation } from "../helpers/ore-engine.js";
import { generateOREChatHTML } from "../helpers/chat.js";
import { reignDialog, reignAlert, reignClose } from "../helpers/dialog-util.js";
import { HIT_LOCATIONS } from "../helpers/config.js";
import { resolveWidthTier } from "../helpers/maneuvers.js";

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


// ==========================================
// PACKAGE A: RAW THREAT BINARY ELIMINATION
// ==========================================

/**
 * Core function for removing fighters from a threat group and posting results.
 * Handles group destruction, status effects, parent company alerts, and chat output.
 *
 * @param {Actor} targetActor - The threat actor being affected.
 * @param {number} eliminatedCount - Number of fighters removed.
 * @param {string} headerText - Chat card header (e.g. "Fighter Eliminated").
 * @param {Object} [options={}]
 * @param {boolean} [options.isMoraleAttack=false] - Whether this removal was from a Morale Attack.
 * @param {number}  [options.moraleAttackValue=0] - The strength of the Morale Attack (for display).
 * @param {boolean} [options.checkParent=false] - Whether to whisper parent company alert to GM.
 * @param {string}  [options.attackDesc=""] - Optional description of the triggering action.
 * @returns {Promise<number>} The new group size after elimination.
 */
async function eliminateThreatFighters(targetActor, eliminatedCount, headerText, { isMoraleAttack = false, moraleAttackValue = 0, checkParent = false, attackDesc = "" } = {}) {
  const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
  const threatRating = targetActor.system.threatLevel || 1;
  const currentGroup = targetActor.system.magnitude.value;
  const maxGroup = targetActor.system.magnitude.max;
  const actualEliminated = Math.min(eliminatedCount, currentGroup);
  const newGroup = Math.max(0, currentGroup - actualEliminated);

  // Build chat content
  let chatContent = `<div class="reign-chat-card reign-card-danger"><h3 class="reign-text-danger">${headerText}</h3>`;

  if (attackDesc) {
    chatContent += `<p class="reign-text-small reign-text-muted">${attackDesc}</p>`;
  }

  if (isMoraleAttack) {
    chatContent += `<p>Morale Attack <strong>${moraleAttackValue}</strong> vs Threat <strong>${threatRating}</strong></p>`;
    chatContent += `<p><strong>${actualEliminated}</strong> fighter${actualEliminated !== 1 ? "s" : ""} ${actualEliminated !== 1 ? "flee" : "flees"} in terror!</p>`;
  } else {
    chatContent += `<p><strong>${actualEliminated}</strong> fighter${actualEliminated !== 1 ? "s" : ""} removed from combat!</p>`;
  }

  chatContent += `<p class="reign-text-bold">Group Strength: <strong>${newGroup}</strong> / ${maxGroup}</p>`;

  if (newGroup === 0) {
    chatContent += `<div class="reign-status-banner dead">☠ ${safeTargetName} HAS BEEN DESTROYED</div>`;
  }

  chatContent += `</div>`;

  // Apply updates
  const updates = { "system.magnitude.value": newGroup };
  await targetActor.update(updates);

  if (newGroup === 0) {
    await targetActor.toggleStatusEffect("dead", { active: true });
  }

  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: chatContent });

  // Parent company alert (GM whisper)
  if (checkParent) {
    const parentId = targetActor.system.parentCompany;
    if (parentId) {
      const parentComp = game.actors.get(parentId);
      if (parentComp) {
        const safeParentName = foundry.utils.escapeHTML(parentComp.name);
        let gmNotice = `<p><strong>Command Link:</strong> ${safeTargetName} belongs to <strong>${safeParentName}</strong>. They lost <strong>${actualEliminated}</strong> fighter${actualEliminated !== 1 ? "s" : ""} (${newGroup} remaining).</p>`;
        if (newGroup === 0) {
          gmNotice += `<p class="reign-text-danger reign-text-bold">Unit destroyed! This warrants an immediate Company-level penalty to Might or Influence.</p>`;
        }

        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: targetActor }),
          content: `<div class="reign-chat-card"><h3 class="reign-text-danger">Command Link Alert</h3>${gmNotice}</div>`,
          whisper: ChatMessage.getWhisperRecipients("GM")
        });
      }
    }
  }

  if (newGroup === 0) {
    ui.notifications.warn(`${safeTargetName} has been completely destroyed!`);
  }

  return newGroup;
}


/**
 * Calculates the total Armor Rating (AR) provided by equipped shields for a specific location.
 * PACKAGE C: Checks per-round shield coverage flags first (set during Declaration phase).
 * Falls back to the shield's static effectiveLocations if no round assignment exists.
 */
function getProtectedShieldCoverAR(actor, locKey) {
  if (!actor?.items) return 0;
  const equippedShields = actor.items.filter(i => i.type === "shield" && i.system.equipped);
  const roundCoverage = actor.getFlag("reign", "shieldCoverage") || {};

  return equippedShields.reduce((sum, shield) => {
    const sys = shield.system || {};
    const ar = Number(sys.coverAR) || 0;

    // PACKAGE C: Per-round assignment takes priority
    const roundAssignment = roundCoverage[shield.id];
    if (roundAssignment) {
      return sum + (roundAssignment[locKey] ? ar : 0);
    }

    // Fallback: static effectiveLocations from the item
    const isProtected = !!sys.effectiveLocations?.[locKey];
    return sum + (isProtected ? ar : 0);
  }, 0);
}

/**
 * ITEM 8: Checks if a hit location is protected by dive-for-cover.
 * When a character dives for cover via a successful Dodge, protected locations
 * are completely hidden and cannot be hit at all (not AR reduction — full immunity).
 * @param {Actor} actor - The target actor.
 * @param {string} locKey - The hit location key.
 * @returns {boolean} True if the location is protected by cover.
 */
function isLocationInCover(actor, locKey) {
  if (!actor) return false;
  const coverFlags = actor.getFlag("reign", "dodgeCover");
  if (!coverFlags) return false;
  return !!coverFlags[locKey];
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
 * PACKAGE A: Threat targets use RAW binary elimination instead of magnitude damage.
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

  // ==========================================
  // Ch7: MANEUVER DAMAGE MODIFICATIONS
  // Resolve Width tier and apply Charge bonus damage or Knockout conversion.
  // ==========================================
  let maneuverDiscardOverflow = false;
  const maneuverDef = combatMods.maneuver || null;
  
  if (maneuverDef?.widthTiers) {
      const tierResult = resolveWidthTier(maneuverDef, width);
      if (tierResult) {
          // CHARGE: Add bonus Shock/Killing from the Run/Ride tier
          if (tierResult.bonusShock && !tierResult.convertKillingToShock) {
              baseShock += tierResult.bonusShock;
          }
          if (tierResult.bonusKilling && !tierResult.convertKillingToShock) {
              baseKilling += tierResult.bonusKilling;
          }

          // KNOCKOUT: Convert all Killing damage to Shock, then add bonus Shock
          if (tierResult.convertKillingToShock) {
              baseShock += baseKilling;   // Move all Killing into Shock
              baseKilling = 0;            // Zero out Killing
              baseShock += (tierResult.bonusShock || 0);  // Add tier bonus Shock
          }

          // KNOCKOUT 4×+: Track overflow discard flag for the damage application below
          if (tierResult.discardOverflow) {
              maneuverDiscardOverflow = true;
          }
      }
  }

  if (baseShock <= 0 && baseKilling <= 0 && areaDice <= 0) {
      ui.notifications.info(`The attack evaluated to 0 damage. The attack has no physical effect.`);
      return;
  }

  if (isMassive && areaDice === 0) baseKilling += 1;

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor) continue;

    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);

    // ==========================================
    // G3.3: CREATURE MODE — Individual creature with wound boxes.
    // Routes before the mob elimination logic so creature-mode threats
    // use the full hit-location damage pipeline instead of binary removal.
    // ==========================================
    if (targetActor.type === "threat" && targetActor.system.creatureMode) {
      await applyCreatureDamage(targetActor, width, height, baseShock, baseKilling,
                                ap, isMassive, areaDice, advancedMods);
      continue;
    }

    // ==========================================
    // PACKAGE A: RAW THREAT / MINION DAMAGE LOGIC
    // Unworthy opponents use binary elimination.
    // No wound boxes, no hit locations, no armor.
    // ==========================================
    if (targetActor.type === "threat") {
      const threatRating = targetActor.system.threatLevel || 1;
      const currentGroup = targetActor.system.magnitude.value;

      if (currentGroup <= 0) {
        ui.notifications.info(`${safeTargetName} is already destroyed.`);
        continue;
      }

      // --- AREA ATTACKS vs THREATS ---
      // RAW Ch6: "Any Area Attack is resolved against groups as a Morale Attack."
      // The area value becomes the Morale Attack rating.
      // The direct hit ALSO eliminates one fighter via standard rules.
      if (areaDice > 0) {
        let totalRemoved = 0;
        let chatParts = [];

        // 1) Direct hit still eliminates one fighter (standard binary check)
        const directHit = checkThreatElimination(width, height, threatRating);
        if (directHit) {
          totalRemoved += 1;
          chatParts.push(`Direct hit (${width}×${height}) eliminates 1 fighter.`);
        } else {
          chatParts.push(`Direct hit (${width}×${height}) fails to penetrate Threat ${threatRating}.`);
        }

        // 2) Area effect becomes Morale Attack
        const remainingAfterDirect = currentGroup - totalRemoved;
        const moraleRemoved = calculateMoraleAttackRemoval(areaDice, threatRating, remainingAfterDirect);
        if (moraleRemoved > 0) {
          totalRemoved += moraleRemoved;
          chatParts.push(`Area ${areaDice} Morale Attack scares off ${moraleRemoved} more!`);
        } else if (threatRating >= areaDice) {
          chatParts.push(`Area ${areaDice} Morale Attack resisted (Threat ${threatRating} ≥ ${areaDice}).`);
        }

        if (totalRemoved > 0) {
          await eliminateThreatFighters(targetActor, totalRemoved, "Area Attack", {
            isMoraleAttack: moraleRemoved > 0,
            moraleAttackValue: areaDice,
            checkParent: true,
            attackDesc: chatParts.join("<br>")
          });
        } else {
          const chatContent = `<div class="reign-chat-card"><h3>Attack vs ${safeTargetName}</h3><p>${chatParts.join("<br>")}</p><p class="reign-text-muted">No fighters eliminated.</p></div>`;
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: chatContent });
        }

        // PACKAGE B: RAW Ch6 — "Every time a PC takes out a henchman, one die is
        // removed from a successful set." Spoil the minion pool when fighters fall.
        if (totalRemoved > 0) await checkAndSpoilSet(targetActor);

        continue;
      }

      // --- STANDARD ATTACKS vs THREATS ---
      // RAW Ch6 "Out of the Action": Hit must have Height or Width >= Threat to eliminate.
      const canEliminate = checkThreatElimination(width, height, threatRating);

      if (canEliminate) {
        await eliminateThreatFighters(targetActor, 1, "Fighter Eliminated", {
          checkParent: true,
          attackDesc: `Attack set ${width}×${height} vs Threat ${threatRating} — eliminated!`
        });
        // PACKAGE B: RAW Ch6 — Minion pool loses a die when a fighter falls.
        await checkAndSpoilSet(targetActor);
      } else {
        // Attack doesn't meet the threshold
        const chatContent = `<div class="reign-chat-card"><h3>Attack vs ${safeTargetName}</h3><p>Attack set <strong>${width}×${height}</strong> fails against Threat <strong>${threatRating}</strong>.</p><p class="reign-text-muted">The attack's Width (${width}) and Height (${height}) are both below the group's Threat rating. No effect.</p></div>`;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: chatContent });
      }

      continue;
    }

    if (targetActor.type !== "character") continue;

    // ==========================================
    // BASE CHARACTER DAMAGE LOGIC (unchanged)
    // ==========================================
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

        // ITEM 8: Cover blocks area hits to protected locations
        if (isLocationInCover(targetActor, locKey)) {
            const coveredLocName = getHitLocationLabel(locKey).split(" (")[0];
            damageSummary.push(`<strong>${coveredLocName}:</strong> <span class="reign-text-success">Blocked by cover!</span>`);
            continue;
        }

        let finalKilling = isKillingWeapon ? hits : 0;
        let finalShock = isShockWeapon ? hits : 0;

        if (isMassive && locKey === primaryLoc && finalKilling > 0) finalKilling += 1;

        let loc = localHealth[locKey];

        // RAW Ch6 / Ch1 p.10: "Armor does not protect against Area Attacks."
        // AP, shield cover AR, and ignoreAr are all zeroed — the rule is absolute.
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
      // STANDARD SINGLE TARGET WEAPONS
      
      // ACTIVE EFFECT: Hit Redirection (e.g. Missing Limb)
      let redirectTarget = targetActor.system.modifiers?.hitRedirects?.[mainLocKey];
      if (redirectTarget && redirectTarget.trim() !== "") {
          ui.notifications.info(`${safeTargetName}'s ${getHitLocationLabel(mainLocKey)} is missing/redirected! Damage routed to ${redirectTarget.trim()}.`);
          mainLocKey = redirectTarget.trim();
      }

      // ITEM 8: Cover blocks the hit entirely — the location is hidden behind an obstacle
      if (isLocationInCover(targetActor, mainLocKey)) {
          const coveredLocName = getHitLocationLabel(mainLocKey).split(" (")[0];
          damageSummary.push(`<strong>${coveredLocName}:</strong> <span class="reign-text-success">Blocked by cover!</span>`);
          // Skip all damage but still spoil a set (the attack "hit" the cover, not the person)
      } else {

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

      // Ch7 KNOCKOUT 4×+: When discardOverflow is active and hitting the head,
      // excess Shock is discarded instead of converting to Killing.
      // RAW: "once the head is filled with Shock, extra damage is discarded
      //        instead of being converted to Killing."
      if (maneuverDiscardOverflow && mainLocKey === "head") {
          const preKilling = loc.killing || 0;
          // Revert any Shock→Killing conversion: no new Killing from this hit
          result.newKilling = preKilling;
          result.overflowKilling = 0;
          result.convertedShock = 0;
          // Fill remaining head Shock boxes up to capacity, discard the rest
          const shockCapacity = Math.max(0, effectiveMax - preKilling);
          result.newShock = Math.min(shockCapacity, (loc.shock || 0) + finalShock);
      }

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
      } // End of cover-else block (Item 8)
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
    const setLabel = areaDice > 0 ? `Area ${areaDice}d` : `${width}×${height}`;
    const chatContent = `<div class="reign-chat-card"><h3 class="reign-text-danger">Damage Applied <span class="reign-text-small reign-text-muted">(${setLabel})</span></h3><p class="reign-mb-small"><strong>Target:</strong> ${safeTargetName} ${areaDice > 0 ? "<em>(Area Effect)</em>" : ""}</p><div class="reign-callout reign-callout-danger">${summaryHtml}</div>${maneuverHtml}${statusAlert}</div>`;

    await ChatMessage.create({ content: chatContent, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });

    // PACKAGE B: RAW Ch6 — "you lose a die even if you somehow take no damage.
    // Armor and magic may protect your person, but it doesn't protect your actions."
    // Any successful hit spoils a set, regardless of whether damage penetrated armor.
    await checkAndSpoilSet(targetActor);
  }
}

/**
 * Calculates and applies scattered/waste damage or healing.
 * V14 UPDATE: Includes Hit Redirections and Armor Bypass
 * PACKAGE A: Waste dice cannot eliminate unworthy opponents (no sets formed).
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

    // PACKAGE A: Waste dice cannot form sets, so they have no effect on unworthy opponents.
    // RAW Ch6: Only successful sets (matches) can eliminate minions.
    if (targetActor.type === "threat") {
      ui.notifications.info(`Waste dice have no effect on ${safeTargetName}. Only matched sets can eliminate unworthy opponents.`);
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


// ==========================================
// PACKAGE A: OFFENSIVE MORALE ATTACK (Exported)
// ==========================================

/**
 * RAW Ch6: Applies an offensive Morale Attack against all targeted threat actors.
 * Called from chat card buttons (Display Kill, Threaten) or directly by the GM.
 *
 * A number of unworthies equal to the Morale Attack value flee,
 * UNLESS the group's Threat >= the Morale Attack value (ties go to mooks).
 *
 * @param {number} moraleAttackValue - The strength of the Morale Attack (1-10).
 * @param {string} [sourceDesc="Morale Attack"] - Description of what produced the MA.
 * @returns {Promise<void>}
 */
export async function applyOffensiveMoraleAttack(moraleAttackValue, sourceDesc = "Morale Attack") {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a threat group to apply the Morale Attack!");

  const maValue = parseInt(moraleAttackValue) || 0;
  if (maValue < 1) return ui.notifications.warn("Morale Attack value must be at least 1.");

  for (let target of targets) {
    const targetActor = target.actor;
    if (!targetActor) continue;

    if (targetActor.type !== "threat") {
      ui.notifications.info(`${targetActor.name} is not an unworthy opponent group. Morale Attacks only affect threats.`);
      continue;
    }

    const threatRating = targetActor.system.threatLevel || 1;
    const currentGroup = targetActor.system.magnitude.value;

    if (currentGroup <= 0) {
      ui.notifications.info(`${targetActor.name} is already destroyed.`);
      continue;
    }

    const removed = calculateMoraleAttackRemoval(maValue, threatRating, currentGroup);

    if (removed > 0) {
      await eliminateThreatFighters(targetActor, removed, sourceDesc, {
        isMoraleAttack: true,
        moraleAttackValue: maValue,
        checkParent: true
      });
    } else {
      // Resisted — Threat >= Morale Attack value
      const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
      const chatContent = `<div class="reign-chat-card"><h3>${sourceDesc}</h3><p>Morale Attack <strong>${maValue}</strong> vs Threat <strong>${threatRating}</strong></p><p class="reign-text-success reign-text-bold">${safeTargetName} stands firm!</p><p class="reign-text-muted reign-text-small">Threat ≥ Morale Attack — the horde is unimpressed.</p></div>`;
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: targetActor }), content: chatContent });
    }
  }
}


// ==========================================
// HEALING FUNCTIONS (unchanged from original)
// ==========================================

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

    // ISSUE-012 — Healing priority: Killing healed before Shock.
    // RAW Ch8 healing spells do not specify priority. Killing-first is the conservative
    // interpretation (more dangerous damage cleared first). Reverse if RAW citation found.
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

  const healer = canvas?.tokens?.controlled?.[0]?.actor || game.user?.character;
  if (!healer || healer.type !== "character") {
    return ui.notifications.warn("You must control a character token to perform First Aid.");
  }

  const content = `
    <div class="reign-dialog-form">
      <p class="reign-text-center reign-text-large">Select the hit location to treat.</p>
      <p class="reign-text-small reign-text-muted reign-text-center reign-mb-medium">Converts <strong>1 Killing</strong> damage to Shock on success.</p>
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
      { defaultLabel: "Apply Treatment" }
  );

  if (!locKey) return;

  // When called from a chat card button, width > 0 from the pre-rolled set.
  // The roll already succeeded (the button is disabled on failures), so skip re-rolling.
  let setText;

  if (width > 0) {
    // Called from chat card — success already confirmed
    setText = `${width}× set`;
  } else {
    // Standalone call (macro API) — need to roll Knowledge + Healing
    const knowledge = parseInt(healer.system.attributes.knowledge?.value) || 0;
    const healingSkill = parseInt(healer.system.skills.healing?.value) || 0;
    const expert = healer.system.skills.healing?.expert ? 1 : 0;
    const master = healer.system.skills.healing?.master ? 1 : 0;

    let pool = knowledge + healingSkill;
    if (pool < 1 && expert === 0 && master === 0) {
        return ui.notifications.warn(`${healer.name} lacks the Knowledge or Healing skill to attempt First Aid.`);
    }

    // Expert Die: RAW — set to a chosen face BEFORE rolling the other dice
    let edFace = 0;
    if (expert > 0) {
        const edResult = await reignDialog(
          "Set Expert Die",
          `<form class="reign-dialog-form">
            <p class="reign-text-small reign-text-muted reign-mb-medium">Choose the Expert Die face <strong>before</strong> rolling.</p>
            <div class="form-group"><label>ED Face (1–10):</label><input type="number" id="faEdFace" value="10" min="1" max="10"/></div>
          </form>`,
          (e, b, d) => parseInt(d.element.querySelector("#faEdFace").value) || 10,
          { defaultLabel: "Confirm", width: 360 }
        );
        if (!edResult) return;
        edFace = edResult;
    }

    // Roll the normal dice (pool minus the ED slot if active)
    const normalDice = Math.min(10, pool) - (expert > 0 ? 1 : 0);
    const r = normalDice > 0 ? new Roll(`${normalDice}d10`) : null;
    if (r) await r.evaluate();
    let results = r ? r.dice[0].results.map(d => d.result) : [];

    // Append the pre-set ED
    if (expert > 0) results.push(edFace);

    // Master Die: RAW — set to a chosen face AFTER rolling
    if (master > 0) {
        const sortedDisplay = [...results].sort((a, b) => b - a).join(", ") || "(none)";
        const mdResult = await reignDialog(
          "Assign Master Die",
          `<form class="reign-dialog-form">
            <p class="reign-text-large reign-mb-small"><strong>Roll so far:</strong> ${sortedDisplay}</p>
            <p class="reign-text-small reign-text-muted reign-mb-medium">Assign the Master Die to form the best set.</p>
            <div class="form-group"><label>MD Face:</label><input type="number" id="faMdFace" value="10" min="1" max="10"/></div>
          </form>`,
          (e, b, d) => parseInt(d.element.querySelector("#faMdFace").value) || 10,
          { defaultLabel: "Confirm", width: 360 }
        );
        if (!mdResult) return;
        results.push(mdResult);
    }

    const parsed = parseORE(results);

    if (parsed.sets.length === 0) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: healer }),
            content: `<div class="reign-chat-card"><h3 class="reign-text-danger">First Aid Failed</h3><p>${healer.name} attempted First Aid but found no matches.</p></div>`
        });
        return;
    }

    setText = `Rolled ${parsed.sets[0].text}`;
  }

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
        
        let chatHtml = `<div class="reign-chat-card"><h3 class="reign-text-info"><i class="fas fa-notes-medical"></i> First Aid Successful</h3>
            <p class="reign-mb-small"><strong>Healer:</strong> ${healer.name} (${setText})<br><strong>Patient:</strong> ${safeTargetName}</p>
            <div class="reign-callout reign-callout-info"><strong>${locName}:</strong> Converted <strong>1 Killing</strong> damage to Shock.</div></div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: healer }), content: chatHtml });
    } else {
        ui.notifications.warn(`${targetActor.name} has no Killing damage on their ${locKey} to treat.`);
    }
  }
}


// ==========================================
// POST-COMBAT RECOVERY & STATUS EFFECTS (unchanged)
// ==========================================

/**
 * P3 FIX: Tracks pre-combat Shock to ensure Post-Combat Recovery doesn't over-heal.
 */
Hooks.on("combatStart", async (combat, context) => {
    if (!game.user.isGM) return;
    
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
    
    // RAW: Half the Shock taken during this fight disappears immediately when combat ends,
    // rounded up. "all" and "none" are GM house-rule variants.
    const recoveryMode = game.settings.get("reign", "postCombatRecovery") || "half";

    if (recoveryMode === "none") {
        ui.notifications.info(`${actor.name}: Post-combat recovery is disabled (house rule). All Shock damage persists.`);
        return;
    }

    const system = actor.system;
    const preCombatShock = actor.getFlag("reign", "preCombatShock") || {
        head: 0, torso: 0, armR: 0, armL: 0, legR: 0, legL: 0
    };
    
    const updates = {};
    let totalRecovered = 0;

    HIT_LOCATIONS.forEach(loc => {
        let currentShock = parseInt(system.health[loc].shock) || 0;
        let baselineShock = parseInt(preCombatShock[loc]) || 0;
        
        let sustainedShock = Math.max(0, currentShock - baselineShock);
        
        if (sustainedShock > 0) {
            let amountToHeal = 0;
            if (recoveryMode === "all") {
                amountToHeal = sustainedShock;
            } else {
                // "half" — recover half, rounded up (default)
                amountToHeal = Math.ceil(sustainedShock / 2);
            }

            let newShock = currentShock - amountToHeal; 
            totalRecovered += amountToHeal;
            updates[`system.health.${loc}.shock`] = newShock;
        }
    });

    if (totalRecovered > 0) {
        await actor.update(updates);
        await actor.unsetFlag("reign", "preCombatShock");
        await syncCharacterStatusEffects(actor);
        
        const safeName = foundry.utils.escapeHTML(actor.name);
        const modeLabel = recoveryMode === "all" ? "full (house rule)" : "half rounded up (RAW)";
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `<div class="reign-chat-card"><h3 class="reign-msg-success">Post-Combat Recovery</h3><p>Catching their breath, ${safeName} recovers <strong>${totalRecovered} Shock</strong> sustained during the battle (${modeLabel}).</p></div>`
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

    // ISSUE-025 FIX: Increased from 50 → 200 messages; also filter by combat round when stamped.
    const spoilCombatRound = game.combat?.round ?? -1;
    const latestMsg = game.messages.contents.slice(-200).reverse().find(m => 
        m.speaker?.actor === targetActor.id && 
        m.flags?.reign?.results !== undefined &&
        (m.flags.reign.combatRound === undefined || spoilCombatRound < 0 || m.flags.reign.combatRound === spoilCombatRound)
    );
    if (!latestMsg) return;

    const reignFlags = latestMsg.flags.reign;
    const parsed = parseORE(reignFlags.results, reignFlags.rollFlags?.isMinion);
    if (parsed.sets.length === 0) return;

    let newResults = [...reignFlags.results];
    
    const validSets = parsed.sets;
    let chosenHeight = validSets[0].height;

    if (validSets.length > 1) {
        // PACKAGE B: For minion/threat actors, auto-select the narrowest set
        // (most favorable for mooks — preserves their best sets).
        // The GM controls minions and shouldn't be prompted from the PC's client.
        if (targetActor.type === "threat") {
            chosenHeight = validSets[validSets.length - 1].height;
        } else {
            let setOptions = validSets.map(s => `<option value="${s.height}">${s.width}x${s.height}</option>`).join("");
            const content = `
                <form class="reign-dialog-form">
                    <p class="reign-text-center reign-text-large reign-text-danger reign-text-bold">Concentration Broken!</p>
                    <p class="reign-text-center">You were hit before your action resolved. Per RAW, you must lose 1 die from one of your available sets — even if armor absorbed all damage.</p>
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


// ==========================================
// C1: MANOEUVRE STATUS APPLICATION
// ==========================================

/**
 * Applies the status effect (or flag) associated with a Tier 1 manoeuvre outcome.
 * Called from the renderChatMessageHTML handler when the "Apply: <Manoeuvre>" button is clicked.
 *
 * @param {Object} opts
 * @param {string} opts.maneuverKey   - The manoeuvre ID (e.g. "pin", "slam").
 * @param {string} opts.applyStatus   - Status ID to toggle ON on the target (e.g. "pinned").
 * @param {string} opts.clearStatus   - Status ID to toggle OFF on the rolling actor (e.g. "prone" for Stand).
 * @param {string} opts.setFlag       - Flag name to set on the attacker combatant (e.g. "shoveBonusAgainst").
 * @param {string} opts.statusTarget  - "target" or "self".
 * @param {number} opts.slamShock     - Extra Shock from Slam (chat note only — applied manually).
 * @param {boolean} opts.slamMultiLoc - Whether the Slam shock hits multiple locations.
 * @param {string} opts.actorId       - The rolling actor's ID (from msg.speaker.actor).
 */
export async function applyManeuverStatus({ maneuverKey, applyStatus, clearStatus, setFlag, statusTarget, slamShock, slamMultiLoc, actorId }) {
  const selfActor = actorId ? game.actors.get(actorId) : null;
  const targets = [...game.user.targets];

  // ── Apply a status effect to the targeted token(s) ──────────────────────
  if (applyStatus) {
    if (targets.length === 0) {
      return ui.notifications.warn("Select a target token first before applying the manoeuvre effect.");
    }

    for (const target of targets) {
      if (target.actor) {
        await target.actor.toggleStatusEffect(applyStatus, { active: true });
      }
    }

    const targetNames = targets.map(t => t.name).join(", ");
    const maneuverLabel = game.i18n.localize(`REIGN.Maneuver${maneuverKey.charAt(0).toUpperCase() + maneuverKey.slice(1)}`) || maneuverKey;

    let extraNote = "";
    if (applyStatus === "pinned") {
      extraNote = `<p class="reign-text-small reign-text-muted"><i class="fas fa-info-circle"></i> Escape: Body + Fight or Coordination + Grapple vs. Difficulty equal to attacker's Body or Grapple (whichever is higher).</p>`;
    }
    if (slamShock > 0) {
      const locNote = slamMultiLoc ? "multiple locations" : "one location";
      extraNote += `<p class="reign-text-small reign-text-muted"><i class="fas fa-exclamation-triangle"></i> Also deals <strong>${slamShock} Shock</strong> to ${locNote} — apply manually or use the weapon damage button.</p>`;
    }

    await ChatMessage.create({
      speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
      content: `<div class="reign-chat-card reign-card-success">
        <h3 class="reign-msg-info"><i class="fas fa-magic"></i> ${maneuverLabel} — Effect Applied</h3>
        <p><strong>${targetNames}</strong> is now <strong>${applyStatus}</strong>.</p>
        ${extraNote}
      </div>`
    });
  }

  // ── Clear a status from the rolling actor (Stand: remove Prone from self) ──
  if (clearStatus) {
    if (!selfActor) {
      return ui.notifications.warn("Could not identify the rolling actor.");
    }
    await selfActor.toggleStatusEffect(clearStatus, { active: false });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: selfActor }),
      content: `<div class="reign-chat-card reign-card-success">
        <h3 class="reign-msg-success"><i class="fas fa-arrow-up"></i> Stand — Effect Applied</h3>
        <p><strong>${selfActor.name}</strong> stands up. <em>Prone</em> status cleared — Dodge eligibility restored.</p>
      </div>`
    });
  }

  // ── Set a per-round combatant flag (Shove: grant +1d on Trip/Slam vs. this target) ──
  if (setFlag === "shoveBonusAgainst") {
    if (targets.length === 0) {
      return ui.notifications.warn("Select a target token first before applying the Shove effect.");
    }
    if (targets.length > 1) {
      return ui.notifications.warn("Shove can only target one token at a time.");
    }

    const targetToken = targets[0];

    if (!game.combat) {
      return ui.notifications.warn("No active combat — Shove bonus flags require an active encounter.");
    }

    const attackerCombatant = game.combat.combatants.find(c => c.actorId === actorId);
    if (attackerCombatant) {
      await attackerCombatant.setFlag("reign", "shoveBonusAgainst", targetToken.id);
    }

    await ChatMessage.create({
      speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
      content: `<div class="reign-chat-card reign-card-success">
        <h3 class="reign-msg-info"><i class="fas fa-person-falling"></i> Shove — Effect Applied</h3>
        <p><strong>${targetToken.name}</strong> is pushed back.</p>
        <p class="reign-text-small reign-text-muted"><i class="fas fa-info-circle"></i> Attacker gains <strong>+1d</strong> on their next <em>Trip</em> or <em>Slam</em> against this target this round.</p>
      </div>`
    });
  }
}


// ==========================================
// C2: PER-ROUND HOLD MANOEUVRE FUNCTIONS
// ==========================================

/**
 * Height → readable location label (mirrors ore-engine mapping).
 */
const HEIGHT_TO_LABEL = {
  10: "Head", 9: "Torso (High)", 8: "Torso (Mid)", 7: "Torso (Low)",
  6: "Right Arm (High)", 5: "Right Arm (Low)", 4: "Left Arm (High)", 3: "Left Arm (Low)",
  2: "Right Leg", 1: "Left Leg"
};

// ── Strangle ──────────────────────────────────────────────────────────────────

/**
 * Applies Strangle Shock to the target's head.
 * Used for both the initial application and the continuation ("Maintain Strangle").
 * @param {Object} opts
 * @param {number} opts.shock    - Amount of Shock to deal.
 * @param {boolean} opts.isMaintain - True if this is a continuation click (no roll).
 * @param {string|null} opts.actorId - Rolling actor's ID (from msg.speaker.actor).
 */
export async function applyStrangleDamage({ shock, isMaintain = false, actorId = null }) {
  const targets = [...game.user.targets];
  if (targets.length === 0) return ui.notifications.warn("Select a target token first.");

  const selfActor = actorId ? game.actors.get(actorId) : null;
  const label = isMaintain ? "Strangle Maintained" : "Strangle Applied";
  const icon = isMaintain ? "fa-repeat" : "fa-hand-fist";

  // Height 10 = head. Width 1 + fixed Shock string keeps damage formula simple.
  await applyDamageToTarget(1, 10, `${shock} Shock`, 0, false, 0, selfActor, null);

  await ChatMessage.create({
    speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
    content: `<div class="reign-chat-card reign-card-success">
      <h3 class="reign-msg-info"><i class="fas ${icon}"></i> ${label}</h3>
      <p><strong>${shock} Shock</strong> applied to <strong>${targets.map(t => t.name).join(", ")}</strong>'s Head.</p>
      ${isMaintain ? "" : `<p class="reign-text-small reign-text-muted"><i class="fas fa-info-circle"></i> Hold the position — click <em>Maintain Strangle</em> next round to continue without rolling.</p>`}
    </div>`
  });
}

// ── Iron Kiss ─────────────────────────────────────────────────────────────────

/**
 * Stores the Iron Kiss setup in the attacker's combatant flag.
 * Reads weapon formula and AP from the source chat message flags.
 * @param {Object} opts
 * @param {number} opts.virtualWidth  - The guaranteed set Width for next round (2, 4, or 6).
 * @param {string|null} opts.actorId  - Rolling actor's ID.
 * @param {ChatMessage} opts.msg      - The source chat message (for weapon formula).
 */
export async function setupIronKiss({ virtualWidth, actorId, msg }) {
  if (!game.combat) return ui.notifications.warn("No active combat — Iron Kiss requires an active encounter.");

  const attackerCombatant = game.combat.combatants.find(c => c.actorId === actorId);
  if (!attackerCombatant) return ui.notifications.warn("Could not find your combatant in the active combat.");

  // Read weapon formula from the roll's itemData
  const itemData = msg?.flags?.reign?.rollFlags?.itemData;
  const weaponFormula = itemData?.system?.damageFormula || itemData?.system?.damage || "Width Killing";
  const ap = parseInt(itemData?.system?.qualities?.armorPiercing) || 0;

  await attackerCombatant.setFlag("reign", "ironKissSetup", { virtualWidth, weaponFormula, ap });

  const selfActor = actorId ? game.actors.get(actorId) : null;
  await ChatMessage.create({
    speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
    content: `<div class="reign-chat-card reign-card-success">
      <h3 class="reign-msg-info"><i class="fas fa-knife"></i> Iron Kiss — Set Up</h3>
      <p>Blade at the throat. A <strong>${virtualWidth}×10</strong> attack is ready to fire next round.</p>
      <p class="reign-text-small reign-text-muted"><i class="fas fa-info-circle"></i> Click <em>Execute Iron Kiss</em> next round — no roll required. The flag expires at round end if unused.</p>
    </div>`
  });
}

/**
 * Executes the stored Iron Kiss — fires the guaranteed attack without a roll.
 * Reads the setup flag from the attacker's combatant, then clears it.
 * @param {Object} opts
 * @param {string|null} opts.actorId - Rolling actor's ID.
 */
export async function executeIronKiss({ actorId }) {
  if (!game.combat) return ui.notifications.warn("No active combat.");

  const attackerCombatant = game.combat.combatants.find(c => c.actorId === actorId);
  const setup = attackerCombatant?.getFlag("reign", "ironKissSetup");

  if (!setup) {
    return ui.notifications.warn("No Iron Kiss setup found — either it was already used or the round has advanced.");
  }

  const targets = [...game.user.targets];
  if (targets.length === 0) return ui.notifications.warn("Select the target token first.");

  const { virtualWidth, weaponFormula, ap } = setup;
  const selfActor = actorId ? game.actors.get(actorId) : null;

  // Fire the guaranteed attack: virtualWidth × Height 10 (head)
  await applyDamageToTarget(virtualWidth, 10, weaponFormula, ap, false, 0, selfActor, null);

  // Consume the flag
  await attackerCombatant.unsetFlag("reign", "ironKissSetup");

  await ChatMessage.create({
    speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
    content: `<div class="reign-chat-card reign-card-success">
      <h3 class="reign-msg-danger"><i class="fas fa-bolt"></i> Iron Kiss — Executed</h3>
      <p>Guaranteed <strong>${virtualWidth}×10</strong> strike to Head fired against <strong>${targets.map(t => t.name).join(", ")}</strong>.</p>
      <p class="reign-text-small reign-text-muted">Formula: ${weaponFormula}${ap ? `, AP ${ap}` : ""}.</p>
    </div>`
  });
}

// ── Redirect ──────────────────────────────────────────────────────────────────

/**
 * Opens a dialog asking for the incoming attack's Width and damage formula,
 * then redirects the damage to the currently targeted token at the appropriate Width.
 * @param {Object} opts
 * @param {number} opts.widthMod    - Width modifier to apply to the incoming Width (-1 or 0).
 * @param {boolean} opts.redirectAny - Tier 4: can redirect even non-ruined attacks.
 * @param {string|null} opts.actorId - Rolling actor's ID.
 */
export async function applyRedirectDamage({ widthMod, redirectAny, actorId }) {
  const targets = [...game.user.targets];
  if (targets.length === 0) return ui.notifications.warn("Select the new target token to redirect the attack to.");

  const selfActor = actorId ? game.actors.get(actorId) : null;

  // Build location options for the height selector
  const heightOptions = Object.entries(HEIGHT_TO_LABEL)
    .sort((a, b) => b[0] - a[0])
    .map(([h, l]) => `<option value="${h}">${l} (${h})</option>`)
    .join("");

  const dialogContent = `
    <div class="reign-dialog-intro">Redirect Incoming Attack</div>
    <div class="reign-dialog-subtitle">Enter the attacker's original Width and damage details.</div>
    <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0;">
      <label><strong>Incoming Width:</strong>
        <input type="number" name="incomingWidth" min="1" max="10" value="2" style="width:60px;margin-left:8px;">
      </label>
      <label><strong>Damage Formula:</strong>
        <input type="text" name="dmgFormula" value="Width Shock" style="width:120px;margin-left:8px;" placeholder="e.g. Width Shock">
      </label>
      <label><strong>Hit Location (Height):</strong>
        <select name="hitHeight" style="margin-left:8px;">${heightOptions}</select>
      </label>
      <label><strong>AP:</strong>
        <input type="number" name="ap" min="0" max="5" value="0" style="width:50px;margin-left:8px;">
      </label>
      ${redirectAny ? `<p class="reign-text-small reign-text-muted"><i class="fas fa-star"></i> Tier 4: any attack can be redirected.</p>` : ""}
      ${widthMod < 0 ? `<p class="reign-text-small reign-text-muted"><i class="fas fa-info-circle"></i> Redirected at Width−1 (Tier 2).</p>` : ""}
    </div>`;

  const result = await reignDialog(
    "Redirect Attack",
    dialogContent,
    (e, b, d) => ({
      incomingWidth: parseInt(d.element.querySelector('[name="incomingWidth"]')?.value) || 2,
      dmgFormula:    d.element.querySelector('[name="dmgFormula"]')?.value || "Width Shock",
      hitHeight:     parseInt(d.element.querySelector('[name="hitHeight"]')?.value) || 8,
      ap:            parseInt(d.element.querySelector('[name="ap"]')?.value) || 0
    }),
    { defaultLabel: "Redirect", width: 380 }
  );

  if (!result) return;

  const incomingWidth = Math.max(1, result.incomingWidth);
  const redirectWidth = Math.max(1, incomingWidth + widthMod);
  const dmgFormula    = result.dmgFormula;
  const hitHeight     = result.hitHeight;
  const ap            = result.ap;

  await applyDamageToTarget(redirectWidth, hitHeight, dmgFormula, ap, false, 0, selfActor, null);

  await ChatMessage.create({
    speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
    content: `<div class="reign-chat-card reign-card-success">
      <h3 class="reign-msg-info"><i class="fas fa-rotate"></i> Redirect — Applied</h3>
      <p>Attack redirected to <strong>${targets.map(t => t.name).join(", ")}</strong> at <strong>${redirectWidth}×${hitHeight}</strong>${widthMod < 0 ? " (Width−1)" : ""}.</p>
      <p class="reign-text-small reign-text-muted">Formula: ${dmgFormula}${ap ? `, AP ${ap}` : ""}.</p>
    </div>`
  });
}

// ── Submission Hold ───────────────────────────────────────────────────────────

/**
 * Applies Submission Hold Shock to the held limb, or applies Wrench Free Killing to the target.
 * @param {Object} opts
 * @param {number} opts.shock       - Shock to apply (hold).
 * @param {number} opts.killing     - Killing to apply (wrench free). 0 if applying hold.
 * @param {number} opts.holdHeight  - Hit location height (from calledShot in roll).
 * @param {boolean} opts.isWrench   - True if the target is wrenching free (applies Killing).
 * @param {string|null} opts.actorId - Rolling actor's ID.
 */
export async function applySubmissionHold({ shock, killing, holdHeight, isWrench = false, actorId = null }) {
  const targets = [...game.user.targets];
  if (targets.length === 0) return ui.notifications.warn("Select the target token first.");

  if (!holdHeight || holdHeight < 1 || holdHeight > 5) {
    // Submission Hold needs a limb — heights 1-6 (arms/legs). Warn if head/torso selected.
    if (holdHeight >= 7) {
      return ui.notifications.warn("Submission Hold requires a called shot to a limb (arm or leg), not head or torso.");
    }
  }

  const locLabel = HEIGHT_TO_LABEL[holdHeight] || `Location ${holdHeight}`;
  const selfActor = actorId ? game.actors.get(actorId) : null;

  if (isWrench) {
    // Target wrenches free — self-inflicts Killing to break the hold
    await applyDamageToTarget(1, holdHeight, `${killing} Killing`, 0, false, 0, selfActor, null);
    await ChatMessage.create({
      speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
      content: `<div class="reign-chat-card reign-card-success">
        <h3 class="reign-msg-info"><i class="fas fa-person-running"></i> Wrench Free — Applied</h3>
        <p><strong>${targets.map(t => t.name).join(", ")}</strong> wrenches free — self-inflicts <strong>${killing} Killing</strong> to their <strong>${locLabel}</strong>.</p>
        <p class="reign-text-small reign-text-muted">The hold is broken.</p>
      </div>`
    });
  } else {
    // Attacker applies hold — deals Shock to target's held limb
    await applyDamageToTarget(1, holdHeight, `${shock} Shock`, 0, false, 0, selfActor, null);
    await ChatMessage.create({
      speaker: selfActor ? ChatMessage.getSpeaker({ actor: selfActor }) : undefined,
      content: `<div class="reign-chat-card reign-card-success">
        <h3 class="reign-msg-info"><i class="fas fa-link"></i> Submission Hold — Applied</h3>
        <p><strong>${shock} Shock</strong> applied to <strong>${targets.map(t => t.name).join(", ")}</strong>'s <strong>${locLabel}</strong>.</p>
        <p class="reign-text-small reign-text-muted"><i class="fas fa-info-circle"></i> Target chooses: stay held (auto-pinned next round) or wrench free (click <em>Wrench Free</em> — takes ${killing} Killing).</p>
      </div>`
    });
  }
}

// ==========================================
// G3.3 / G4: CREATURE DAMAGE PIPELINE
// ==========================================

/**
 * G3.3: Applies damage to a creature-mode threat actor using its custom location wound boxes.
 * Routes through computeLocationDamage (same as character damage) per location hit.
 *
 * Area attacks ignore armor (RAW Ch1 p.10).
 * Standard attacks apply the location's AR minus AP.
 */
async function applyCreatureDamage(targetActor, width, height, baseShock, baseKilling,
                                    ap, isMassive, areaDice, advancedMods) {
  const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
  const locs = foundry.utils.deepClone(targetActor.system.customLocations || []);

  if (locs.length === 0) {
    return ui.notifications.warn(`${safeTargetName} has no custom locations configured. Switch to mob mode or add locations.`);
  }

  const heightMap = targetActor.system.heightLocationMap || {};
  const damageSummary = [];
  let tookDamage = false;

  if (areaDice > 0) {
    // ── Area attack: roll areaDice, map each result to a creature location ──
    // RAW Ch1 p.10: area attacks ignore armor entirely.
    const splashRoll = new Roll(`${areaDice}d10`);
    await splashRoll.evaluate();
    const hitKeys = splashRoll.dice[0].results.flatMap(r => heightMap[r.result] || []);
    const locCounts = {};
    hitKeys.forEach(k => { locCounts[k] = (locCounts[k] || 0) + 1; });

    for (const [locKey, hits] of Object.entries(locCounts)) {
      const locIdx = locs.findIndex(l => l.key === locKey);
      if (locIdx === -1) continue;
      const loc = locs[locIdx];
      const result = computeLocationDamage(loc.shock, loc.killing, baseShock * hits, baseKilling * hits, loc.woundBoxes);
      loc.shock   = result.newShock;
      loc.killing = result.newKilling;
      tookDamage  = true;
      damageSummary.push(`<strong>${loc.name}:</strong> Area hit ×${hits} — ${baseShock * hits}S/${baseKilling * hits}K (no AR)`);
    }
  } else {
    // ── Standard hit: resolve height → location key(s) ──
    const candidates = getCreatureHitLocation(height, heightMap);
    if (candidates.length === 0) {
      return ui.notifications.warn(`Height ${height} does not map to any location on ${safeTargetName}. Check the creature's roll height configuration.`);
    }

    // Use the first matching location. When multiple keys share a height (e.g. Elephant)
    // the GM may redirect damage using the location's triage controls after the fact.
    const locKey = candidates[0];
    const locIdx = locs.findIndex(l => l.key === locKey);
    if (locIdx === -1) return ui.notifications.warn(`Location key "${locKey}" not found on ${safeTargetName}.`);

    const loc = locs[locIdx];
    const effectiveAr = Math.max(0, (loc.ar || 0) - (ap || 0));
    let finalShock   = Math.max(0, baseShock   - effectiveAr);
    let finalKilling = Math.max(0, baseKilling - effectiveAr);

    // RAW Ch6 p.114: Massive weapons +1 Killing (already added to baseKilling before
    // this branch in applyDamageToTarget, but isMassive passed through for area-only edge cases)
    if (isMassive && areaDice === 0) finalKilling += 1;

    const soakedShock   = Math.min(baseShock,   effectiveAr);
    const soakedKilling = Math.min(baseKilling,  effectiveAr);
    const result = computeLocationDamage(loc.shock, loc.killing, finalShock, finalKilling, loc.woundBoxes);
    loc.shock   = result.newShock;
    loc.killing = result.newKilling;
    tookDamage  = true;

    const arNote = effectiveAr > 0 ? ` (AR ${effectiveAr} soaked ${soakedShock}S/${soakedKilling}K)` : "";
    const ambiguousNote = candidates.length > 1
      ? ` <span class="reign-text-warning" title="Height ${height} maps to: ${candidates.join(', ')}">⚠ Overlapping heights — GM may redirect</span>`
      : "";
    damageSummary.push(`<strong>${loc.name}:</strong> ${finalShock}S/${finalKilling}K applied${arNote}${ambiguousNote}`);
  }

  if (!tookDamage) {
    return ui.notifications.info(`Damage dealt no effect to ${safeTargetName}.`);
  }

  await targetActor.update({ "system.customLocations": locs });
  await checkCreatureDefeated(targetActor, locs);

  // G4.5: Trigger venom if this creature has venomPotency and the attack was a bite (height-based)
  if (areaDice === 0 && (targetActor.system.creatureFlags?.venomPotency || 0) > 0) {
    // Only trigger on standard bite attacks — skip area attacks (the venom is in the bite)
    // The GM applies venom from the outgoing attack button, not the incoming damage button.
    // This flag is checked in the threat-roller outgoing attack path instead.
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `<div class="reign-chat-card">
      <h3 class="reign-text-danger"><i class="fas fa-paw"></i> Creature Damage — ${safeTargetName}</h3>
      <div class="reign-callout reign-callout-danger">${damageSummary.join("<br>")}</div>
    </div>`
  });
}

/**
 * G3.3: Checks whether a creature should be flagged as defeated.
 * A creature is defeated when ALL of its largest (primary) locations are fully filled with Killing damage.
 * Posts a death card and toggles the 'dead' status. This is a soft trigger — GMs may override.
 */
async function checkCreatureDefeated(actor, locs) {
  if (!locs || locs.length === 0) return;
  const primaryMax = Math.max(...locs.map(l => l.woundBoxes || 5));
  const primaryLocs = locs.filter(l => l.woundBoxes === primaryMax);
  const allPrimaryFull = primaryLocs.every(l => (l.killing || 0) >= (l.woundBoxes || 5));
  if (!allPrimaryFull) return;

  // Already marked dead — don't double-post
  if (actor.statuses?.has("dead")) return;

  await actor.toggleStatusEffect("dead", { active: true });
  const safeName = foundry.utils.escapeHTML(actor.name);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="reign-chat-card reign-card-critical">
      <h3>💀 ${safeName} is Defeated!</h3>
      <p>All primary locations (${primaryLocs.map(l => l.name).join(", ")}) are filled with Killing damage.</p>
    </div>`
  });
}

/**
 * G4.5: Rolls the creature's venom pool and posts a result card with resist buttons.
 * Called from the threat-sheet outgoing bite attack handler.
 *
 * @param {Actor} creatureActor - The snake/venomous creature rolling venom.
 * @param {Actor|null} targetActor - The bitten target (may be null if no token selected).
 */
export async function applyCreatureVenom(creatureActor, targetActor) {
  const potency = creatureActor.system.creatureFlags?.venomPotency || 0;
  if (potency < 1) return;

  const venomType = creatureActor.system.creatureFlags?.venomType || "Unknown Venom";
  const safeTarget = foundry.utils.escapeHTML(targetActor?.name || "Target");
  const safeVenom  = foundry.utils.escapeHTML(venomType);
  const targetId   = targetActor?.id || "";

  const roll = new Roll(`${potency}d10`);
  await roll.evaluate();
  const results = roll.dice[0].results.map(r => r.result);
  const parsed  = parseORE(results);
  const hasSet  = parsed.sets.length > 0;

  const diceDisplay = results.map(r => `<span class="reign-die reign-die-plain">${r}</span>`).join(" ");
  const resultText  = hasSet
    ? `<span class="reign-text-danger reign-text-bold">SET ${parsed.sets[0].width}×${parsed.sets[0].height} — VENOM TAKES HOLD</span>`
    : `<span class="reign-text-muted">No set — venom fails to take hold this time</span>`;

  const resistButtons = hasSet ? `
    <hr>
    <p class="reign-text-small reign-text-muted">
      <strong>Major Effect</strong> if neither resist roll succeeds.<br>
      <strong>Minor Effect</strong> if Body+Vigor OR Knowledge+Healing succeeds.
    </p>
    <div class="reign-action-buttons">
      <button class="reign-btn-primary venom-resist-btn" data-target-id="${targetId}" data-resist-type="vigor">
        <i class="fas fa-fist-raised"></i> Roll Body + Vigor (Target Resists)
      </button>
      <button class="reign-btn-primary venom-resist-btn" data-target-id="${targetId}" data-resist-type="healing">
        <i class="fas fa-briefcase-medical"></i> Roll Knowledge + Healing (Healer Aids)
      </button>
    </div>` : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: creatureActor }),
    content: `<div class="reign-chat-card reign-card-danger">
      <h3>☠ ${safeVenom} (Potency ${potency})</h3>
      <p><strong>Target:</strong> ${safeTarget}</p>
      <div class="dice-tray wrap">${diceDisplay}</div>
      <p>${resultText}</p>
      ${resistButtons}
    </div>`
  });
}