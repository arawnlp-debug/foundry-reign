// scripts/helpers/reign-roller.js
const { DialogV2 } = foundry.applications.api;
import { parseORE, getEffectiveMax } from "./ore-engine.js";
import { postOREChat } from "./chat.js";

export class ReignRoller {
  
  // ==========================================
  // 1. CHARACTER ROLLER
  // ==========================================
  static async rollCharacter(actor, dataset) {
    const { type, key, label } = dataset;
    const system = actor.system;

    // --- Safety Checks (Dead/Unconscious) ---
    const headMax = getEffectiveMax(actor, "head");
    const torsoMax = getEffectiveMax(actor, "torso");
    const headK = system.health.head.killing || 0;
    const headS = system.health.head.shock || 0;
    const torsoK = system.health.torso.killing || 0;
    const torsoS = system.health.torso.shock || 0;

    if (headK >= headMax || torsoK >= torsoMax) return ui.notifications.error("Character is dead and cannot act.");
    if (headS + headK >= headMax) return ui.notifications.warn("Character is unconscious and cannot act.");

    // --- Base Value & Attr/Skill Linking ---
    const skillAttrMap = {
      athletics: "body", endurance: "body", fight: "body", parry: "body", run: "body", vigor: "body",
      climb: "coordination", dodge: "coordination", ride: "coordination", stealth: "coordination",
      direction: "sense", eerie: "sense", empathy: "sense", hearing: "sense", scrutinize: "sense", sight: "sense", taste_touch_smell: "sense",
      counterspell: "knowledge", healing: "knowledge", languageNative: "knowledge", lore: "knowledge", strategy: "knowledge", tactics: "knowledge",
      haggle: "command", inspire: "command", intimidate: "command",
      fascinate: "charm", graces: "charm", jest: "charm", lie: "charm", plead: "charm"
    };

    let baseValue = 0; let defaultAttr = "none"; let defaultSkill = "none"; let itemRef = null;
    let hasExpert = false; let hasMaster = false;

    if (type === "attribute") {
        baseValue = 0; defaultAttr = key; 
    } else if (type === "skill") { 
        baseValue = system.skills[key]?.value || 0; 
        hasExpert = system.skills[key]?.expert; 
        hasMaster = system.skills[key]?.master; 
        defaultAttr = skillAttrMap[key] || "none"; 
    } else if (type === "customSkill") { 
        baseValue = system.customSkills[key]?.value || 0; 
        hasExpert = system.customSkills[key]?.expert; 
        hasMaster = system.customSkills[key]?.master; 
        defaultAttr = system.customSkills[key]?.attribute || "none"; 
    } else if (type === "esoterica") { 
        baseValue = system.esoterica[key] || 0; 
        hasExpert = system.esoterica.expert || false;
        hasMaster = system.esoterica.master || false;
        defaultAttr = "knowledge"; 
    } else if (type === "move") {
        const m = system.customMoves[key];
        let aVal = m.attrKey !== "none" ? (system.attributes[m.attrKey]?.value || 0) : 0;
        let sVal = 0;
        if (m.skillKey !== "none") {
            if (system.skills[m.skillKey]) { sVal = system.skills[m.skillKey].value; hasExpert = system.skills[m.skillKey].expert; hasMaster = system.skills[m.skillKey].master; }
            else if (system.customSkills[m.skillKey]) { sVal = system.customSkills[m.skillKey].value; hasExpert = system.customSkills[m.skillKey].expert; hasMaster = system.customSkills[m.skillKey].master; }
        }
        baseValue = aVal + sVal + (m.modifier || 0);
    } else if (type === "item") { 
        itemRef = actor.items.get(key); 
        const poolRaw = itemRef?.system?.pool || ""; 
        
        if (itemRef?.type === "spell") {
            defaultSkill = "esoterica_sorcery";
            baseValue = 0; hasExpert = system.esoterica.expert || false; hasMaster = system.esoterica.master || false;
            defaultAttr = "knowledge"; 
        } else {
            const matchedStatic = Object.keys(system.skills || {}).find(k => k.toLowerCase() === poolRaw.toLowerCase());
            const matchedCustom = Object.entries(system.customSkills || {}).find(([id, cSk]) => cSk.customLabel.toLowerCase() === poolRaw.toLowerCase());
            
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

    // --- Weapon Readiness Check ---
    if (type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.slow > 0) {
      const combatant = game.combat?.combatants.find(c => c.actorId === actor.id);
      if (combatant && game.combat) {
        const cooldownUntil = combatant.getFlag("reign", "slowCooldown") || 0;
        if (game.combat.round <= cooldownUntil) return ui.notifications.warn(`${itemRef.name} is still being readied. Available on round ${cooldownUntil + 1}.`);
      }
    }

    // --- Penalties & Armor ---
    let woundPenalty = 0; let isDazed = false;
    if (headS + headK >= headMax) woundPenalty += 1;
    if (torsoS + torsoK >= torsoMax) { woundPenalty += 1; isDazed = true; }

    let armorWeight = "none";
    const equippedArmor = actor.items.filter(i => i.type === "armor" && i.system.equipped);
    if (equippedArmor.some(a => a.system.armorWeight === "heavy")) armorWeight = "heavy";
    else if (equippedArmor.some(a => a.system.armorWeight === "medium")) armorWeight = "medium";
    else if (equippedArmor.some(a => a.system.armorWeight === "light")) armorWeight = "light";

    let rawSkillKey = defaultSkill.replace("static_", "").replace("custom_", "").replace("esoterica_", "");
    if (!rawSkillKey || rawSkillKey === "none") rawSkillKey = key; 
    
    let encumbDiff = 0; let encumbPen = 0; let encumbImpossible = false;
    if (armorWeight === "heavy") {
        if (rawSkillKey === "stealth") encumbImpossible = true;
        else if (rawSkillKey === "climb" || rawSkillKey === "run") encumbPen = 2;
        else if (rawSkillKey === "endurance" || rawSkillKey === "athletics") encumbDiff = 4;
    } else if (armorWeight === "medium") {
        if (["stealth", "climb", "run", "endurance", "athletics"].includes(rawSkillKey)) encumbDiff = 3;
    }

    if (encumbImpossible) return ui.notifications.error("Stealth is impossible in heavy armor. Action auto-fails.");
    
    let isAgility = defaultAttr === "coordination" || ["athletics", "dodge", "run", "stealth", "vigor", "ride"].includes(rawSkillKey);
    let autoPenalty = woundPenalty;
    let penaltyTitle = isDazed ? `DAZED (−1d)` : `Wounds (−${woundPenalty}d)`;
    
    if (isAgility && (encumbPen > 0 || encumbDiff > 0)) {
        autoPenalty += encumbPen; penaltyTitle += ` & Armor (−${encumbPen}d, Diff ${encumbDiff})`;
    }

    let shieldBonus = 0;
    if (rawSkillKey === "parry") {
        const equippedShields = actor.items.filter(i => i.type === "shield" && i.system.equipped);
        if (equippedShields.length > 0) shieldBonus = Math.max(...equippedShields.map(s => s.system.parryBonus || 0));
    }

    const showSkillSelect = (type === "item");
    const isCombatRoll = (type === "item" && itemRef?.type === "weapon") || (type === "skill" && key === "fight") || (type === "move") || (type === "customSkill" && system.customSkills[key]?.isCombat);

    let initialEdValue = hasExpert ? 10 : 0;
    let initialMdValue = hasMaster ? 1 : 0; 

    // --- Build Dialog ---
    let dialogTitle = `Roll ${label || 'Action'}`;
    if (shieldBonus > 0) dialogTitle += ` (+${shieldBonus}d Shield Bonus)`;

    let content = `<form class="reign-dialog-form">
      <div class="form-group"><label>Attribute:</label><select name="attr">
        <option value="none">None</option>
        <option value="body" ${defaultAttr==='body'?'selected':''}>Body</option>
        <option value="coordination" ${defaultAttr==='coordination'?'selected':''}>Coordination</option>
        <option value="sense" ${defaultAttr==='sense'?'selected':''}>Sense</option>
        <option value="knowledge" ${defaultAttr==='knowledge'?'selected':''}>Knowledge</option>
        <option value="command" ${defaultAttr==='command'?'selected':''}>Command</option>
        <option value="charm" ${defaultAttr==='charm'?'selected':''}>Charm</option>
      </select></div>`;
      
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
        <div class="form-group"><label>Total Actions:</label><input type="number" name="multiActions" value="1" min="1" title="Penalty: -1d per extra action"/></div>
        <div class="form-group"><label>Bonus Dice (+d):</label><input type="number" name="bonus" value="${shieldBonus}"/></div>
        <div class="form-group"><label>Penalty Dice (-d):</label><input type="number" name="penalty" value="${autoPenalty}" title="${penaltyTitle}"/></div>
      </div>
        
      <div class="form-group">
        <label>Passions:</label>
        <div class="dialog-grid dialog-grid-3">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 0.75em;">Mission</label>
            <select name="pMiss" style="font-size: 0.85em; padding: 2px;">
              <option value="1">Aligned (+1d)</option><option value="0" selected>Neutral</option><option value="-1">Against (-1d)</option>
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 0.75em;">Duty</label>
            <select name="pDuty" style="font-size: 0.85em; padding: 2px;">
              <option value="1">Aligned (+1d)</option><option value="0" selected>Neutral</option><option value="-1">Against (-1d)</option>
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 0.75em;">Craving</label>
            <select name="pCrav" style="font-size: 0.85em; padding: 2px;">
              <option value="1">Aligned (+1d)</option><option value="0" selected>Neutral</option><option value="-1">Against (-1d)</option>
            </select>
          </div>
        </div>
      </div>
      
      <div class="dialog-grid dialog-grid-2" style="margin-top: 15px;">
        <div class="form-group"><label>Expert Die (1-10, 0=None):</label><input type="number" name="ed" value="${initialEdValue}" min="0" max="10"/></div>
        <div class="form-group"><label>Master Dice (Max 1):</label><input type="number" name="md" value="${initialMdValue}" min="0" max="1"/></div>
      </div>
    </form>`;

    const rollData = await DialogV2.wait({ 
      classes: ["reign-dialog-window"], window: { title: dialogTitle }, content: content, 
      render: (event, html) => {
        let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
        if (!element) return;
        const edInput = element.querySelector('[name="ed"]');
        const mdInput = element.querySelector('[name="md"]');
        if (!edInput || !mdInput) return;
        const enforceExclusivity = () => {
          if ((parseInt(edInput.value) || 0) > 0) { mdInput.value = 0; mdInput.disabled = true; } else mdInput.disabled = false;
          if ((parseInt(mdInput.value) || 0) > 0) { edInput.value = 0; edInput.disabled = true; } else edInput.disabled = false;
        };
        edInput.addEventListener('input', enforceExclusivity); mdInput.addEventListener('input', enforceExclusivity); enforceExclusivity(); 
      },
      buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
        const f = d.element.querySelector("form"); 
        return { 
          attr: f.querySelector('[name="attr"]')?.value || "none", skillKey: f.querySelector('[name="skillKey"]')?.value || "none",
          calledShot: parseInt(f.querySelector('[name="calledShot"]')?.value) || 0, difficulty: parseInt(f.querySelector('[name="difficulty"]')?.value) || 0,
          multiActions: Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1),
          bonus: parseInt(f.querySelector('[name="bonus"]')?.value) || 0, penalty: parseInt(f.querySelector('[name="penalty"]')?.value) || 0, 
          passionBonus: (parseInt(f.querySelector('[name="pMiss"]')?.value) || 0) + (parseInt(f.querySelector('[name="pDuty"]')?.value) || 0) + (parseInt(f.querySelector('[name="pCrav"]')?.value) || 0),
          ed: parseInt(f.querySelector('[name="ed"]')?.value) || 0, md: parseInt(f.querySelector('[name="md"]')?.value) || 0 
        }; 
      }}] 
    });
    
    if (!rollData) return;
    
    // --- Processing the Roll ---
    let attrVal = rollData.attr !== "none" ? (system.attributes[rollData.attr]?.value || 0) : 0;
    let itemSkillValue = 0;
    if (showSkillSelect && rollData.skillKey !== "none") {
        if (rollData.skillKey.startsWith("static_")) itemSkillValue = system.skills[rollData.skillKey.replace("static_", "")]?.value || 0;
        else if (rollData.skillKey.startsWith("custom_")) itemSkillValue = system.customSkills[rollData.skillKey.replace("custom_", "")]?.value || 0;
        else if (rollData.skillKey === "esoterica_sorcery") itemSkillValue = system.esoterica.sorcery || 0;
    }

    if (rollData.ed > 0 && rollData.md > 0) return ui.notifications.error("Reign rules forbid using both Expert and Master dice simultaneously.");

    let actualMd = rollData.md > 0 ? 1 : 0; let actualEd = rollData.ed > 0 ? 1 : 0;
    let remainingPenalty = rollData.penalty; let calledShotPenalty = rollData.calledShot > 0 ? 1 : 0;

    if (rollData.calledShot > 0 && actualEd > 0) calledShotPenalty = 0; 
    if (rollData.calledShot > 0 && actualMd > 0) { ui.notifications.warn("Called shots are unnecessary with a Master Die."); rollData.calledShot = 0; calledShotPenalty = 0; }

    if (remainingPenalty > 0 && actualMd > 0) { actualMd = 0; remainingPenalty--; }
    if (remainingPenalty > 0 && actualEd > 0) { actualEd = 0; remainingPenalty--; }

    let baseDice = baseValue + attrVal + itemSkillValue + rollData.bonus + rollData.passionBonus;
    let multiActionPenalty = rollData.multiActions > 1 ? (rollData.multiActions - 1) : 0;
    let intendedPool = baseDice - remainingPenalty - multiActionPenalty - calledShotPenalty;
    let diceToRoll = Math.min(intendedPool, 10);
    let wasCapped = intendedPool > 10;

    if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced your dice pool below 1. Action fails.");

    let specialDiceCount = actualEd + actualMd + (rollData.calledShot > 0 ? 1 : 0);
    if (specialDiceCount > diceToRoll) return ui.notifications.warn("Cannot assign more Expert/Master/Called Shot dice than your total remaining pool limit!");

    let randomDiceCount = diceToRoll - specialDiceCount;
    let results = [];
    if (randomDiceCount > 0) {
      const roll = new Roll(`${randomDiceCount}d10`);
      await roll.evaluate();
      results = roll.dice[0]?.results.map(r => r.result) || [];
    }
    if (actualEd > 0) results.push(rollData.ed);
    if (rollData.calledShot > 0) results.push(rollData.calledShot);
    
    // Finalize Closure
    const finalizeCombatRoll = async (finalResults, mdCount, edCount, edVal) => {
        if (rawSkillKey === "counterspell") {
            const parsed = parseORE(finalResults);
            if (parsed.sets.length > 0) {
                const bestSet = parsed.sets[0]; 
                let csHtml = `<div class="reign-chat-card" style="border-color: #1a237e;"><h3 style="color: #1a237e;">Counterspell Declared</h3><p style="font-size: 1.1em; margin-bottom: 5px;">The caster anchors their magic with <strong>${bestSet.text}</strong>.</p><p style="font-size: 0.9em; color: #555;">This produces <strong>${bestSet.width} Gobble Dice</strong> at Height <strong>${bestSet.height}</strong>. Each can cancel one die from an incoming spell set of equal or lower Height.</p></div>`;
                await postOREChat(actor, label || "Counterspell", diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: wasCapped, isAttack: false });
                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: csHtml });
            } else {
                await postOREChat(actor, label || "Counterspell", diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: wasCapped, isAttack: false });
                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor}), content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Counterspell Fizzled</h3><p>The caster failed to anchor the spell. They are unprotected!</p></div>` });
            }
        } else {
            await postOREChat(actor, label || "Action", diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, { multiActions: rollData.multiActions, calledShot: rollData.calledShot, difficulty: rollData.difficulty, wasCapped: wasCapped, isAttack: isCombatRoll });
        }
    };

    if (actualMd > 0) {
      results.sort((a, b) => b - a); 
      let mdHtml = `<form class="reign-dialog-form">
        <p style="margin-top: 0; font-size: 1.1em;"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
        <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Assign a face value to your Master Dice.</p>
        <div class="dialog-grid dialog-grid-2">`;
      for(let i=0; i<actualMd; i++) mdHtml += `<div class="form-group"><label>MD ${i+1} Face:</label><input type="number" id="mdFace${i}" value="10" min="1" max="10"/></div>`;
      mdHtml += `</div></form>`;

      const mdResult = await DialogV2.wait({
        classes: ["reign-dialog-window"], window: { title: `Assign Master Dice` }, content: mdHtml,
        buttons: [{ action: "assign", label: "Finalize Sets", default: true, callback: (e, b, d) => {
            const faces = [];
            for(let i=0; i<actualMd; i++) faces.push(parseInt(d.element.querySelector(`#mdFace${i}`).value) || 10);
            return faces;
        }}]
      });

      if (mdResult) { results.push(...mdResult); await finalizeCombatRoll(results, actualMd, actualEd, rollData.ed); }
    } else {
        await finalizeCombatRoll(results, 0, actualEd, rollData.ed);
    }
  }

  // ==========================================
  // 2. COMPANY ROLLER
  // ==========================================
  static async rollCompany(actor, dataset) {
    const key1 = dataset.key || "might";
    const system = actor.system;
    
    const companyActions = {
      "none": { label: "-- Custom Action --", q1: "none", q2: "none", target: "none", diff: 0, cost: "none" },
      "attack": { label: "Attack (Direct)", q1: "might", q2: "might", target: "might", diff: 0, cost: "might" },
      "unconventional": { label: "Attack (Unconventional)", q1: "influence", q2: "might", target: "might", diff: 0, cost: "influence" },
      "defend": { label: "Defend", q1: "might", q2: "territory", target: "none", diff: 0, cost: "none" },
      "levy_troops": { label: "Levy Troops", q1: "might", q2: "sovereignty", target: "none", diff: 3, cost: "treasure" },
      "train_troops": { label: "Train & Equip Troops", q1: "might", q2: "treasure", target: "none", diff: 3, cost: "treasure" },
      "tax": { label: "Levy Taxes", q1: "sovereignty", q2: "territory", target: "none", diff: 4, cost: "influence" },
      "police": { label: "Police Population", q1: "might", q2: "sovereignty", target: "none", diff: 3, cost: "treasure" },
      "diplomacy": { label: "Diplomacy", q1: "influence", q2: "sovereignty", target: "none", diff: 3, cost: "treasure" },
      "espionage": { label: "Espionage", q1: "influence", q2: "treasure", target: "none", diff: 3, cost: "treasure" },
      "counter_espionage": { label: "Counter-Espionage", q1: "influence", q2: "territory", target: "none", diff: 3, cost: "treasure" },
      "restore_morale": { label: "Restore Morale", q1: "sovereignty", q2: "treasure", target: "none", diff: 3, cost: "treasure" }
    };

    let presetOptions = Object.entries(companyActions).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    const qualityOptions = `<option value="none">None</option><option value="might">Might</option><option value="treasure">Treasure</option><option value="influence">Influence</option><option value="territory">Territory</option><option value="sovereignty">Sovereignty</option>`;

    let content = `<form class="reign-dialog-form">
      <div class="form-group" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed #ccc;">
        <label style="color: #8b1f1f; font-weight: bold;">Action Catalog:</label>
        <select name="preset" id="reign-action-preset">${presetOptions}</select>
      </div>
      <div class="dialog-grid dialog-grid-2">
        <div class="form-group"><label>Primary Quality:</label><select name="q1" id="reign-q1">
            <option value="might" ${key1 === "might" ? "selected" : ""}>Might</option>
            <option value="treasure" ${key1 === "treasure" ? "selected" : ""}>Treasure</option>
            <option value="influence" ${key1 === "influence" ? "selected" : ""}>Influence</option>
            <option value="territory" ${key1 === "territory" ? "selected" : ""}>Territory</option>
            <option value="sovereignty" ${key1 === "sovereignty" ? "selected" : ""}>Sovereignty</option>
        </select></div>
        <div class="form-group"><label>Secondary Quality:</label><select name="q2" id="reign-q2">${qualityOptions}</select></div>
      </div>
      <div class="dialog-grid dialog-grid-2" style="margin-top: 10px;">
        <div class="form-group"><label>Difficulty (Min Height):</label><input type="number" name="difficulty" id="reign-diff" value="0" min="0" max="10"/></div>
        <div class="form-group"><label>Mod Dice (+d):</label><input type="number" name="mod" value="0"/></div>
      </div>
      <div class="dialog-grid dialog-grid-2" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ccc;">
        <div class="form-group"><label style="color: #d97706;">Action Cost (Pay 1 Temp):</label><select name="cost" id="reign-cost">${qualityOptions.replace('value="none"', 'value="none" selected').replace('None', 'None (Free)')}</select></div>
        <div class="form-group"><label>Target Quality (If Attacking):</label><select name="targetQuality" id="reign-target">${qualityOptions}</select></div>
      </div>
    </form>`;
    
    const rollData = await DialogV2.wait({ 
      classes: ["reign-dialog-window"], window: { title: `Company Action` }, content: content,
      render: (event, html) => {
        const element = event?.target?.element ?? (event instanceof HTMLElement ? event : null);
        if (!element) return;
        const presetSelect = element.querySelector('#reign-action-preset');
        presetSelect.addEventListener('change', (ev) => {
          const val = ev.target.value;
          if (val !== "none" && companyActions[val]) {
            const action = companyActions[val];
            element.querySelector('#reign-q1').value = action.q1;
            element.querySelector('#reign-q2').value = action.q2;
            element.querySelector('#reign-diff').value = action.diff;
            element.querySelector('#reign-target').value = action.target;
            element.querySelector('#reign-cost').value = action.cost;
          }
        });
      },
      buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
        const f = d.element.querySelector("form"); 
        const presetKey = f.querySelector('[name="preset"]').value;
        return { 
            q1: f.querySelector('[name="q1"]').value, q2: f.querySelector('[name="q2"]').value,
            difficulty: parseInt(f.querySelector('[name="difficulty"]').value) || 0, mod: parseInt(f.querySelector('[name="mod"]').value) || 0,
            targetQuality: f.querySelector('[name="targetQuality"]').value, cost: f.querySelector('[name="cost"]').value,
            presetLabel: presetKey !== "none" ? companyActions[presetKey].label : null
        }; 
      }}] 
    });
    
    if (!rollData) return;
    
    let val1 = system.qualities[rollData.q1]?.current || 0;
    let val2 = rollData.q2 !== "none" ? (system.qualities[rollData.q2]?.current || 0) : 0;
    let intendedPool = val1 + val2 + rollData.mod;
    let diceToRoll = Math.min(intendedPool, 10);
    let wasCapped = intendedPool > 10;
    
    if (diceToRoll < 1) return ui.notifications.warn("Company dice pool reduced below 1. Action fails.");

    // FIXED: Evaluate roll BEFORE mutating actor state
    const roll = new Roll(`${diceToRoll}d10`); 
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];

    let costPaidNotice = "";
    if (rollData.cost !== "none") {
        let currentTemp = system.qualities[rollData.cost]?.current || 0;
        if (currentTemp > 0) {
            await actor.update({ [`system.qualities.${rollData.cost}.current`]: currentTemp - 1 });
            costPaidNotice = ` [Paid 1 Temp ${rollData.cost.toUpperCase()}]`;
        } else {
            ui.notifications.warn(`${actor.name} has 0 Temporary ${rollData.cost.toUpperCase()}! Proceeding desperately...`);
            costPaidNotice = ` [Desperate! 0 Temp ${rollData.cost.toUpperCase()}]`;
        }
    }

    let actionLabel = rollData.presetLabel ? `Company Action: ${rollData.presetLabel}` : `Company Action`;
    actionLabel += costPaidNotice;

    await postOREChat(actor, actionLabel, diceToRoll, results, 0, 0, null, { targetQuality: rollData.targetQuality, wasCapped: wasCapped, difficulty: rollData.difficulty });
  }

  // ==========================================
  // 3. THREAT ROLLER
  // ==========================================
  static async rollThreat(actor, dataset) {
    const system = actor.system;
    const basePool = system.threatLevel || 0;
    
    let content = `<form class="reign-dialog-form">
      <div class="form-group"><label>Base Threat Level:</label><input type="number" disabled value="${basePool}"/></div>
      <div class="dialog-grid dialog-grid-2">
        <div class="form-group"><label>Ganging Up / Bonus (+d):</label><input type="number" name="bonus" value="0"/></div>
        <div class="form-group"><label>Penalty Dice (-d):</label><input type="number" name="penalty" value="0"/></div>
      </div>
    </form>`;
    
    const rollData = await DialogV2.wait({
      classes: ["reign-dialog-window"], window: { title: `Roll Threat Action` }, content: content,
      buttons: [{ action: "roll", label: "Roll Horde", default: true, callback: (e, b, d) => {
          const f = d.element.querySelector("form");
          return { bonus: parseInt(f.querySelector('[name="bonus"]').value) || 0, penalty: parseInt(f.querySelector('[name="penalty"]').value) || 0 };
      }}]
    });
    
    if (!rollData) return;
    
    let intendedPool = basePool + rollData.bonus - rollData.penalty;
    let diceToRoll = Math.min(intendedPool, 15);
    let wasCapped = intendedPool > 15;
    
    if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced the horde's pool below 1. They hesitate!");
    
    const roll = new Roll(`${diceToRoll}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];
    
    // FIXED: Ensure damageFormula matches the auditor's expected structure
    const pseudoWeapon = { 
        type: "weapon", 
        name: actor.name, 
        system: { 
            damage: system.damageFormula || "Width Shock",
            damageFormula: system.damageFormula || "Width Shock"
        } 
    };
    
    await postOREChat(actor, "Horde Attack", diceToRoll, results, 0, 0, pseudoWeapon, { wasCapped, isAttack: true, isMinion: true });
  }
}