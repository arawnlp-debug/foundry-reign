// scripts/helpers/character-roller.js
const { renderTemplate } = foundry.applications.handlebars;
import { parseORE } from "./ore-engine.js";
import { postOREChat } from "./chat.js";
import { skillAttrMap } from "./config.js";

import { reignDialog } from "./dialog-util.js";

/**
 * Calculates final dice counts, special dice states, and cap limits for ORE rolls.
 */
export function calculateOREPool(rawTotal, edFaceInput, mdCountInput, calledShotInput, basePenalty, multiActions) {
    let actualMd = parseInt(mdCountInput) || 0;
    
    // AUDIT FIX: Reign Rules strictly cap Master Dice to 1 per pool.
    if (actualMd > 1) {
        actualMd = 1;
    }
    
    let actualEd = edFaceInput > 0 ? 1 : 0;
    let actualCs = 0;
    let appliedCsPenalty = 0;
    let finalCalledShot = calledShotInput;
    let finalEdFace = edFaceInput;

    if (finalCalledShot > 0) {
        if (actualMd > 0) {
            finalCalledShot = 0; 
        } else if (actualEd > 0) {
            finalEdFace = finalCalledShot; 
            appliedCsPenalty = 1;
        } else {
            actualCs = 1;
            appliedCsPenalty = 1;
        }
    }

    let specialDiceCount = actualMd + actualEd + actualCs;
    let normalDiceCount = Math.max(0, rawTotal - specialDiceCount);

    let multiActionPenalty = multiActions > 1 ? (multiActions - 1) : 0;
    let totalPenalty = basePenalty + multiActionPenalty + appliedCsPenalty;

    let totalPoolBeforePenalty = normalDiceCount + specialDiceCount;
    let overflow = Math.max(0, totalPoolBeforePenalty - 10);
    
    let netPenalty = Math.max(0, totalPenalty - overflow);

    if (netPenalty > 0 && actualMd > 0) { actualMd = 0; netPenalty--; }
    if (netPenalty > 0 && actualCs > 0) { actualCs = 0; finalCalledShot = 0; netPenalty--; }
    if (netPenalty > 0 && actualEd > 0) { actualEd = 0; finalEdFace = 0; netPenalty--; }
    
    if (netPenalty > 0) {
        let normalLoss = Math.min(normalDiceCount, netPenalty);
        normalDiceCount -= normalLoss;
        netPenalty -= normalLoss;
    }

    let survivingSpecial = actualMd + actualEd + actualCs;
    normalDiceCount = Math.min(normalDiceCount, 10 - survivingSpecial); 
    let diceToRoll = normalDiceCount + survivingSpecial;
    let wasCapped = totalPoolBeforePenalty > 10;

    return {
        actualMd,
        actualEd,
        actualCs,
        finalCalledShot,
        finalEdFace,
        normalDiceCount,
        diceToRoll,
        wasCapped
    };
}

export class CharacterRoller {
  static async rollCharacter(actor, dataset) {
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
                  <div class="reign-chat-card" style="border-color: #4a148c;">
                    <h3 style="color: #4a148c;"><i class="fas fa-magic"></i> Casting Started</h3>
                    <p><strong>${actor.name}</strong> begins gathering power for <em>${itemRef.name}</em>.</p>
                    <p style="font-size: 0.9em; color: #555;">The spell requires total concentration and will be ready to release on <strong>Round ${castCompleteRound}</strong>.</p>
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

    let rawSkillKey = defaultSkill.replace("static_", "").replace("custom_", "").replace("esoterica_", "");
    if (!rawSkillKey || rawSkillKey === "none") rawSkillKey = key; 

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

    if (encumbImpossible) return ui.notifications.error(`This action is impossible while ${hasTower ? "carrying a Tower Shield" : "wearing Heavy Armor"}. It auto-fails.`);

    const aePoolMod = parseInt(system.modifiers?.pool) || 0;
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
    const aquaticSkills = ["athletics", "dodge", "endurance", "vigor", "stealth"];
    const showEnvContext = isCombatRoll || aquaticSkills.includes(rawSkillKey);

    let initialEdValue = hasExpert ? 10 : 0;
    let initialMdValue = hasMaster ? 1 : 0; 
    
    // Account for external items granting an MD to the pool
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
        defaultAttr, attrOptions,
        showSkillSelect, defaultSkill, skillOptions,
        isCombatRoll, calledShotOptions,
        difficulty: finalDifficulty,
        showEnvContext, autoBonus, autoPenalty, penaltyTitle,
        initialEdValue, initialMdValue
    };

    const content = await renderTemplate("systems/reign/templates/dialogs/roll-character.hbs", templateData);

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
          md: f.querySelector('[name="md"]')?.checked ? Math.max(1, initialMdValue) : 0 
        }; 
      },
      {
        defaultLabel: "Roll ORE",
        render: (event, html) => {
          let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
          if (!element) return;
 
          const closeBtn = element.querySelector('.header-control[data-action="close"]');
          if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });
 
          const f = element.querySelector("form");
          const poolPreviewSpan = element.querySelector("#pool-value");
          const edInput = element.querySelector('[name="ed"]');
          let mdInput = element.querySelector('[name="md"]');
          
          if (mdInput && mdInput.type === "number") {
              mdInput.type = "checkbox";
              mdInput.checked = initialMdValue > 0;
              mdInput.value = "1";
              if (mdInput.previousElementSibling) mdInput.previousElementSibling.innerText = "Use Master Die?";
          }
          
          if (f) f.addEventListener("submit", e => e.preventDefault());
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
                    poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Impossible (Heavy Armor)</span>`;
                    return;
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
 
            const poolMath = calculateOREPool(rawTotal, ed, md, calledShot, penalty, multiActions);
            
            if (poolMath.diceToRoll < 1) {
                poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Action Fails (Pool < 1)</span>`;
            } else if ((poolMath.actualMd + poolMath.actualEd + poolMath.actualCs) > poolMath.diceToRoll) {
                poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Too many Special Dice</span>`;
            } else {
                let displayStr = `${poolMath.normalDiceCount}d10`;
                if (poolMath.actualEd > 0) displayStr += ` <span style="color:#42a5f5;">+ 1 ED (${poolMath.finalEdFace})</span>`;
                if (poolMath.actualMd > 0) displayStr += ` <span style="color:#ab47bc;">+ 1 MD</span>`;
                if (poolMath.actualCs > 0) displayStr += ` <span style="color:#ef5350;">+ Called Shot (${poolMath.finalCalledShot})</span>`;
                if (poolMath.wasCapped) displayStr += ` <span style="font-size:0.8em; color:#aaa; font-weight: normal;">(Capped at 10)</span>`;
                
                poolPreviewSpan.innerHTML = displayStr;
            }
          };
 
          const enforceExclusivity = () => {
            if ((parseInt(edInput.value) || 0) > 0) { mdInput.checked = false; mdInput.disabled = true; } else mdInput.disabled = false;
            if (mdInput.checked) { edInput.value = 0; edInput.disabled = true; } else edInput.disabled = false;
            updatePool();
          };
 
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

    if (type === "item" && itemRef?.type === "spell" && rollData.multiActions > 1) {
        ui.notifications.warn("Sorcery requires full concentration and cannot be part of a multiple action. Reverting to 1 action.");
        rollData.multiActions = 1;
    }

    if (rollData.envContext === "swimming") {
        if (armorWeight === "heavy") return ui.notifications.error("Swimming in Heavy Armor is impossible. You sink immediately.");
        else if (armorWeight === "medium") {
            rollData.penalty += 2;
            ui.notifications.warn("Swimming in Medium Armor applies a −2d penalty.");
        }
    }
    
    let attrVal = rollData.attr !== "none" ? (parseInt(system.attributes[rollData.attr]?.value) || 0) : 0;
    let itemSkillValue = 0;
    if (showSkillSelect && rollData.skillKey !== "none") {
        if (rollData.skillKey.startsWith("static_")) itemSkillValue = parseInt(system.skills[rollData.skillKey.replace("static_", "")]?.value) || 0;
        else if (rollData.skillKey.startsWith("custom_")) itemSkillValue = parseInt(system.customSkills[rollData.skillKey.replace("custom_", "")]?.value) || 0;
        else if (rollData.skillKey === "esoterica_sorcery") itemSkillValue = parseInt(system.esoterica.sorcery) || 0;
    }

    if (rollData.ed > 0 && rollData.md > 0) return ui.notifications.error("Reign rules forbid using both Expert and Master dice simultaneously.");

    let rawTotal = baseValue + attrVal + itemSkillValue + rollData.bonus + rollData.passionBonus;

    if (rollData.md > 1) {
        ui.notifications.info("Reign rules limit you to a maximum of 1 Master Die per roll. Extra Master Dice were ignored.");
    }

    const poolMath = calculateOREPool(rawTotal, rollData.ed, rollData.md, rollData.calledShot, rollData.penalty, rollData.multiActions);

    if (rollData.calledShot > 0 && poolMath.actualMd > 0) {
        ui.notifications.warn("Called shots are unnecessary with a Master Die.");
    }

    if (poolMath.diceToRoll < 1) return ui.notifications.warn("Penalties reduced your dice pool below 1. Action fails.");

    let poolBreakdown = [];
    if (baseValue > 0 && attrVal === 0 && itemSkillValue === 0) poolBreakdown.push({ label: "Base Pool", value: `+${baseValue}`, isPenalty: false });
    if (attrVal > 0) poolBreakdown.push({ label: `Attribute (${rollData.attr.toUpperCase()})`, value: `+${attrVal}`, isPenalty: false });
    if (itemSkillValue > 0) {
        let skLabel = rollData.skillKey !== "none" ? rollData.skillKey.replace(/(static_|custom_|esoterica_)/, "").toUpperCase() : "Skill";
        poolBreakdown.push({ label: `Skill (${skLabel})`, value: `+${itemSkillValue}`, isPenalty: false });
    }
    if (shieldBonus > 0) poolBreakdown.push({ label: `Shield (${shieldName})`, value: `+${shieldBonus}`, isPenalty: false });
    if (effectBonus > 0) poolBreakdown.push({ label: "Active Effects", value: `+${effectBonus}`, isPenalty: false });
    if (rollData.bonus > 0) poolBreakdown.push({ label: "Manual Bonus", value: `+${rollData.bonus}`, isPenalty: false });
    if (rollData.passionBonus > 0) poolBreakdown.push({ label: "Passion Bonus", value: `+${rollData.passionBonus}`, isPenalty: false });
    
    if (rollData.penalty > 0) poolBreakdown.push({ label: "Penalties & Conditions", value: `-${rollData.penalty}`, isPenalty: true });
    if (rollData.multiActions > 1) poolBreakdown.push({ label: "Multiple Actions", value: `-${rollData.multiActions - 1}`, isPenalty: true });
    if (rollData.calledShot > 0 && poolMath.actualMd === 0) poolBreakdown.push({ label: "Called Shot", value: `-1`, isPenalty: true });

    let results = [];
    // PHASE 6.5 FIX: Capture the actual Foundry Roll object so Dice So Nice can intercept it
    let actualRoll = null;
    if (poolMath.normalDiceCount > 0) {
      actualRoll = new Roll(`${poolMath.normalDiceCount}d10`);
      await actualRoll.evaluate();
      results = actualRoll.dice[0]?.results.map(r => r.result) || [];
    }
    
    if (poolMath.actualEd > 0) results.push(poolMath.finalEdFace);
    if (poolMath.actualCs > 0) results.push(poolMath.finalCalledShot);
    
    const finalizeCombatRoll = async (finalResults, mdCount, edCount, edVal, rollInstance) => {
        if (rawSkillKey === "counterspell") {
            const parsed = parseORE(finalResults);
            if (parsed.sets.length > 0) {
                const bestSet = parsed.sets[0]; 
                let csHtml = `<div class="reign-chat-card" style="border-color: #1a237e;"><h3 style="color: #1a237e;">Counterspell Declared</h3><p style="font-size: 1.1em; margin-bottom: 5px;">The caster anchors their magic with <strong>${bestSet.text}</strong>.</p><p style="font-size: 0.9em; color: #555;">This produces <strong>${bestSet.width} Gobble Dice</strong> at Height <strong>${bestSet.height}</strong>. Each can cancel one die from an incoming spell set of equal or lower Height.</p></div>`;
                await postOREChat(actor, label || "Counterspell", poolMath.diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: poolMath.wasCapped, isAttack: false, isDefense: true, poolBreakdown: poolBreakdown }, rollInstance);
                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: csHtml });
            } else {
                await postOREChat(actor, label || "Counterspell", poolMath.diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: poolMath.wasCapped, isAttack: false, isDefense: true, poolBreakdown: poolBreakdown }, rollInstance);
                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Counterspell Fizzled</h3><p>The caster failed to anchor the spell. They are unprotected!</p></div>` });
            }
        } else {
            // Passing the rollInstance down to chat.js for DSN
            await postOREChat(actor, label || "Action", poolMath.diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: poolMath.wasCapped, isAttack: isAttackRoll, isDefense: isDefenseRoll, poolBreakdown: poolBreakdown }, rollInstance);
        }
    };

    if (poolMath.actualMd > 0) {
      results.sort((a, b) => b - a); 
      let mdHtml = `<form class="reign-dialog-form">
        <p style="margin-top: 0; font-size: 1.1em;"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
        <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Assign a face value to your Master Dice.</p>
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
  }
}