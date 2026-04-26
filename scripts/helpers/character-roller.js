// scripts/helpers/character-roller.js

// Set to true locally to enable verbose roll diagnostics in the browser console.
// Never commit with this set to true.
const DEBUG_ROLLS = false;

const { renderTemplate } = foundry.applications.handlebars;
import { parseORE } from "./ore-engine.js";
import { postOREChat } from "./chat.js";
import { skillAttrMap } from "./config.js";
import { MANEUVERS, getManeuverOptions, resolveWidthTier } from "./maneuvers.js";

import { reignDialog } from "./dialog-util.js";

/**
 * Calculates final dice counts, special dice states, and cap limits for ORE rolls.
 * RAW FIDELITY: Enforces the strict 1 Special Die limit. Because special dice upgrade 
 * existing dice, any excess special selections simply remain as normal dice in the rawTotal.
 */
export function calculateOREPool(rawTotal, edFaceInput, mdCountInput, calledShotInput, basePenalty, multiActions, ignoreMultiPenalty = false) {
    let inputMd = parseInt(mdCountInput) || 0;
    let inputEd = edFaceInput > 0 ? 1 : 0;
    
    let actualMd = 0;
    let actualEd = 0;
    let downgradedSpecialDice = 0;

    // Reign RAW: Strictly cap special dice (Master OR Expert) at 1 per pool.
    if (inputMd > 0) {
        actualMd = 1;
        downgradedSpecialDice += (inputMd - 1); 
        if (inputEd > 0) {
            downgradedSpecialDice += inputEd; // ED is overridden if an MD is present
        }
    } else if (inputEd > 0) {
        actualEd = 1;
    }

    let actualCs = 0;
    let appliedCsPenalty = 0;
    let finalCalledShot = calledShotInput;
    let finalEdFace = actualEd > 0 ? edFaceInput : 0;

    if (finalCalledShot > 0) {
        if (actualMd > 0) {
            finalCalledShot = 0; // MD makes CS unnecessary
        } else if (actualEd > 0) {
            finalEdFace = finalCalledShot; // Force ED to the CS height
            // RAW: "If you have an ED you're always making a called shot with no penalty."
        } else {
            actualCs = 1; // Dedicate one normal die to be the CS die
            appliedCsPenalty = 1;
        }
    }

    // The normal dice count is simply the total pool minus the dice we just upgraded/allocated.
    let specialDiceCount = actualMd + actualEd + actualCs;
    let normalDiceCount = Math.max(0, rawTotal - specialDiceCount);

    let multiActionPenalty = (!ignoreMultiPenalty && multiActions > 1) ? (multiActions - 1) : 0;
    let totalPenalty = basePenalty + multiActionPenalty + appliedCsPenalty;

    let totalPoolBeforePenalty = normalDiceCount + specialDiceCount;
    let overflow = Math.max(0, totalPoolBeforePenalty - 10);
    
    // Penalties eat into overflow first
    let netPenalty = Math.max(0, totalPenalty - overflow);

    // Penalties eat special dice first (MD -> CS -> ED)
    if (netPenalty > 0 && actualMd > 0) { actualMd = 0; netPenalty--; }
    if (netPenalty > 0 && actualCs > 0) { actualCs = 0; finalCalledShot = 0; netPenalty--; }
    if (netPenalty > 0 && actualEd > 0) { actualEd = 0; finalEdFace = 0; netPenalty--; }
    
    // Then penalties eat normal dice
    if (netPenalty > 0) {
        let normalLoss = Math.min(normalDiceCount, netPenalty);
        normalDiceCount -= normalLoss;
        netPenalty -= normalLoss;
    }

    // Enforce hard cap of 10 dice total after penalties
    let survivingSpecial = actualMd + actualEd + actualCs;
    normalDiceCount = Math.min(normalDiceCount, 10 - survivingSpecial); 
    
    let diceToRoll = normalDiceCount + survivingSpecial;
    let wasCapped = totalPoolBeforePenalty > 10;

    return { 
        actualMd, actualEd, actualCs, finalCalledShot, finalEdFace, 
        normalDiceCount, diceToRoll, wasCapped, downgradedSpecialDice 
    };
}

export class CharacterRoller {
  static async rollCharacter(actor, dataset) {
    try {
        if (DEBUG_ROLLS) console.log("Reign Roller | Execution Started.", dataset);

        const { type, key, label } = dataset;
        const system = actor.system;

        const headMax = parseInt(system.effectiveMax?.head) || 4;
        const torsoMax = parseInt(system.effectiveMax?.torso) || 10;
        const headK = parseInt(system.health.head.killing) || 0;
        const headS = parseInt(system.health.head.shock) || 0;
        const torsoK = parseInt(system.health.torso.killing) || 0;
        const torsoS = parseInt(system.health.torso.shock) || 0;

        if (headK >= headMax || torsoK >= torsoMax) return ui.notifications.error("Character is dead and cannot act.");
        if (headS + headK >= headMax) return ui.notifications.warn("Character is unconscious and cannot act.");

        let itemRef = null;
        if (type === "item") itemRef = actor.items.get(key);

        // --- V14 ACTIVE EFFECTS EXTRACTION ---
        const modifiers = system.modifiers || {};
        const systemFlags = modifiers.systemFlags || {};
        const combatMods = modifiers.combat || {};
        const actionEconomy = modifiers.actionEconomy || {};

        if (systemFlags.cannotUseTwoHanded && type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.twoHanded) {
            return ui.notifications.error(`Cannot wield ${itemRef.name}. You cannot use two-handed weapons due to a missing limb or restriction.`);
        }

        let isCompletingCast = false;

        if (game.combat) {
            const combatant = game.combat.combatants.find(c => c.actorId === actor.id);
            if (combatant) {
                if (type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.slow > 0) {
                    const cooldownUntil = combatant.getFlag("reign", "slowCooldown") || 0;
                    if (game.combat.round <= cooldownUntil) return ui.notifications.warn(`${itemRef.name} is still being readied. Available on round ${cooldownUntil + 1}.`);
                }

                const activeCast = combatant.getFlag("reign", "activeCast");
                
                if (activeCast) {
                    if (game.combat.round < activeCast.round) {
                        return ui.notifications.warn(`${actor.name} is concentrating on ${activeCast.name} and cannot take other actions until Round ${activeCast.round}.`);
                    } else if (type === "item" && key === activeCast.itemId) {
                        await combatant.unsetFlag("reign", "activeCast");
                        isCompletingCast = true;
                    } else {
                        return ui.notifications.error(`You have ${activeCast.name} prepared. You must cast it before taking other actions!`);
                    }
                } else if (!isCompletingCast && type === "item" && itemRef?.type === "spell" && itemRef.system.castingTime > 0) {
                    const castCompleteRound = game.combat.round + itemRef.system.castingTime;
                    await combatant.setFlag("reign", "activeCast", { itemId: itemRef.id, name: itemRef.name, round: castCompleteRound });
                    
                    let chatHtml = `
                      <div class="reign-chat-card reign-card-magic">
                        <h3 class="reign-text-magic"><i class="fas fa-magic"></i> Casting Started</h3>
                        <p><strong>${actor.name}</strong> begins gathering power for <em>${itemRef.name}</em>.</p>
                        <p class="reign-text-small reign-text-muted">The spell requires total concentration and will be ready to release on <strong>Round ${castCompleteRound}</strong>.</p>
                      </div>`;
                    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: chatHtml });
                    return;
                }
            }
        }

        let baseValue = 0; let defaultAttr = "none"; let defaultSkill = "none";
        let hasExpert = false; let hasMaster = false;

        if (type === "attribute") {
            baseValue = 0; defaultAttr = key; 
        } else if (type === "skill") { 
            baseValue = parseInt(system.skills[key]?.value) || 0; 
            hasExpert = system.skills[key]?.expert; 
            hasMaster = system.skills[key]?.master; 
            defaultAttr = skillAttrMap[key] || "none"; 
        } else if (type === "customSkill") { 
            baseValue = parseInt(system.customSkills[key]?.value) || 0; 
            hasExpert = system.customSkills[key]?.expert; 
            hasMaster = system.customSkills[key]?.master; 
            defaultAttr = system.customSkills[key]?.attribute || "none"; 
        } else if (type === "esoterica") { 
            baseValue = parseInt(system.esoterica[key]) || 0; 
            hasExpert = system.esoterica.expert || false;
            hasMaster = system.esoterica.master || false;
            defaultAttr = "knowledge"; 
        } else if (type === "move") {
            const m = system.validCustomMoves ? system.validCustomMoves[key] : system.customMoves[key];
            if (!m) return ui.notifications.error("That custom move no longer exists.");
            let aVal = m.attrKey !== "none" ? (parseInt(system.attributes[m.attrKey]?.value) || 0) : 0;
            let sVal = 0;
            if (m.skillKey !== "none") {
                if (system.skills[m.skillKey]) { sVal = parseInt(system.skills[m.skillKey].value); hasExpert = system.skills[m.skillKey].expert; hasMaster = system.skills[m.skillKey].master; }
                else if (system.customSkills[m.skillKey]) { sVal = parseInt(system.customSkills[m.skillKey].value); hasExpert = system.customSkills[m.skillKey].expert; hasMaster = system.customSkills[m.skillKey].master; }
            }
            baseValue = aVal + sVal + (parseInt(m.modifier) || 0);
        } else if (type === "item") { 
            const poolRaw = itemRef?.system?.pool || ""; 
            
            if (itemRef?.type === "spell") {
                const spellPoolName = poolRaw.trim().toLowerCase();
                const matchedStatic = Object.keys(system.skills || {}).find(k => k.toLowerCase() === spellPoolName);
                const matchedCustom = Object.entries(system.customSkills || {}).find(([id, cSk]) => (cSk?.customLabel || "").toLowerCase() === spellPoolName);
                
                if (matchedStatic) {
                    defaultSkill = `static_${matchedStatic}`; baseValue = 0; 
                    hasExpert = system.skills[matchedStatic].expert; hasMaster = system.skills[matchedStatic].master;
                } else if (matchedCustom) {
                    defaultSkill = `custom_${matchedCustom[0]}`; baseValue = 0;
                    hasExpert = matchedCustom[1].expert; hasMaster = matchedCustom[1].master;
                } else if (spellPoolName === "sorcery" || spellPoolName === "") {
                    defaultSkill = "esoterica_sorcery";
                    baseValue = 0; hasExpert = system.esoterica.expert || false; hasMaster = system.esoterica.master || false;
                } else {
                    baseValue = parseInt(poolRaw) || 0; 
                    defaultSkill = "none";
                }
                defaultAttr = itemRef.system.castingStat || "knowledge"; 
            } else {
                const matchedStatic = Object.keys(system.skills || {}).find(k => k.toLowerCase() === poolRaw.toLowerCase());
                const matchedCustom = Object.entries(system.customSkills || {}).find(([id, cSk]) => (cSk?.customLabel || "").toLowerCase() === poolRaw.toLowerCase());
                
                if (matchedStatic) {
                    defaultSkill = `static_${matchedStatic}`; baseValue = 0; 
                    hasExpert = system.skills[matchedStatic].expert; hasMaster = system.skills[matchedStatic].master;
                    defaultAttr = skillAttrMap[matchedStatic] || "coordination"; 
                } else if (matchedCustom) {
                    defaultSkill = `custom_${matchedCustom[0]}`; baseValue = 0;
                    hasExpert = matchedCustom[1].expert; hasMaster = matchedCustom[1].master;
                    defaultAttr = matchedCustom[1].attribute || "coordination";
                } else {
                    baseValue = parseInt(poolRaw) || 0; defaultAttr = "coordination";
                }
            }
        }

        if (type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.massive) {
            const bodyVal = parseInt(system.attributes.body?.value) || 0;
            if (bodyVal < 4) {
                return ui.notifications.error(`Cannot wield ${itemRef.name}. Massive weapons require a Body attribute of 4 or higher (Current: ${bodyVal}).`);
            }
        }

        let armorWeight = "none";
        const equippedArmor = actor.items.filter(i => i.type === "armor" && i.system.equipped);
        if (equippedArmor.some(a => a.system.armorWeight === "heavy")) armorWeight = "heavy";
        else if (equippedArmor.some(a => a.system.armorWeight === "medium")) armorWeight = "medium";
        else if (equippedArmor.some(a => a.system.armorWeight === "light")) armorWeight = "light";

        const equippedShields = actor.items.filter(i => i.type === "shield" && i.system.equipped);
        const hasShield = equippedShields.length > 0;
        const hasTower = equippedShields.some(s => s.system.shieldSize === "tower");

        // Resolve precise Skill Key for Active Effects matching
        let rawSkillKey = defaultSkill.replace("static_", "").replace("custom_", "").replace("esoterica_", "");
        if (!rawSkillKey || rawSkillKey === "none") rawSkillKey = key; 
        
        const skillMods = modifiers.skills?.[rawSkillKey] || {};
        // ignoreMultiPenaltySkills is a StringField — comma-separated skill names, e.g. "sorcery" or "sorcery,fight".
        // Defensive: handle legacy array values or unexpected types without crashing.
        const rawIgnoreSkills = actionEconomy.ignoreMultiPenaltySkills;
        const ignoreSkillsStr = Array.isArray(rawIgnoreSkills)
            ? rawIgnoreSkills.join(",")
            : String(rawIgnoreSkills || "");
        const ignoreSkillsList = ignoreSkillsStr.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        const ignoreMultiPenalty = ignoreSkillsList.includes(rawSkillKey);

        const showSkillSelect = (type === "item");
        const isCombatRoll = (type === "item" && itemRef?.type === "weapon") || (type === "skill" && key === "fight") || (type === "move") || (type === "customSkill" && system.customSkills[key]?.isCombat);
        const isDefenseRoll = rawSkillKey === "parry" || rawSkillKey === "dodge" || rawSkillKey === "counterspell";
        const isAttackRoll = isCombatRoll && !isDefenseRoll;

        let isDazed = actor.statuses.has("dazed");
        let isProne = actor.statuses.has("prone");
        let isBlind = actor.statuses.has("blind");

        if (isProne && rawSkillKey === "dodge") {
            return ui.notifications.error("You cannot Dodge while Prone. The action auto-fails.");
        }

        let encumbDiff = 0; let encumbPen = 0; let encumbImpossible = false;

        if (hasTower && (rawSkillKey === "stealth" || rawSkillKey === "climb")) {
            encumbImpossible = true;
        }

        const heavyPenaltySkills = ["climb", "run", "stealth", "endurance", "athletics"];
        const mediumPenaltySkills = ["stealth", "climb", "run", "endurance", "athletics"];
        
        const isHeavyPenalty = heavyPenaltySkills.includes(rawSkillKey);
        const isMediumPenalty = mediumPenaltySkills.includes(rawSkillKey);

        if (armorWeight === "heavy") {
            if (rawSkillKey === "stealth") encumbImpossible = true;
            if (isHeavyPenalty) {
                if (rawSkillKey === "climb" || rawSkillKey === "run") encumbPen = 2;
                if (rawSkillKey === "endurance" || rawSkillKey === "athletics") encumbDiff = 4;
            }
        } 
        
        if ((armorWeight === "medium" || hasShield) && isMediumPenalty) {
            encumbDiff = Math.max(encumbDiff, 3);
        }

        // Active Effect Override: Immunity to Fatigue & Armor Penalties
        if (systemFlags.ignoreFatiguePenalties) {
            encumbPen = 0;
            encumbDiff = 0;
            if (armorWeight === "heavy" && rawSkillKey === "stealth") encumbImpossible = false; 
        }

        if (encumbImpossible) return ui.notifications.error(`This action is impossible while ${hasTower ? "carrying a Tower Shield" : "wearing Heavy Armor"}. It auto-fails.`);

        // Aggregate Global & Skill-Specific Pool Modifiers
        const aePoolMod = (modifiers.globalPool || 0) + (skillMods.pool || 0);
        let effectBonus = aePoolMod > 0 ? aePoolMod : 0;
        let effectPenalty = aePoolMod < 0 ? Math.abs(aePoolMod) : 0;

        let autoPenalty = effectPenalty; 
        let finalDifficulty = 0;
        let penaltyNames = [];

        if (isDazed) penaltyNames.push("DAZED");

        if (isProne && isCombatRoll) {
            autoPenalty += 1;
            penaltyNames.push("PRONE (−1d)");
        }

        if (isBlind && isCombatRoll) {
            let isRanged = false;
            if (itemRef?.type === "weapon" && itemRef.system.range && !["touch", "melee", "close", ""].includes(itemRef.system.range.toLowerCase().trim())) isRanged = true;
            else if (rawSkillKey === "athletics" && isAttackRoll) isRanged = true;
            else if (["shoot", "bow", "archery", "firearms"].some(s => rawSkillKey.includes(s))) isRanged = true;

            if (isRanged) {
                autoPenalty += 2;
                penaltyNames.push("BLIND Ranged (−2d)");
            } else {
                finalDifficulty = Math.max(finalDifficulty, 4);
                penaltyNames.push("BLIND Melee (Diff 4)");
            }
        }

        if (effectPenalty > 0 && !isDazed) penaltyNames.push(`Effects (−${effectPenalty}d)`);
        else if (effectPenalty > 1 && isDazed) penaltyNames.push(`Effects (−${effectPenalty}d)`);

        if ((isHeavyPenalty || isMediumPenalty) && (encumbPen > 0 || encumbDiff > 0)) {
            autoPenalty += encumbPen; 
            finalDifficulty = Math.max(finalDifficulty, encumbDiff);
            
            let reason = "Armor";
            if (hasShield && encumbPen === 0) reason = "Shield Defense";
            else if (hasShield) reason = "Armor & Shield";
            
            penaltyNames.push(`${reason} (−${encumbPen}d, Diff ${encumbDiff})`);
        }

        let penaltyTitle = penaltyNames.join(" & ");

        let shieldBonus = 0;
        let shieldName = "";
        if (rawSkillKey === "parry" && hasShield) {
            const bestShield = equippedShields.reduce((prev, current) => {
                return (parseInt(prev.system.parryBonus) || 0) > (parseInt(current.system.parryBonus) || 0) ? prev : current;
            });
            shieldBonus = parseInt(bestShield.system.parryBonus) || 0;
            shieldName = bestShield.name;
        }

        let autoBonus = shieldBonus + effectBonus;

        // PACKAGE C Item 6: Read accumulated aim bonus from actor flags
        const aimBonus = (isAttackRoll && actor.getFlag("reign", "aimBonus")) || 0;
        if (aimBonus > 0) autoBonus += aimBonus;

        const aquaticSkills = ["athletics", "dodge", "endurance", "vigor", "stealth"];
        const showEnvContext = isCombatRoll || aquaticSkills.includes(rawSkillKey);

        let initialEdValue = hasExpert ? 10 : 0;
        let initialMdValue = hasMaster ? 1 : 0; 
        
        if (itemRef?.system?.qualities?.master || itemRef?.system?.qualities?.masterDie) {
            initialMdValue += 1;
        }

        let dialogTitle = `Roll ${label || "Action"}`;
        if (shieldBonus > 0) dialogTitle += ` (+${shieldBonus}d ${shieldName} Bonus)`;

        const attrOptions = { "none": "None", "body": "Body", "coordination": "Coordination", "sense": "Sense", "knowledge": "Knowledge", "command": "Command", "charm": "Charm" };
        
        let skillOptions = { "none": "None" };
        if (showSkillSelect) {
            Object.keys(system.skills || {}).sort().forEach(sk => { skillOptions[`static_${sk}`] = sk.toUpperCase(); });
            if (system.customSkills) Object.entries(system.customSkills).forEach(([cid, cSk]) => { skillOptions[`custom_${cid}`] = (cSk.customLabel || "Custom").toUpperCase(); });
            skillOptions["esoterica_sorcery"] = "SORCERY";
        }

        const calledShotOptions = { "0": "None", "10": "Head (10)", "9": "Torso High (9)", "8": "Torso Mid (8)", "7": "Torso Low (7)", "6": "Right Arm High (6)", "5": "Right Arm Low (5)", "4": "Left Arm High (4)", "3": "Left Arm Low (3)", "2": "Right Leg (2)", "1": "Left Leg (1)" };

        const templateData = {
            defaultAttr, attrOptions, showSkillSelect, defaultSkill, skillOptions, isCombatRoll, calledShotOptions,
            difficulty: finalDifficulty, showEnvContext, autoBonus, autoPenalty, penaltyTitle, initialEdValue, initialMdValue,
            maneuverOptions: isCombatRoll ? getManeuverOptions() : null
        };

        if (DEBUG_ROLLS) console.log("Reign Roller | Rendering HTML Template...");
        const content = await renderTemplate("systems/reign/templates/dialogs/roll-character.hbs", templateData);
        if (DEBUG_ROLLS) console.log("Reign Roller | Template rendered safely. Opening DialogV2...");

        const rollData = await reignDialog(
          dialogTitle,
          content,
          (e, b, d) => {
            const f = d.element.querySelector("form"); 
            return { 
              attr: f.querySelector('[name="attr"]')?.value || "none", skillKey: f.querySelector('[name="skillKey"]')?.value || "none",
              envContext: f.querySelector('[name="envContext"]')?.value || "none",
              calledShot: parseInt(f.querySelector('[name="calledShot"]')?.value) || 0, difficulty: parseInt(f.querySelector('[name="difficulty"]')?.value) || 0,
              multiActions: Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1),
              bonus: parseInt(f.querySelector('[name="bonus"]')?.value) || 0, penalty: parseInt(f.querySelector('[name="penalty"]')?.value) || 0, 
              passionBonus: (parseInt(f.querySelector('[name="pMiss"]')?.value) || 0) + (parseInt(f.querySelector('[name="pDuty"]')?.value) || 0) + (parseInt(f.querySelector('[name="pCrav"]')?.value) || 0),
              ed: parseInt(f.querySelector('[name="ed"]')?.value) || 0, 
              md: f.querySelector('[name="md"]')?.checked ? Math.max(1, initialMdValue) : 0,
              maneuver: f.querySelector('[name="maneuver"]')?.value || "none"
            }; 
          },
          {
            defaultLabel: "Roll ORE",
            render: (event, html) => {
              let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
              if (!element) return;
     
              const f = element.querySelector("form");
              const poolPreviewSpan = element.querySelector("#pool-value");
              const edInput = element.querySelector('[name="ed"]');
              let mdInput = element.querySelector('[name="md"]');
              const multiInput = f.querySelector('[name="multiActions"]');
              
              if (multiInput && !ignoreMultiPenalty) {
                  multiInput.title = "RAW: Taking multiple actions automatically drops 1 die from your pool per extra action. The roller handles this math automatically!";
                  const multiLabel = multiInput.previousElementSibling;
                  if (multiLabel) multiLabel.innerHTML += ' <i class="fas fa-info-circle reign-text-muted reign-cursor-help" title="RAW: -1d penalty per extra action. The roller calculates this automatically."></i>';
              } else if (multiInput && ignoreMultiPenalty) {
                  multiInput.title = "Active Effect: You are immune to multiple action penalties for this skill!";
                  const multiLabel = multiInput.previousElementSibling;
                  if (multiLabel) multiLabel.innerHTML += ' <i class="fas fa-shield-alt reign-text-success" title="Immune to multi-action penalties!"></i>';
              }

              if (mdInput && mdInput.type === "number") {
                  mdInput.type = "checkbox";
                  mdInput.checked = initialMdValue > 0;
                  mdInput.value = "1";
                  if (mdInput.previousElementSibling) mdInput.previousElementSibling.innerText = "Use Master Die?";
              }
              
              if (!edInput || !mdInput || !f) return;
     
              const updatePool = () => {
                const attrKey = f.querySelector('[name="attr"]')?.value || "none";
                const skillKey = f.querySelector('[name="skillKey"]')?.value || "none";
                const envContext = f.querySelector('[name="envContext"]')?.value || "none";
                const calledShot = parseInt(f.querySelector('[name="calledShot"]')?.value) || 0;
                const multiActions = Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1);
                const bonus = parseInt(f.querySelector('[name="bonus"]')?.value) || 0;
                let penalty = parseInt(f.querySelector('[name="penalty"]')?.value) || 0;
                const passionBonus = (parseInt(f.querySelector('[name="pMiss"]')?.value) || 0) + 
                                     (parseInt(f.querySelector('[name="pDuty"]')?.value) || 0) + 
                                     (parseInt(f.querySelector('[name="pCrav"]')?.value) || 0);
                
                const ed = parseInt(edInput.value) || 0;
                const md = mdInput.checked ? Math.max(1, initialMdValue) : 0;
     
                if (envContext === "swimming") {
                    if (armorWeight === "heavy") {
                        if (systemFlags.ignoreHeavyArmorSwim) {
                            penalty += 4;
                        } else {
                            poolPreviewSpan.innerHTML = `<span class="reign-text-danger">Impossible (Heavy Armor)</span>`;
                            return;
                        }
                    } else if (armorWeight === "medium") {
                        penalty += 2;
                    }
                }
     
                let attrVal = attrKey !== "none" ? (parseInt(system.attributes[attrKey]?.value) || 0) : 0;
                let itemSkillValue = 0;
                if (showSkillSelect && skillKey !== "none") {
                    if (skillKey.startsWith("static_")) itemSkillValue = parseInt(system.skills[skillKey.replace("static_", "")]?.value) || 0;
                    else if (skillKey.startsWith("custom_")) itemSkillValue = parseInt(system.customSkills[skillKey.replace("custom_", "")]?.value) || 0;
                    else if (skillKey === "esoterica_sorcery") itemSkillValue = parseInt(system.esoterica.sorcery) || 0;
                }
     
                let rawTotal = baseValue + attrVal + itemSkillValue + bonus + passionBonus;
     
                const poolMath = calculateOREPool(rawTotal, ed, md, calledShot, penalty, multiActions, ignoreMultiPenalty);
                
                if (poolMath.diceToRoll < 1) {
                    poolPreviewSpan.innerHTML = `<span class="reign-text-danger">Action Fails (Pool < 1)</span>`;
                } else if ((poolMath.actualMd + poolMath.actualEd + poolMath.actualCs) > poolMath.diceToRoll) {
                    poolPreviewSpan.innerHTML = `<span class="reign-text-danger">Too many Special Dice</span>`;
                } else {
                    let displayStr = `${poolMath.normalDiceCount}d10`;
                    if (poolMath.actualEd > 0) displayStr += ` <span class="reign-text-info">+ 1 ED (${poolMath.finalEdFace})</span>`;
                    if (poolMath.actualMd > 0) displayStr += ` <span class="reign-text-magic">+ 1 MD</span>`;
                    if (poolMath.actualCs > 0) displayStr += ` <span class="reign-text-danger">+ Called Shot (${poolMath.finalCalledShot})</span>`;
                    if (poolMath.wasCapped) displayStr += ` <span class="reign-text-small reign-text-muted">(Capped at 10)</span>`;
                    
                    poolPreviewSpan.innerHTML = displayStr;
                }
              };
     
              const enforceExclusivity = () => {
                updatePool();
              };

              // Ch7 MANEUVER WIRING: When the maneuver dropdown changes,
              // auto-apply pool modifications from the maneuver definition.
              const maneuverSelect = f.querySelector('[name="maneuver"]');
              const calledShotSelect = f.querySelector('[name="calledShot"]');
              const difficultyInput = f.querySelector('[name="difficulty"]');
              const penaltyInput = f.querySelector('[name="penalty"]');
              const multiActionsInput = f.querySelector('[name="multiActions"]');
              const bonusInput = f.querySelector('[name="bonus"]');

              if (maneuverSelect) {
                  // Store the user's original values so we can restore them when switching back to "none"
                  let userCalledShot = calledShotSelect?.value || "0";
                  let userDifficulty = difficultyInput?.value || "0";
                  let userPenalty = penaltyInput?.value || String(autoPenalty);
                  let userMultiActions = multiActionsInput?.value || "1";
                  let userBonus = bonusInput?.value || String(autoBonus);
                  let lastManeuver = "none";

                  maneuverSelect.addEventListener("change", () => {
                      const mId = maneuverSelect.value;

                      // Restore user values when leaving a maneuver
                      if (lastManeuver !== "none") {
                          if (calledShotSelect) calledShotSelect.value = userCalledShot;
                          if (difficultyInput) difficultyInput.value = userDifficulty;
                          if (penaltyInput) penaltyInput.value = userPenalty;
                          if (multiActionsInput) multiActionsInput.value = userMultiActions;
                          if (bonusInput) bonusInput.value = userBonus;
                      }

                      if (mId === "none") {
                          lastManeuver = "none";
                          updatePool();
                          return;
                      }

                      // Snapshot the current user values before we overwrite
                      if (lastManeuver === "none") {
                          userCalledShot = calledShotSelect?.value || "0";
                          userDifficulty = difficultyInput?.value || "0";
                          userPenalty = penaltyInput?.value || String(autoPenalty);
                          userMultiActions = multiActionsInput?.value || "1";
                          userBonus = bonusInput?.value || String(autoBonus);
                      }

                      const mDef = MANEUVERS[mId];
                      if (!mDef) { lastManeuver = mId; updatePool(); return; }

                      // Auto-set called shot
                      if (mDef.calledShot && calledShotSelect) {
                          if (mDef.calledShot === "head") calledShotSelect.value = "10";
                          else if (mDef.calledShot === "arm") calledShotSelect.value = "6"; // Default right arm high
                          else if (mDef.calledShot === "leg") calledShotSelect.value = "2"; // Default right leg
                      }

                      // Auto-set difficulty
                      if (mDef.difficulty > 0 && difficultyInput) {
                          difficultyInput.value = String(Math.max(parseInt(difficultyInput.value) || 0, mDef.difficulty));
                      }

                      // Auto-set penalty (additive with existing)
                      if (mDef.poolPenalty < 0 && penaltyInput) {
                          const currentBase = parseInt(userPenalty) || 0;
                          penaltyInput.value = String(currentBase + Math.abs(mDef.poolPenalty));
                      }

                      // Trip special: no called-shot penalty even though it has a called shot
                      // Iron Kiss special: -2d is its own penalty (already in poolPenalty), no standard CS penalty
                      // These are handled by calledShotPenalty: false in the definition.
                      // The pool math already handles the -1d for called shots; we need to OFFSET it
                      // for maneuvers where calledShotPenalty is false but a called shot is set.
                      if (mDef.calledShot && !mDef.calledShotPenalty && bonusInput) {
                          // Add +1d to bonus to cancel out the automatic called-shot penalty
                          const currentBonus = parseInt(bonusInput.value) || 0;
                          bonusInput.value = String(currentBonus + 1);
                      }

                      // Auto-set multiple actions if the maneuver requires it
                      if (mDef.isMultiAction && multiActionsInput) {
                          const current = parseInt(multiActionsInput.value) || 1;
                          if (current < 2) multiActionsInput.value = "2";
                      }

                      lastManeuver = mId;
                      updatePool();
                  });
              }
     
              edInput.addEventListener("input", enforceExclusivity); 
              mdInput.addEventListener("change", enforceExclusivity); 
     
              f.querySelectorAll("input, select").forEach(input => {
                  if (input !== mdInput) input.addEventListener("input", updatePool);
                  input.addEventListener("change", updatePool);
              });
     
              enforceExclusivity(); 
            }
          }
        );
        
        if (!rollData) return;

        if (DEBUG_ROLLS) console.log("Reign Roller | Dialog Submitted.", rollData);

        if (type === "item" && itemRef?.type === "spell" && rollData.multiActions > 1) {
            const rawIgnoreSpell = actionEconomy.ignoreMultiPenaltySkills;
            const ignoreSpellStr = Array.isArray(rawIgnoreSpell)
                ? rawIgnoreSpell.join(",")
                : String(rawIgnoreSpell || "");
            const ignoreSpellList = ignoreSpellStr.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
            const isSpellImmune = ignoreSpellList.includes("sorcery");
            if (!isSpellImmune) {
                ui.notifications.warn("Sorcery requires full concentration and cannot be part of a multiple action. Reverting to 1 action.");
                rollData.multiActions = 1;
            }
        }

        if (rollData.envContext === "swimming") {
            if (armorWeight === "heavy") {
                if (systemFlags.ignoreHeavyArmorSwim) {
                    rollData.penalty += 4;
                    ui.notifications.warn("Swimming in Heavy Armor applies a −4d penalty (Active Effect).");
                } else {
                    return ui.notifications.error("Swimming in Heavy Armor is impossible. You sink immediately.");
                }
            } else if (armorWeight === "medium") {
                rollData.penalty += 2;
                ui.notifications.warn("Swimming in Medium Armor applies a −2d penalty.");
            }
        }
        
        let finalAttrVal = rollData.attr !== "none" ? (parseInt(system.attributes[rollData.attr]?.value) || 0) : 0;
        let finalItemSkillValue = 0;
        if (showSkillSelect && rollData.skillKey !== "none") {
            if (rollData.skillKey.startsWith("static_")) finalItemSkillValue = parseInt(system.skills[rollData.skillKey.replace("static_", "")]?.value) || 0;
            else if (rollData.skillKey.startsWith("custom_")) finalItemSkillValue = parseInt(system.customSkills[rollData.skillKey.replace("custom_", "")]?.value) || 0;
            else if (rollData.skillKey === "esoterica_sorcery") finalItemSkillValue = parseInt(system.esoterica.sorcery) || 0;
        }

        let finalRawTotal = baseValue + finalAttrVal + finalItemSkillValue + rollData.bonus + rollData.passionBonus;
        const poolMath = calculateOREPool(finalRawTotal, rollData.ed, rollData.md, rollData.calledShot, rollData.penalty, rollData.multiActions, ignoreMultiPenalty);

        if (poolMath.downgradedSpecialDice > 0) {
            ui.notifications.info(`Reign RAW: Only 1 Special Die (MD or ED) is allowed per pool. ${poolMath.downgradedSpecialDice} excess special dice were downgraded to normal d10s.`);
        }

        if (rollData.calledShot > 0 && poolMath.actualMd > 0) {
            ui.notifications.warn("Called shots are unnecessary with a Master Die.");
        }

        if (poolMath.diceToRoll < 1) return ui.notifications.warn("Penalties reduced your dice pool below 1. Action fails.");

        let poolBreakdown = [];
        if (baseValue > 0 && finalAttrVal === 0 && finalItemSkillValue === 0) poolBreakdown.push({ label: "Base Pool", value: `+${baseValue}`, isPenalty: false });
        if (finalAttrVal > 0) poolBreakdown.push({ label: `Attribute (${rollData.attr.toUpperCase()})`, value: `+${finalAttrVal}`, isPenalty: false });
        if (finalItemSkillValue > 0) {
            let skLabel = rollData.skillKey !== "none" ? rollData.skillKey.replace(/(static_|custom_|esoterica_)/, "").toUpperCase() : "Skill";
            poolBreakdown.push({ label: `Skill (${skLabel})`, value: `+${finalItemSkillValue}`, isPenalty: false });
        }
        if (shieldBonus > 0) poolBreakdown.push({ label: `Shield (${shieldName})`, value: `+${shieldBonus}`, isPenalty: false });
        if (effectBonus > 0) poolBreakdown.push({ label: "Active Effects", value: `+${effectBonus}`, isPenalty: false });
        if (rollData.bonus > 0) poolBreakdown.push({ label: "Manual Bonus", value: `+${rollData.bonus}`, isPenalty: false });
        if (rollData.passionBonus > 0) poolBreakdown.push({ label: "Passion Bonus", value: `+${rollData.passionBonus}`, isPenalty: false });
        
        // PACKAGE C Item 6: Show aim bonus in breakdown
        if (aimBonus > 0) poolBreakdown.push({ label: `Aim Bonus (${aimBonus} round${aimBonus > 1 ? "s" : ""})`, value: `+${aimBonus}`, isPenalty: false });

        if (rollData.penalty > 0) poolBreakdown.push({ label: "Penalties & Conditions", value: `-${rollData.penalty}`, isPenalty: true });
        
        if (rollData.multiActions > 1) {
            if (ignoreMultiPenalty) poolBreakdown.push({ label: "Multiple Actions (Ignored by Effect)", value: `-0`, isPenalty: false });
            else poolBreakdown.push({ label: "Multiple Actions", value: `-${rollData.multiActions - 1}`, isPenalty: true });
        }
        
        if (rollData.calledShot > 0 && poolMath.actualMd === 0) poolBreakdown.push({ label: "Called Shot", value: `-1`, isPenalty: true });

        // Package Advanced DataModel Catch-Basin Modifiers for the Chat Engine
        const advancedMods = {
            minHeight: skillMods.minHeight || 0,
            bonusWidth: skillMods.bonusWidth || 0,
            bonusTiming: skillMods.bonusTiming || 0,
            squishLimit: skillMods.squishLimit || 1,
            ignoreArmorTarget: combatMods.ignoreArmorTarget || 0,
            forceHitLocation: combatMods.forceHitLocation || 0,
            shiftHitLocationUp: combatMods.shiftHitLocationUp || 0,
            combineGobbleDice: combatMods.combineGobbleDice || false,
            crossBlockActive: combatMods.crossBlockActive || false,
            appendManeuvers: combatMods.appendManeuvers || [],
            maneuver: null
        };

        // Ch7: Serialize the selected maneuver definition for the chat engine
        if (rollData.maneuver && rollData.maneuver !== "none" && MANEUVERS[rollData.maneuver]) {
            const mDef = MANEUVERS[rollData.maneuver];
            advancedMods.maneuver = {
                id: mDef.id,
                label: mDef.label,
                category: mDef.category,
                tier: mDef.tier,
                requiresKill: mDef.requiresKill,
                noDamage: mDef.noDamage,
                firstRoundOnly: mDef.firstRoundOnly,
                widthTiers: mDef.widthTiers,
                rulesText: mDef.rulesText,
                // Snapshot attacker stats needed for Display Kill / Threaten morale math
                attackerCommand: parseInt(system.attributes?.command?.value) || 0,
                attackerIntimidate: parseInt(system.skills?.intimidate?.value) || 0
            };

            // Add maneuver to pool breakdown for visibility
            const mLabel = game.i18n.localize(mDef.label);
            if (mDef.poolPenalty < 0) {
                poolBreakdown.push({ label: `Maneuver: ${mLabel}`, value: `${mDef.poolPenalty}`, isPenalty: true });
            } else {
                poolBreakdown.push({ label: `Maneuver: ${mLabel}`, value: `+0`, isPenalty: false });
            }
        }

        let results = [];
        let actualRoll = null;
        
        if (DEBUG_ROLLS) console.log("Reign Roller | Evaluating Final Dice...");
        if (poolMath.normalDiceCount > 0) {
          actualRoll = new Roll(`${poolMath.normalDiceCount}d10`);
          await actualRoll.evaluate();
          results = actualRoll.dice[0]?.results.map(r => r.result) || [];
        }
        
        if (poolMath.actualEd > 0) results.push(poolMath.finalEdFace);
        if (poolMath.actualCs > 0) results.push(poolMath.finalCalledShot);
        
        const finalizeCombatRoll = async (finalResults, mdCount, edCount, edVal, rollInstance) => {
            // PACKAGE C Item 6: Consume aim bonus on attack (it's been used)
            if (isAttackRoll && aimBonus > 0) {
                await actor.unsetFlag("reign", "aimBonus");
                await actor.unsetFlag("reign", "aimedThisRound");
            }

            if (rawSkillKey === "counterspell") {
                const parsed = parseORE(finalResults);
                if (parsed.sets.length > 0) {
                    const bestSet = parsed.sets[0]; 
                    let csHtml = `<div class="reign-chat-card reign-card-magic"><h3 class="reign-text-magic">Counterspell Declared</h3><p class="reign-text-large reign-mb-small">The caster anchors their magic with <strong>${bestSet.text}</strong>.</p><p class="reign-text-small reign-text-muted">This produces <strong>${bestSet.width} Gobble Dice</strong> at Height <strong>${bestSet.height}</strong>. Each can cancel one die from an incoming spell set of equal or lower Height.</p></div>`;
                    await postOREChat(actor, label || "Counterspell", poolMath.diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: poolMath.wasCapped, isAttack: false, isDefense: true, poolBreakdown: poolBreakdown, advancedMods: advancedMods }, rollInstance);
                    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: csHtml });
                } else {
                    await postOREChat(actor, label || "Counterspell", poolMath.diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: poolMath.wasCapped, isAttack: false, isDefense: true, poolBreakdown: poolBreakdown, advancedMods: advancedMods }, rollInstance);
                    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: `<div class="reign-chat-card reign-card-danger"><h3 class="reign-text-danger">Counterspell Fizzled</h3><p>The caster failed to anchor the spell. They are unprotected!</p></div>` });
                }
            } else {
                await postOREChat(actor, label || "Action", poolMath.diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: poolMath.wasCapped, isAttack: isAttackRoll, isDefense: isDefenseRoll, poolBreakdown: poolBreakdown, advancedMods: advancedMods }, rollInstance);
            }
            if (DEBUG_ROLLS) console.log("Reign Roller | Execution Complete.");
        };

        if (poolMath.actualMd > 0) {
          results.sort((a, b) => b - a); 
          let mdHtml = `<form class="reign-dialog-form">
            <p class="reign-text-large reign-mb-small reign-mt-0"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
            <p class="reign-text-small reign-text-muted reign-mb-medium">Assign a face value to your Master Dice.</p>
            <div class="dialog-grid dialog-grid-2">`;
          for(let i=0; i<poolMath.actualMd; i++) mdHtml += `<div class="form-group"><label>MD ${i+1} Face:</label><input type="number" id="mdFace${i}" value="10" min="1" max="10"/></div>`;
          mdHtml += `</div></form>`;

          const mdResult = await reignDialog(
            "Assign Master Dice",
            mdHtml,
            (e, b, d) => {
                const faces = [];
                for(let i=0; i<poolMath.actualMd; i++) faces.push(parseInt(d.element.querySelector(`#mdFace${i}`).value) || 10);
                return faces;
            },
            { defaultLabel: "Finalize Sets" }
          );

          if (mdResult) { results.push(...mdResult); await finalizeCombatRoll(results, poolMath.actualMd, poolMath.actualEd, poolMath.finalEdFace, actualRoll); }
        } else {
            await finalizeCombatRoll(results, 0, poolMath.actualEd, poolMath.finalEdFace, actualRoll);
        }
    } catch (err) {
        console.error("Reign Roller | CRITICAL EXCEPTION CAUGHT:", err);
        ui.notifications.error("The roll crashed silently. Check the F12 console to see exactly why.");
    }
  }


  // ==========================================
  // PACKAGE C ITEM 6: AIM MANEUVER
  // ==========================================

  /**
   * RAW Ch6 "Aim": Declares the character is spending this round aiming.
   *
   * Penalty: Spend a round without rolled actions, OR roll only Dodge/Parry at -1d.
   * Result:  +1d (or offset -1d) on next round's attack against the aimed target.
   *          Stackable to +2d over two consecutive rounds. No further benefit after 2.
   *
   * The bonus is consumed when the character makes an attack roll (handled in rollCharacter).
   * If the character doesn't aim or attack next round, the bonus is cleared at nextRound().
   *
   * @param {Actor} actor - The aiming character.
   */
  static async declareAim(actor) {
    if (!actor || actor.type !== "character") return;

    const currentBonus = actor.getFlag("reign", "aimBonus") || 0;

    if (currentBonus >= 2) {
      return ui.notifications.warn("Maximum aim bonus already reached (+2d from 2 rounds). Further aiming has no additional effect.");
    }

    const newBonus = currentBonus + 1;
    await actor.setFlag("reign", "aimBonus", newBonus);
    await actor.setFlag("reign", "aimedThisRound", true);

    const safeName = foundry.utils.escapeHTML(actor.name);
    const roundDesc = newBonus === 1
      ? "takes careful aim at their target"
      : "continues to sight in, refining their aim";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="reign-chat-card">
        <h3><i class="fas fa-crosshairs"></i> Aiming (Round ${newBonus}/2)</h3>
        <p>${safeName} ${roundDesc}.</p>
        <p class="reign-text-success reign-text-bold">+${newBonus}d bonus on next attack.</p>
        <p class="reign-text-muted reign-text-small">RAW: While aiming, the character may take no rolled actions, or roll only Dodge/Parry at −1d.</p>
      </div>`
    });
  }


  // ==========================================
  // PACKAGE C ITEM 4: SHIELD LOCATION ASSIGNMENT
  // ==========================================

  /**
   * RAW Ch6 "Shields": At the beginning of each combat round, a player declares
   * which hit location their shield protects.
   *
   * - Small shields protect one hit location at a time.
   * - Large shields always protect the carrying arm PLUS one other location
   *   (or both arm locations if no other is specified).
   * - Tower shields provide cover to arm + two additional locations when stationary.
   *
   * If not declared, the shield defaults to protecting the carrying arm.
   * The assignment is stored as actor flags and cleared each round by nextRound().
   *
   * @param {Actor} actor - The character with equipped shield(s).
   */
  static async assignShieldCoverage(actor) {
    if (!actor || actor.type !== "character") return;

    const shields = actor.items.filter(i => i.type === "shield" && i.system.equipped);
    if (shields.length === 0) return ui.notifications.info(`${actor.name} has no equipped shields.`);

    const locationLabels = {
      head: "Head (10)", torso: "Torso (7-9)", armR: "R. Arm (5-6)",
      armL: "L. Arm (3-4)", legR: "R. Leg (2)", legL: "L. Leg (1)"
    };
    const locationKeys = ["head", "torso", "armR", "armL", "legR", "legL"];

    const coverageResult = {};

    for (const shield of shields) {
      const sys = shield.system;
      const size = sys.shieldSize || "small";
      const shieldArm = sys.shieldArm || "armL";
      const safeName = foundry.utils.escapeHTML(shield.name);

      // Determine how many free choices the player gets
      let fixedLocations = [];
      let freeSlots = 1;

      if (size === "large") {
        // Large shields always protect the shield arm + 1 choice
        fixedLocations = [shieldArm];
        freeSlots = 1;
      } else if (size === "tower") {
        // Tower shields protect the arm + 2 extra when stationary
        fixedLocations = [shieldArm];
        freeSlots = 2;
      } else {
        // Small shield: 1 choice (defaults to shield arm if not specified)
        freeSlots = 1;
      }

      const fixedLabels = fixedLocations.map(k => locationLabels[k]).join(", ");
      const availableKeys = locationKeys.filter(k => !fixedLocations.includes(k));

      let selectHtml = "";
      if (freeSlots === 1) {
        const options = availableKeys.map(k => `<option value="${k}">${locationLabels[k]}</option>`).join("");
        selectHtml = `<div class="form-group"><label>Protect location:</label><select name="shieldLoc0">${options}</select></div>`;
      } else {
        for (let i = 0; i < freeSlots; i++) {
          const options = availableKeys.map(k => `<option value="${k}">${locationLabels[k]}</option>`).join("");
          selectHtml += `<div class="form-group"><label>Location ${i + 1}:</label><select name="shieldLoc${i}">${options}</select></div>`;
        }
      }

      const content = `
        <form class="reign-dialog-form">
          <p class="reign-text-center reign-text-large"><strong>${safeName}</strong> (${size.charAt(0).toUpperCase() + size.slice(1)})</p>
          ${fixedLabels ? `<p class="reign-text-center reign-text-muted">Always protects: <strong>${fixedLabels}</strong></p>` : ""}
          <p class="reign-text-center reign-text-small reign-text-muted">Choose ${freeSlots === 1 ? "which additional location" : `${freeSlots} additional locations`} to protect this round:</p>
          ${selectHtml}
        </form>
      `;

      const result = await reignDialog(
        `Shield Coverage: ${shield.name}`,
        content,
        (e, b, d) => {
          const f = d.element.querySelector("form") || d.element;
          const chosen = [];
          for (let i = 0; i < freeSlots; i++) {
            const val = f.querySelector(`[name="shieldLoc${i}"]`)?.value;
            if (val) chosen.push(val);
          }
          return chosen;
        },
        { defaultLabel: "Assign Coverage" }
      );

      if (!result) continue;

      // Build the coverage map for this shield
      const coverage = {};
      for (const k of locationKeys) coverage[k] = false;
      for (const k of fixedLocations) coverage[k] = true;
      for (const k of result) coverage[k] = true;

      coverageResult[shield.id] = coverage;
    }

    // Store as actor flags (read by getProtectedShieldCoverAR in damage.js)
    if (!foundry.utils.isEmpty(coverageResult)) {
      await actor.setFlag("reign", "shieldCoverage", coverageResult);

      const safeName = foundry.utils.escapeHTML(actor.name);
      const summaryParts = [];
      for (const [shieldId, locs] of Object.entries(coverageResult)) {
        const shield = actor.items.get(shieldId);
        const protectedNames = Object.entries(locs)
          .filter(([, v]) => v)
          .map(([k]) => locationLabels[k]?.split(" (")[0] || k);
        summaryParts.push(`<strong>${shield?.name || "Shield"}:</strong> ${protectedNames.join(", ")}`);
      }

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="reign-chat-card">
          <h3><i class="fas fa-shield-alt"></i> Shield Coverage Set</h3>
          <p>${safeName} positions their shield${shields.length > 1 ? "s" : ""} for this round:</p>
          <div class="reign-callout">${summaryParts.join("<br>")}</div>
        </div>`
      });
    }
  }
}