// scripts/combat/defense.js
import { parseORE, calculateInitiative } from "../helpers/ore-engine.js";
import { generateOREChatHTML } from "../helpers/chat.js";
import { reignDialog } from "../helpers/dialog-util.js";

/**
 * RAW Ch6: Gobble Dice Consumption
 * V14 UPDATE: Includes Superior Interception, Cross Block Logic, 
 * AND strict P2 RAW Width-Timing enforcement.
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
    // ORE Initiative Formula: Width + (Height / 100)
    const attackInit = attackSet.width + (attackSet.height / 100);

    let slowDefenders = 0;

    const defenseMessages = game.messages.contents.slice(-50).filter(m => {
        if (m.id === attackMsg.id) return false;
        if (m.speaker?.actor === attackerActorId) return false; 
        const rf = m.flags?.reign;
        if (!rf?.isDefense) return false;
        const gd = rf.gobbleDice;
        if (!gd || !Array.isArray(gd) || gd.length === 0) return false;
        
        // Check Defender's Active Effects
        const defActor = game.actors.get(m.speaker?.actor);
        const defMods = defActor?.system?.modifiers?.combat || {};
        
        let hasHeight = false;
        if (defMods.crossBlockActive) {
            hasHeight = true; // Cross Block ignores Height requirements
        } else if (defMods.combineGobbleDice) {
            // Superior Interception allows summing all gobble dice together
            hasHeight = gd.reduce((a, b) => a + b, 0) >= targetSetHeight;
        } else {
            hasHeight = gd.some(h => h >= targetSetHeight);
        }

        if (!hasHeight) return false;

        // P2 FIX: Enforce Width Timing (Slower defenses cannot gobble faster attacks)
        const parsedDef = parseORE(rf.results, rf.rollFlags?.isMinion);
        const defHeight = gd[0]; // The height of the set assigned to defense
        const defSet = parsedDef.sets.find(s => s.height === defHeight);
        const defInit = defSet ? (defSet.width + (defSet.height / 100)) : 0;

        if (defInit < attackInit) {
            slowDefenders++;
            return false; // Defense is too slow to stop this attack!
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
        gobblePool = [totalHeight]; // Squish into a single super-die
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
    
    // If they used Superior Interception, the entire pool was spent to make that one die.
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