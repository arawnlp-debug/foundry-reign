// scripts/combat/defense.js
import { parseORE, calculateInitiative, computeLocationDamage, getHitLocationLabel } from "../helpers/ore-engine.js";
import { generateOREChatHTML } from "../helpers/chat.js";
import { reignDialog } from "../helpers/dialog-util.js";
import { syncCharacterStatusEffects } from "./damage.js";
import { HIT_LOCATIONS } from "../helpers/config.js";

/**
 * PACKAGE B HELPER: Evaluates a damage formula string with a given Width value.
 * Handles patterns like "Width Shock", "Width+1 Killing", "1 Killing, Width Shock".
 * @returns {{ shock: number, killing: number }}
 */
function evaluateWeaponDamage(dmgString, width) {
    const safeDmg = String(dmgString || "Width Shock").toLowerCase();
    let shock = 0;
    let killing = 0;

    const shockMatch = safeDmg.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*shock/);
    const killMatch = safeDmg.match(/((?:width|\d)(?:\s*[\+\-]\s*\d+)?)\s*killing/);

    if (shockMatch) {
        let expr = shockMatch[1].replace(/width/gi, String(width));
        try { shock = new Roll(expr.replace(/\s/g, "")).evaluateSync().total; }
        catch { shock = parseInt(expr) || 0; }
    }
    if (killMatch) {
        let expr = killMatch[1].replace(/width/gi, String(width));
        try { killing = new Roll(expr.replace(/\s/g, "")).evaluateSync().total; }
        catch { killing = parseInt(expr) || 0; }
    }

    // Fallback: if no typed match, treat entire string as Shock
    if (!shockMatch && !killMatch) {
        let expr = safeDmg.replace(/width/gi, String(width)).replace(/\s/g, "");
        try { shock = new Roll(expr).evaluateSync().total; }
        catch { shock = parseInt(expr) || 0; }
    }

    return { shock, killing };
}

/**
 * PACKAGE B HELPER: Checks whether a character has adequate equipment to parry
 * armed attacks safely (weapon, shield, or arm armor AR >= 1).
 *
 * RAW Ch6 Parry rules:
 * - "If you're normally dressed and not holding something that can block a blow
 *    (even once), you can only safely parry unarmed attacks."
 * - "If you're wearing armor of at least AR 1 on your arms, you can parry all
 *    you want with them and take no damage."
 *
 * @param {Actor} actor - The defending actor.
 * @returns {{ adequate: boolean, parryArm: string }}
 */
function checkParryEquipment(actor) {
    if (!actor || actor.type !== "character") return { adequate: true, parryArm: "armR" };

    const items = actor.items || [];
    const hasWeapon = items.some(i => i.type === "weapon" && i.system.equipped);
    const equippedShield = items.find(i => i.type === "shield" && i.system.equipped);

    if (hasWeapon || equippedShield) return { adequate: true, parryArm: "armR" };

    // Check arm armor (effective AR includes natural armor + equipped armor)
    const armRAr = actor.system.effectiveArmor?.armR || 0;
    const armLAr = actor.system.effectiveArmor?.armL || 0;

    if (armRAr >= 1 || armLAr >= 1) return { adequate: true, parryArm: armRAr >= 1 ? "armR" : "armL" };

    // No adequate equipment — default parrying arm is right arm
    return { adequate: false, parryArm: "armR" };
}


/**
 * RAW Ch6: Gobble Dice Consumption
 * V14 UPDATE: Includes Superior Interception, Cross Block Logic,
 * AND strict P2 RAW Width-Timing enforcement.
 * PACKAGE B: Adds unarmed parry redirect — if a parry succeeds without adequate
 * equipment against an armed attack, the attack's full damage hits the parrying arm.
 */
export async function consumeGobbleDie(attackMsg, targetSetHeight) {
    if (!attackMsg) return false;

    const attackFlags = attackMsg.flags?.reign;
    if (!attackFlags?.results) return false;

    const attackerActorId = attackMsg.speaker?.actor;

    // P2 FIX: Determine the speed/timing of the incoming attack
    const parsedAttack = parseORE(attackFlags.results, attackFlags.rollFlags?.isMinion);
    const attackSet = parsedAttack.sets.find(s => s.height === targetSetHeight);
    if (!attackSet) {
        ui.notifications.warn("Could not find the target attack set.");
        return false;
    }
    const attackInit = attackSet.width + (attackSet.height / 100);

    let slowDefenders = 0;

    const defenseMessages = game.messages.contents.slice(-50).filter(m => {
        if (m.id === attackMsg.id) return false;
        if (m.speaker?.actor === attackerActorId) return false;
        const rf = m.flags?.reign;
        if (!rf?.isDefense) return false;
        const gd = rf.gobbleDice;
        if (!gd || !Array.isArray(gd) || gd.length === 0) return false;

        const defActor = game.actors.get(m.speaker?.actor);
        const defMods = defActor?.system?.modifiers?.combat || {};

        let hasHeight = false;
        if (defMods.crossBlockActive) {
            hasHeight = true;
        } else if (defMods.combineGobbleDice) {
            hasHeight = gd.reduce((a, b) => a + b, 0) >= targetSetHeight;
        } else {
            hasHeight = gd.some(h => h >= targetSetHeight);
        }

        if (!hasHeight) return false;

        // P2 FIX: Enforce Width Timing
        const parsedDef = parseORE(rf.results, rf.rollFlags?.isMinion);
        const defHeight = gd[0];
        const defSet = parsedDef.sets.find(s => s.height === defHeight);
        const defInit = defSet ? (defSet.width + (defSet.height / 100)) : 0;

        if (defInit < attackInit) {
            slowDefenders++;
            return false;
        }

        return true;
    });

    if (defenseMessages.length === 0) {
        if (slowDefenders > 0) {
            ui.notifications.warn(`Defense too slow! ${slowDefenders} defender(s) had the Height, but the attack (Width ${attackSet.width}) was faster.`);
        } else {
            ui.notifications.warn("No available Gobble Dice from any defender can counter this set (Insufficient Height).");
        }
        return false;
    }

    let chosenDefenseMsg = defenseMessages[0];

    if (defenseMessages.length > 1) {
        const options = defenseMessages.map((m, i) => {
            const name = game.actors.get(m.speaker?.actor)?.name || "Unknown";
            const gd = m.flags.reign.gobbleDice;
            return `<option value="${i}">${name} (${gd.length} dice: ${gd.join(", ")})</option>`;
        }).join("");

        const content = `
            <form class="reign-dialog-form">
                <p class="reign-text-center">Multiple defenders have Gobble Dice available and are fast enough to react.</p>
                <div class="form-group">
                    <label>Use Gobble Die from:</label>
                    <select name="defenderIdx">${options}</select>
                </div>
            </form>
        `;

        const chosenIdx = await reignDialog(
            "Choose Defender",
            content,
            (e, b, d) => parseInt(d.element.querySelector('[name="defenderIdx"]').value),
            { defaultLabel: "Consume Gobble Die" }
        );

        if (chosenIdx === undefined || chosenIdx === null) return false;
        chosenDefenseMsg = defenseMessages[chosenIdx];
    }

    const defenderActor = game.actors.get(chosenDefenseMsg.speaker?.actor);
    const defMods = defenderActor?.system?.modifiers?.combat || {};
    const defenderName = defenderActor?.name || "Defender";

    let gobblePool = [...chosenDefenseMsg.flags.reign.gobbleDice];

    // ACTIVE EFFECT: Superior Interception
    if (defMods.combineGobbleDice && gobblePool.length > 1) {
        let totalHeight = gobblePool.reduce((sum, val) => sum + val, 0);
        gobblePool = [totalHeight];
        ui.notifications.info(`${defenderName} combined their Gobble Dice into a single die of Height ${totalHeight}!`);
    }

    const validDice = gobblePool
        .map((h, i) => ({ height: h, index: i }))
        .filter(d => defMods.crossBlockActive || d.height >= targetSetHeight)
        .sort((a, b) => a.height - b.height);

    if (validDice.length === 0) {
        ui.notifications.warn("No Gobble Die of sufficient Height available.");
        return false;
    }

    const consumed = validDice[0];
    gobblePool.splice(consumed.index, 1);

    if (defMods.combineGobbleDice) {
        gobblePool = [];
    }

    const newResults = [...attackFlags.results];
    const dieIdx = newResults.indexOf(targetSetHeight);
    if (dieIdx === -1) {
        ui.notifications.warn("Could not find a die of that height in the attack results.");
        return false;
    }
    newResults.splice(dieIdx, 1);

    const newHtml = await generateOREChatHTML(
        attackFlags.actorType,
        attackFlags.label,
        attackFlags.totalPool,
        newResults,
        attackFlags.expertDie,
        attackFlags.masterDiceCount,
        attackFlags.itemData,
        attackFlags.rollFlags
    );

    const gobbleBanner = `<div class="reign-status-banner gobbled"><i class="fas fa-shield-alt"></i> GOBBLED! ${defenderName} used a Gobble Die (Height ${consumed.height}) to cancel a die of Height ${targetSetHeight}.</div>`;
    const finalHtml = newHtml.replace('<div class="reign-chat-card">', `<div class="reign-chat-card">${gobbleBanner}`);

    await attackMsg.update({
        content: finalHtml,
        "flags.reign.results": newResults
    });

    const defFlags = chosenDefenseMsg.flags.reign;
    const newDefenseHtml = await generateOREChatHTML(
        defFlags.actorType, defFlags.label, defFlags.totalPool,
        defFlags.results, defFlags.expertDie, defFlags.masterDiceCount,
        defFlags.itemData, { ...defFlags.rollFlags, gobbleDice: gobblePool }
    );

    await chosenDefenseMsg.update({
        content: newDefenseHtml,
        "flags.reign.gobbleDice": gobblePool
    });


    // ==========================================
    // PACKAGE B: UNARMED PARRY REDIRECT
    // ==========================================
    // RAW Ch6: "If you have nothing tough enough to stop a blow and you parry
    // successfully anyhow, you just redirect the blow to the parrying arm.
    // It does full damage, but to your arm instead of (for example) your head."
    //
    // "If you're wearing armor of at least AR 1 on your arms, you can parry
    // all you want with them and take no damage."
    //
    // Exception: Unarmed attacks (punches, kicks) can be safely parried bare-handed.

    const isParry = defFlags.defenseType === "parry" || /parry/i.test(defFlags.label || "");

    if (isParry && defenderActor?.type === "character") {
        // Check if the attack is armed (a held weapon, not a natural/body attack).
        // RAW: "you can only safely parry unarmed attacks" bare-handed.
        // Weapons marked with the 'unarmed' quality (Bite, Punch, Kick) are body attacks.
        const isArmedAttack = attackFlags.itemData
            && attackFlags.itemData.type === "weapon"
            && !attackFlags.itemData.system.qualities?.unarmed;

        if (isArmedAttack) {
            const { adequate, parryArm } = checkParryEquipment(defenderActor);

            if (!adequate) {
                // Parry "succeeded" mechanically (gobble die consumed) but without equipment
                // the force of an armed blow transfers directly to the parrying arm.
                // Use the pre-gobble Width for "full damage" as the rules specify.
                const attackWidth = attackSet.width;
                const dmgStr = attackFlags.itemData?.system?.damage
                            || attackFlags.itemData?.system?.damageFormula
                            || "Width Shock";
                const { shock, killing } = evaluateWeaponDamage(dmgStr, attackWidth);

                if (shock > 0 || killing > 0) {
                    const localHealth = foundry.utils.deepClone(defenderActor.system.health);
                    const armAr = defenderActor.system.effectiveArmor?.[parryArm] || 0;

                    // Armor on the arm still applies (though the check above confirmed AR < 1,
                    // natural armor or effects could still contribute a fractional amount)
                    const finalShock = Math.max(0, shock - armAr);
                    const finalKilling = Math.max(0, killing - armAr);

                    if (finalShock > 0 || finalKilling > 0) {
                        const effectiveMax = defenderActor.system.effectiveMax?.[parryArm] || 5;
                        const result = computeLocationDamage(
                            localHealth[parryArm].shock || 0,
                            localHealth[parryArm].killing || 0,
                            finalShock,
                            finalKilling,
                            effectiveMax
                        );

                        localHealth[parryArm].shock = result.newShock;
                        localHealth[parryArm].killing = result.newKilling;

                        // Overflow from a destroyed arm goes to torso
                        if (result.overflowKilling > 0) {
                            const torsoMax = defenderActor.system.effectiveMax?.torso || 10;
                            const torsoResult = computeLocationDamage(
                                localHealth.torso.shock || 0,
                                localHealth.torso.killing || 0,
                                0,
                                result.overflowKilling,
                                torsoMax
                            );
                            localHealth.torso.shock = torsoResult.newShock;
                            localHealth.torso.killing = torsoResult.newKilling;
                        }

                        // Write health updates
                        const healthUpdates = {};
                        for (const k of HIT_LOCATIONS) {
                            if (localHealth[k].shock !== defenderActor.system.health[k].shock) {
                                healthUpdates[`system.health.${k}.shock`] = localHealth[k].shock;
                            }
                            if (localHealth[k].killing !== defenderActor.system.health[k].killing) {
                                healthUpdates[`system.health.${k}.killing`] = localHealth[k].killing;
                            }
                        }
                        if (!foundry.utils.isEmpty(healthUpdates)) {
                            await defenderActor.update(healthUpdates);
                        }
                        await syncCharacterStatusEffects(defenderActor);

                        // Post redirect notification
                        const safeDefName = foundry.utils.escapeHTML(defenderName);
                        const armLabel = getHitLocationLabel(parryArm).split(" (")[0];
                        const shockSoaked = Math.min(shock, armAr);
                        const killingSoaked = Math.min(killing, armAr);

                        let redirectHtml = `<div class="reign-chat-card reign-card-danger">`;
                        redirectHtml += `<h3 class="reign-text-danger"><i class="fas fa-hand-paper"></i> Bare-Handed Parry!</h3>`;
                        redirectHtml += `<p>${safeDefName} caught the blow with a bare arm — the full force transfers!</p>`;
                        redirectHtml += `<div class="reign-callout reign-callout-danger">`;
                        redirectHtml += `<strong>${armLabel}:</strong> `;
                        if (finalKilling > 0) redirectHtml += `<span class="reign-text-danger">${finalKilling} Kill</span> `;
                        if (finalShock > 0) redirectHtml += `<span>${finalShock} Shock</span> `;
                        if (armAr > 0) redirectHtml += `<span class="reign-text-muted reign-text-small">(Armor stopped ${shockSoaked}S/${killingSoaked}K)</span>`;
                        if (result.overflowKilling > 0) redirectHtml += `<br><span class="reign-text-danger reign-text-small">(+${result.overflowKilling} Killing overflow to Torso)</span>`;
                        redirectHtml += `</div>`;
                        redirectHtml += `<p class="reign-text-muted reign-text-small">Without a weapon, shield, or arm armor (AR 1+), a parry redirects full damage to the parrying arm.</p>`;
                        redirectHtml += `</div>`;

                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
                            content: redirectHtml
                        });
                    }
                }
            }
        }
    }


    // Update initiative for the attacker based on remaining sets
    if (game.combat) {
        const newParsed = parseORE(newResults, attackFlags.rollFlags?.isMinion);
        const combatant = game.combat.combatants.find(c => c.actorId === attackerActorId);
        if (combatant) {
            let newInit = 0;
            if (newParsed.sets.length > 0) {
                const flags = attackFlags.rollFlags || {};
                const isDefense = flags.isDefense || /dodge|parry|counterspell/i.test(attackFlags.label);
                const range = attackFlags.itemData?.type === "weapon" ? (attackFlags.itemData.system.range || "0") : "0";
                newInit = calculateInitiative(newParsed.sets, isDefense, flags.isAttack, flags.isMinion, range);
            }
            await combatant.update({ initiative: newInit });
        }
    }

    ui.notifications.info(`${defenderName} gobbled a die from the attack! Height ${targetSetHeight} die removed.`);
    return true;
}

// ==========================================
// ITEM 8: DIVE FOR COVER
// ==========================================

/**
 * RAW Ch6 "Dodge / Cover": When a Dodge roll produces sets, the player may choose
 * to dive for cover instead of using Gobble Dice. This sacrifices all Gobble Dice
 * from the Dodge in exchange for location-based immunity behind an obstacle.
 *
 * "If you retain a Dodge set, when it goes off you can protect your bits as you see fit."
 *
 * Mechanically:
 * - All Gobble Dice from the Dodge message are consumed (no longer available for gobbling)
 * - The player selects which locations are hidden behind cover
 * - Those locations gain full immunity to attacks for the remainder of the round
 * - The character is considered "downed" (prone) from the dive
 *
 * @param {ChatMessage} dodgeMsg - The Dodge roll chat message with gobble dice.
 * @returns {Promise<boolean>} True if cover was successfully applied.
 */
export async function diveForCover(dodgeMsg) {
    if (!dodgeMsg) return false;

    const flags = dodgeMsg.flags?.reign;
    if (!flags) return false;

    // Validate this is a Dodge defense
    const isValidDodge = flags.isDefense && (flags.defenseType === "dodge" || /dodge/i.test(flags.label || ""));
    if (!isValidDodge) {
        ui.notifications.warn("Dive for Cover can only be used with a Dodge roll.");
        return false;
    }

    // Check gobble dice are available
    const gobbleDice = flags.gobbleDice;
    if (!gobbleDice || !Array.isArray(gobbleDice) || gobbleDice.length === 0) {
        ui.notifications.warn("No Gobble Dice remaining on this Dodge to sacrifice for cover.");
        return false;
    }

    const actorId = dodgeMsg.speaker?.actor;
    const actor = game.actors.get(actorId);
    if (!actor || actor.type !== "character") {
        ui.notifications.warn("Could not find a valid character actor for this Dodge.");
        return false;
    }

    // Check if cover is already active
    if (actor.getFlag("reign", "dodgeCover")) {
        ui.notifications.warn(`${actor.name} is already in cover this round.`);
        return false;
    }

    const locationLabels = {
        head: "Head (10)", torso: "Torso (7-9)", armR: "R. Arm (5-6)",
        armL: "L. Arm (3-4)", legR: "R. Leg (2)", legL: "L. Leg (1)"
    };
    const locationKeys = ["head", "torso", "armR", "armL", "legR", "legL"];

    // Prompt: which locations does the cover protect?
    const checkboxes = locationKeys.map(k => {
        return `<label class="reign-checkbox-row"><input type="checkbox" name="cover_${k}" value="${k}" /> ${locationLabels[k]}</label>`;
    }).join("");

    const content = `
        <form class="reign-dialog-form">
            <p class="reign-text-center reign-text-large reign-text-bold">Dive for Cover!</p>
            <p class="reign-text-center reign-text-small reign-text-muted">
                Sacrifice your <strong>${gobbleDice.length} Gobble Dice</strong> (${gobbleDice.join(", ")})
                to dive behind an obstacle. You will be <strong>downed</strong> (prone) but protected.
            </p>
            <p class="reign-text-center reign-text-small">Select which locations are hidden behind the cover:</p>
            <div class="reign-cover-checkboxes" style="display: flex; flex-direction: column; gap: 4px; padding: 0 20px;">
                ${checkboxes}
            </div>
            <p class="reign-text-center reign-text-muted reign-text-small" style="margin-top: 8px;">
                The GM determines what cover is available. A low wall might hide legs and torso;
                a narrow pillar might only cover the torso.
            </p>
        </form>
    `;

    const result = await reignDialog(
        "Dive for Cover",
        content,
        (e, b, d) => {
            const f = d.element.querySelector("form") || d.element;
            const covered = {};
            for (const k of locationKeys) {
                covered[k] = !!f.querySelector(`[name="cover_${k}"]`)?.checked;
            }
            return covered;
        },
        { defaultLabel: "Dive!" }
    );

    if (!result) return false;

    // Verify at least one location was selected
    const anyProtected = Object.values(result).some(v => v);
    if (!anyProtected) {
        ui.notifications.warn("No locations selected for cover. Dive cancelled.");
        return false;
    }

    // 1) Consume all gobble dice from the Dodge message
    const updatedRollFlags = foundry.utils.deepClone(flags.rollFlags || {});
    updatedRollFlags.gobbleDice = [];

    const newDodgeHtml = await generateOREChatHTML(
        flags.actorType, flags.label, flags.totalPool,
        flags.results, flags.expertDie, flags.masterDiceCount,
        flags.itemData, updatedRollFlags
    );

    const coverBanner = `<div class="reign-status-banner gobbled"><i class="fas fa-shield-alt"></i> DOVE FOR COVER! Gobble Dice sacrificed. ${actor.name} is behind cover and downed.</div>`;
    const finalDodgeHtml = newDodgeHtml.replace('<div class="reign-chat-card">', `<div class="reign-chat-card">${coverBanner}`);

    await dodgeMsg.update({
        content: finalDodgeHtml,
        "flags.reign.gobbleDice": [],
        "flags.reign.rollFlags": updatedRollFlags,
        "flags.reign.coverApplied": true
    });

    // 2) Set cover flags on the actor (read by isLocationInCover in damage.js)
    await actor.setFlag("reign", "dodgeCover", result);

    // 3) Apply prone/downed status — diving for cover puts you on the ground
    if (!actor.statuses.has("prone")) {
        await actor.toggleStatusEffect("prone", { active: true });
    }

    // 4) Post a summary chat card
    const safeName = foundry.utils.escapeHTML(actor.name);
    const protectedNames = Object.entries(result)
        .filter(([, v]) => v)
        .map(([k]) => locationLabels[k]?.split(" (")[0] || k);
    const exposedNames = Object.entries(result)
        .filter(([, v]) => !v)
        .map(([k]) => locationLabels[k]?.split(" (")[0] || k);

    let chatHtml = `<div class="reign-chat-card">`;
    chatHtml += `<h3><i class="fas fa-shield-alt"></i> ${safeName} Dives for Cover!</h3>`;
    chatHtml += `<div class="reign-callout">`;
    chatHtml += `<p><strong>Protected:</strong> ${protectedNames.join(", ")}</p>`;
    if (exposedNames.length > 0) {
        chatHtml += `<p><strong>Exposed:</strong> <span class="reign-text-danger">${exposedNames.join(", ")}</span></p>`;
    }
    chatHtml += `</div>`;
    chatHtml += `<p class="reign-text-muted reign-text-small">Downed (prone) until they spend an action to stand. Attacks targeting protected locations are blocked entirely.</p>`;
    chatHtml += `</div>`;

    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: chatHtml });

    ui.notifications.info(`${actor.name} dove for cover! ${protectedNames.length} location(s) protected.`);
    return true;
}