// scripts/helpers/reign-roller.js
const { DialogV2 } = foundry.applications.api;
import { parseORE, getEffectiveMax } from "./ore-engine.js";
import { postOREChat } from "./chat.js";
import { skillAttrMap } from "./config.js";

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
        const m = system.validCustomMoves ? system.validCustomMoves[key] : system.customMoves[key];
        if (!m) return ui.notifications.error("That custom move no longer exists.");
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

    // --- Weapon / Spell Readiness Check ---
    // AUDIT FIX 5.4b: Added spell casting time check
    if (type === "item" && itemRef && game.combat) {
        const combatant = game.combat.combatants.find(c => c.actorId === actor.id);
        if (combatant) {
            if (itemRef.type === "weapon" && itemRef.system.qualities?.slow > 0) {
                const cooldownUntil = combatant.getFlag("reign", "slowCooldown") || 0;
                if (game.combat.round <= cooldownUntil) return ui.notifications.warn(`${itemRef.name} is still being readied. Available on round ${cooldownUntil + 1}.`);
            } else if (itemRef.type === "spell" && itemRef.system.castingTime > 0) {
                const castCompleteRound = combatant.getFlag("reign", `spellCastRound_${itemRef.id}`) || 0;
                if (game.combat.round < castCompleteRound) return ui.notifications.warn(`${itemRef.name} is still being cast. It will fire on round ${castCompleteRound}.`);
            }
        }
    }

    // --- AIRTIGHT RAW: Massive Weapon Check ---
    if (type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.massive) {
        const bodyVal = system.attributes.body?.value || 0;
        if (bodyVal < 4) {
            return ui.notifications.error(`Cannot wield ${itemRef.name}. Massive weapons require a Body attribute of 4 or higher (Current: ${bodyVal}).`);
        }
    }

    // --- Penalties & Armor ---
    let isDazed = actor.statuses.has("dazed");

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
    
    // AUDIT FIX C2.1 (P1): Airtight RAW Shield & Armor Encumbrance Filter
    let encumbDiff = 0; let encumbPen = 0; let encumbImpossible = false;

    // 1. Tower Shields prevent Stealth and Climb entirely
    if (hasTower && (rawSkillKey === "stealth" || rawSkillKey === "climb")) {
        encumbImpossible = true;
    }

    // 2. Define specific skills affected by encumbrance strictly per RAW
    // RAW Ch6 p113: Heavy armor affects Climb, Run, Stealth, Endurance, Athletics
    const heavyPenaltySkills = ["climb", "run", "stealth", "endurance", "athletics"];
    // RAW Ch6 p113: Medium armor affects "Stealth, Climb, Run, Endurance, and Athletics"
    const mediumPenaltySkills = ["stealth", "climb", "run", "endurance", "athletics"];
    
    const isHeavyPenalty = heavyPenaltySkills.includes(rawSkillKey);
    const isMediumPenalty = mediumPenaltySkills.includes(rawSkillKey);

    // 3. Heavy Armor Penalties (Only for Movement)
    if (armorWeight === "heavy") {
        if (rawSkillKey === "stealth") encumbImpossible = true;
        if (isHeavyPenalty) {
            if (rawSkillKey === "climb" || rawSkillKey === "run") encumbPen = 2;
            if (rawSkillKey === "endurance" || rawSkillKey === "athletics") encumbDiff = 4;
        }
    } 
    
    // 4. Medium Armor / Shield Penalties (Difficulty 3)
    if ((armorWeight === "medium" || hasShield) && isMediumPenalty) {
        encumbDiff = Math.max(encumbDiff, 3);
    }

    if (encumbImpossible) return ui.notifications.error(`This action is impossible while ${hasTower ? "carrying a Tower Shield" : "wearing Heavy Armor"}. It auto-fails.`);

    // PHASE 2.2: Active Effect Interception
    const aePoolMod = parseInt(system.modifiers?.pool) || 0;
    let effectBonus = aePoolMod > 0 ? aePoolMod : 0;
    let effectPenalty = aePoolMod < 0 ? Math.abs(aePoolMod) : 0;

    let autoPenalty = effectPenalty; 
    let penaltyTitle = isDazed ? `DAZED (−1d)` : ``;
    
    if (effectPenalty > 0 && !isDazed) penaltyTitle = `Active Effects (−${effectPenalty}d)`;
    else if (effectPenalty > 1 && isDazed) penaltyTitle = `DAZED & Effects (−${effectPenalty}d)`;
    
    if ((isHeavyPenalty || isMediumPenalty) && (encumbPen > 0 || encumbDiff > 0)) {
        autoPenalty += encumbPen; 
        let reason = "Armor";
        if (hasShield && encumbPen === 0) reason = "Shield Defense";
        else if (hasShield) reason = "Armor & Shield";
        
        penaltyTitle += penaltyTitle.length > 0 ? ` & ${reason} (−${encumbPen}d, Diff ${encumbDiff})` : `${reason} (−${encumbPen}d, Diff ${encumbDiff})`;
    }

    let shieldBonus = 0;
    if (rawSkillKey === "parry") {
        if (hasShield) shieldBonus = Math.max(...equippedShields.map(s => s.system.parryBonus || 0));
    }

    let autoBonus = shieldBonus + effectBonus;

    const showSkillSelect = (type === "item");
    const isCombatRoll = (type === "item" && itemRef?.type === "weapon") || (type === "skill" && key === "fight") || (type === "move") || (type === "customSkill" && system.customSkills[key]?.isCombat);

    const aquaticSkills = ["athletics", "dodge", "endurance", "vigor", "stealth"];
    const showEnvContext = isCombatRoll || aquaticSkills.includes(rawSkillKey);

    let initialEdValue = hasExpert ? 10 : 0;
    let initialMdValue = hasMaster ? 1 : 0; 

    // --- Build Dialog ---
    let dialogTitle = `Roll ${label || "Action"}`;
    if (shieldBonus > 0) dialogTitle += ` (+${shieldBonus}d Shield Bonus)`;

    let content = `
    <div style="background: #1a1a1a; color: #fff; padding: 10px; text-align: center; font-size: 1.2em; font-weight: bold; border-radius: 4px; margin-bottom: 15px; border: 2px solid #000; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
      Expected Pool: <span id="pool-value" style="color: #4ade80;">...</span>
    </div>
    <form class="reign-dialog-form">
      <div class="form-group"><label>Attribute:</label><select name="attr">
        <option value="none">None</option>
        <option value="body" ${defaultAttr==="body"?"selected":""}>Body</option>
        <option value="coordination" ${defaultAttr==="coordination"?"selected":""}>Coordination</option>
        <option value="sense" ${defaultAttr==="sense"?"selected":""}>Sense</option>
        <option value="knowledge" ${defaultAttr==="knowledge"?"selected":""}>Knowledge</option>
        <option value="command" ${defaultAttr==="command"?"selected":""}>Command</option>
        <option value="charm" ${defaultAttr==="charm"?"selected":""}>Charm</option>
      </select></div>`;
      
    if (showSkillSelect) {
      let skOpts = `<option value="none">None</option>`;
      Object.keys(system.skills || {}).sort().forEach(sk => { skOpts += `<option value="static_${sk}" ${defaultSkill===("static_"+sk)?"selected":""}>${sk.toUpperCase()}</option>`; });
      if (system.customSkills) Object.entries(system.customSkills).forEach(([cid, cSk]) => { skOpts += `<option value="custom_${cid}" ${defaultSkill===("custom_"+cid)?"selected":""}>${(cSk.customLabel||"Custom").toUpperCase()}</option>`; });
      skOpts += `<option value="esoterica_sorcery" ${defaultSkill==="esoterica_sorcery"?"selected":""}>SORCERY</option>`;
      content += `<div class="form-group"><label>Linked Skill:</label><select name="skillKey">${skOpts}</select></div>`;
    }

    content += `<div class="dialog-grid ${isCombatRoll ? "dialog-grid-2" : ""}">`;
    if (isCombatRoll) {
      content += `
        <div class="form-group">
          <label>Called Shot (-1d):</label>
          <select name="calledShot">
            <option value="0">None</option><option value="10">Head (10)</option><option value="9">Torso High (9)</option><option value="8">Torso Mid (8)</option>
            <option value="7">Torso Low (7)</option><option value="6">Right Arm High (6)</option><option value="5">Right Arm Low (5)</option>
            <option value="4">Left Arm High (4)</option><option value="3">Left Arm Low (3)</option><option value="2">Right Leg (2)</option><option value="1">Left Leg (1)</option>
          </select>
        </div>`;
    }
    content += `
        <div class="form-group">
          <label>Difficulty (Min Height):</label>
          <input type="number" name="difficulty" value="${isMediumPenalty ? encumbDiff : 0}" min="0" max="10"/>
        </div>
      </div>`;
      
    if (showEnvContext) {
        content += `
        <div class="form-group" style="margin-top: 10px;">
            <label>Environment Context:</label>
            <select name="envContext">
                <option value="none">Normal Environment</option>
                <option value="swimming">Swimming (Highly restricted by Armor/Shields)</option>
            </select>
        </div>`;
    }

    content += `
      <div class="dialog-grid dialog-grid-3">
        <div class="form-group"><label>Total Actions:</label><input type="number" name="multiActions" value="1" min="1" title="Penalty: -1d per extra action"/></div>
        <div class="form-group"><label>Bonus Dice (+d):</label><input type="number" name="bonus" value="${autoBonus}"/></div>
        <div class="form-group"><label>Penalty Dice (-d):</label><input type="number" name="penalty" value="${autoPenalty}" title="${penaltyTitle}"/></div>
      </div>
        
      <div class="form-group">
        <label>Passions:</label>
        <div class="dialog-grid dialog-grid-3">
          <div style="display: flex; flex-direction: column; gap: 2px;"><label style="font-size: 0.75em;">Mission</label><select name="pMiss" style="font-size: 0.85em; padding: 2px;"><option value="1">Aligned (+1d)</option><option value="0" selected>Neutral</option><option value="-1">Against (-1d)</option></select></div>
          <div style="display: flex; flex-direction: column; gap: 2px;"><label style="font-size: 0.75em;">Duty</label><select name="pDuty" style="font-size: 0.85em; padding: 2px;"><option value="1">Aligned (+1d)</option><option value="0" selected>Neutral</option><option value="-1">Against (-1d)</option></select></div>
          <div style="display: flex; flex-direction: column; gap: 2px;"><label style="font-size: 0.75em;">Craving</label><select name="pCrav" style="font-size: 0.85em; padding: 2px;"><option value="1">Aligned (+1d)</option><option value="0" selected>Neutral</option><option value="-1">Against (-1d)</option></select></div>
        </div>
      </div>
      
      <div class="dialog-grid dialog-grid-2" style="margin-top: 15px;">
        <div class="form-group"><label>Expert Die (1-10, 0=None):</label><input type="number" name="ed" value="${initialEdValue}" min="0" max="10"/></div>
        <div class="form-group"><label>Master Dice (Max 1):</label><input type="number" name="md" value="${initialMdValue}" min="0" max="1"/></div>
      </div>
    </form>`;

    const rollData = await DialogV2.wait({ 
      classes: ["reign-dialog-window"], 
      window: { title: dialogTitle, resizable: true }, 
      content: content, 
      render: (event, html) => {
        let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
        if (!element) return;
        const f = element.querySelector("form");
        const poolPreviewSpan = element.querySelector("#pool-value");
        const edInput = element.querySelector('[name="ed"]');
        const mdInput = element.querySelector('[name="md"]');
        
        if (f) f.addEventListener("submit", e => e.preventDefault());
        if (!edInput || !mdInput || !f) return;

        // RAW ALGORITHM: LIVE PREVIEW MATH
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
          const ed = parseInt(f.querySelector('[name="ed"]')?.value) || 0;
          const md = parseInt(f.querySelector('[name="md"]')?.value) || 0;

          if (envContext === "swimming") {
              if (armorWeight === "heavy") {
                  poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Impossible (Heavy Armor)</span>`;
                  return;
              } else if (armorWeight === "medium") {
                  penalty += 2;
              }
          }

          let attrVal = attrKey !== "none" ? (system.attributes[attrKey]?.value || 0) : 0;
          let itemSkillValue = 0;
          if (showSkillSelect && skillKey !== "none") {
              if (skillKey.startsWith("static_")) itemSkillValue = system.skills[skillKey.replace("static_", "")]?.value || 0;
              else if (skillKey.startsWith("custom_")) itemSkillValue = system.customSkills[skillKey.replace("custom_", "")]?.value || 0;
              else if (skillKey === "esoterica_sorcery") itemSkillValue = system.esoterica.sorcery || 0;
          }

          let rawTotal = baseValue + attrVal + itemSkillValue + bonus + passionBonus;

          // 1. Determine active Special Dice & Penalties (AUDIT FIX 3.2: Called Shot logic)
          let actualMd = md > 0 ? 1 : 0;
          let actualEd = ed > 0 ? 1 : 0;
          let actualCs = 0;
          let appliedCsPenalty = 0;

          if (calledShot > 0) {
              if (actualMd > 0) {
                  // Handled by UI exclusivity (MD bypasses Called Shot necessity)
              } else if (actualEd > 0) {
                  // ED assumes the role of the called shot die, but the -1d penalty is STILL applied to the pool
                  appliedCsPenalty = 1;
              } else {
                  actualCs = 1;
                  appliedCsPenalty = 1;
              }
          }

          let specialDiceCount = actualMd + actualEd + actualCs;
          let normalDiceCount = Math.max(0, rawTotal - specialDiceCount);

          let multiActionPenalty = multiActions > 1 ? (multiActions - 1) : 0;
          let totalPenalty = penalty + multiActionPenalty + appliedCsPenalty;

          // 2. Overflow calculation (Raw dice exceeding 10 act as an ablative buffer)
          let totalPoolBeforePenalty = normalDiceCount + specialDiceCount;
          let overflow = Math.max(0, totalPoolBeforePenalty - 10);
          
          // 3. Net Penalty (after overflow absorption)
          let netPenalty = Math.max(0, totalPenalty - overflow);

          // 4. Penalties eat Master Dice first (most expensive)
          if (netPenalty > 0 && actualMd > 0) { actualMd = 0; netPenalty--; }
          
          // 5. Then Called Shot / Expert Dice
          if (netPenalty > 0 && actualCs > 0) { actualCs = 0; netPenalty--; }
          if (netPenalty > 0 && actualEd > 0) { actualEd = 0; netPenalty--; }
          
          // 6. Finally, standard Normal Dice are eaten
          if (netPenalty > 0) {
              let normalLoss = Math.min(normalDiceCount, netPenalty);
              normalDiceCount -= normalLoss;
              netPenalty -= normalLoss;
          }

          // 7. Re-apply Cap Constraints
          let survivingSpecial = actualMd + actualEd + actualCs;
          normalDiceCount = Math.min(normalDiceCount, 10 - survivingSpecial);
          let diceToRoll = normalDiceCount + survivingSpecial;

          if (diceToRoll < 1) {
              poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Action Fails (Pool < 1)</span>`;
          } else if (survivingSpecial > diceToRoll) {
              poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Too many Special Dice</span>`;
          } else {
              let displayStr = `${normalDiceCount}d10`;
              if (actualEd > 0) displayStr += ` <span style="color:#42a5f5;">+ 1 ED (${ed})</span>`;
              if (actualMd > 0) displayStr += ` <span style="color:#ab47bc;">+ 1 MD</span>`;
              if (actualCs > 0) displayStr += ` <span style="color:#ef5350;">+ Called Shot (${calledShot})</span>`;
              if (totalPoolBeforePenalty > 10) displayStr += ` <span style="font-size:0.8em; color:#aaa; font-weight: normal;">(Capped at 10)</span>`;
              
              poolPreviewSpan.innerHTML = displayStr;
          }
        };

        const enforceExclusivity = () => {
          if ((parseInt(edInput.value) || 0) > 0) { mdInput.value = 0; mdInput.disabled = true; } else mdInput.disabled = false;
          if ((parseInt(mdInput.value) || 0) > 0) { edInput.value = 0; edInput.disabled = true; } else edInput.disabled = false;
          updatePool();
        };

        edInput.addEventListener("input", enforceExclusivity); 
        mdInput.addEventListener("input", enforceExclusivity); 

        f.querySelectorAll("input, select").forEach(input => {
            input.addEventListener("input", updatePool);
            input.addEventListener("change", updatePool);
        });

        enforceExclusivity(); 
      },
      buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
        const f = d.element.querySelector("form"); 
        
        const data = { 
          attr: f.querySelector('[name="attr"]')?.value || "none", skillKey: f.querySelector('[name="skillKey"]')?.value || "none",
          envContext: f.querySelector('[name="envContext"]')?.value || "none",
          calledShot: parseInt(f.querySelector('[name="calledShot"]')?.value) || 0, difficulty: parseInt(f.querySelector('[name="difficulty"]')?.value) || 0,
          multiActions: Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1),
          bonus: parseInt(f.querySelector('[name="bonus"]')?.value) || 0, penalty: parseInt(f.querySelector('[name="penalty"]')?.value) || 0, 
          passionBonus: (parseInt(f.querySelector('[name="pMiss"]')?.value) || 0) + (parseInt(f.querySelector('[name="pDuty"]')?.value) || 0) + (parseInt(f.querySelector('[name="pCrav"]')?.value) || 0),
          ed: parseInt(f.querySelector('[name="ed"]')?.value) || 0, md: parseInt(f.querySelector('[name="md"]')?.value) || 0 
        }; 

        d.close({ animate: false });
        return data;
      }}] 
    });
    
    if (!rollData) return;

    if (rollData.envContext === "swimming") {
        if (armorWeight === "heavy") return ui.notifications.error("Swimming in Heavy Armor is impossible. You sink immediately.");
        else if (armorWeight === "medium") {
            rollData.penalty += 2;
            ui.notifications.warn("Swimming in Medium Armor applies a −2d penalty.");
        }
    }
    
    let attrVal = rollData.attr !== "none" ? (system.attributes[rollData.attr]?.value || 0) : 0;
    let itemSkillValue = 0;
    if (showSkillSelect && rollData.skillKey !== "none") {
        if (rollData.skillKey.startsWith("static_")) itemSkillValue = system.skills[rollData.skillKey.replace("static_", "")]?.value || 0;
        else if (rollData.skillKey.startsWith("custom_")) itemSkillValue = system.customSkills[rollData.skillKey.replace("custom_", "")]?.value || 0;
        else if (rollData.skillKey === "esoterica_sorcery") itemSkillValue = system.esoterica.sorcery || 0;
    }

    if (rollData.ed > 0 && rollData.md > 0) return ui.notifications.error("Reign rules forbid using both Expert and Master dice simultaneously.");

    // RAW ALGORITHM: ROLL EXECUTION MATH
    let rawTotal = baseValue + attrVal + itemSkillValue + rollData.bonus + rollData.passionBonus;

    let actualMd = rollData.md > 0 ? 1 : 0; 
    let actualEd = rollData.ed > 0 ? 1 : 0;
    let actualCs = 0;
    let appliedCsPenalty = 0;

    // AUDIT FIX 3.2: Airtight Called Shot Penalty Enforcement
    if (rollData.calledShot > 0) {
        if (actualMd > 0) {
            ui.notifications.warn("Called shots are unnecessary with a Master Die.");
            rollData.calledShot = 0;
        } else if (actualEd > 0) {
            // ED acts as the called shot die, but the -1d penalty is STILL applied to the pool
            rollData.ed = rollData.calledShot;
            appliedCsPenalty = 1;
        } else {
            actualCs = 1;
            appliedCsPenalty = 1;
        }
    }

    let specialDiceCount = actualMd + actualEd + actualCs;
    let normalDiceCount = Math.max(0, rawTotal - specialDiceCount);

    let multiActionPenalty = rollData.multiActions > 1 ? (rollData.multiActions - 1) : 0;
    let totalPenalty = rollData.penalty + multiActionPenalty + appliedCsPenalty;

    let totalPoolBeforePenalty = normalDiceCount + specialDiceCount;
    let overflow = Math.max(0, totalPoolBeforePenalty - 10);
    
    let netPenalty = Math.max(0, totalPenalty - overflow);

    // 1. Penalties eat Master Dice first
    if (netPenalty > 0 && actualMd > 0) { actualMd = 0; netPenalty--; }
    
    // 2. Then Called Shot / Expert Dice
    if (netPenalty > 0 && actualCs > 0) { actualCs = 0; rollData.calledShot = 0; netPenalty--; }
    if (netPenalty > 0 && actualEd > 0) { actualEd = 0; netPenalty--; }
    
    // 3. Finally standard Normal Dice
    if (netPenalty > 0) {
        let normalLoss = Math.min(normalDiceCount, netPenalty);
        normalDiceCount -= normalLoss;
        netPenalty -= normalLoss;
    }

    // 4. Re-apply Cap Constraints
    let survivingSpecial = actualMd + actualEd + actualCs;
    normalDiceCount = Math.min(normalDiceCount, 10 - survivingSpecial);
    let diceToRoll = normalDiceCount + survivingSpecial;
    let wasCapped = totalPoolBeforePenalty > 10;

    if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced your dice pool below 1. Action fails.");

    // AUDIT FIX 5.4b: Set combat flag if casting a spell with castingTime > 0
    if (type === "item" && itemRef?.type === "spell" && itemRef.system.castingTime > 0 && game.combat) {
        const combatant = game.combat.combatants.find(c => c.actorId === actor.id);
        if (combatant) {
            const castCompleteRound = game.combat.round + itemRef.system.castingTime;
            await combatant.setFlag("reign", `spellCastRound_${itemRef.id}`, castCompleteRound);
            ui.notifications.info(`${itemRef.name} casting started! It will resolve on round ${castCompleteRound}.`);
            // We exit here instead of evaluating the roll, because the actual casting happens later
            return;
        }
    }

    let results = [];
    if (normalDiceCount > 0) {
      const roll = new Roll(`${normalDiceCount}d10`);
      await roll.evaluate();
      results = roll.dice[0]?.results.map(r => r.result) || [];
    }
    
    if (actualEd > 0) results.push(rollData.ed);
    if (actualCs > 0) results.push(rollData.calledShot);
    
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
        classes: ["reign-dialog-window"], 
        window: { title: "Assign Master Dice", resizable: true }, 
        content: mdHtml,
        render: (event, html) => {
            let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
            if (!element) return;
            const f = element.querySelector("form");
            if (f) f.addEventListener("submit", e => e.preventDefault());
        },
        buttons: [{ action: "assign", label: "Finalize Sets", default: true, callback: (e, b, d) => {
            const faces = [];
            for(let i=0; i<actualMd; i++) faces.push(parseInt(d.element.querySelector(`#mdFace${i}`).value) || 10);
            d.close({ animate: false });
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
    
    // AUDIT FIX 4.1: Strictly aligned RAW Company Action Catalog
    const companyActions = {
      "none": { label: "-- Custom Action --", q1: "none", q2: "none", target: "none", diff: 0, cost: "none" },
      "attack": { label: "Attack", q1: "might", q2: "treasure", target: "might", diff: 0, cost: "none" },
      "being_informed": { label: "Being Informed", q1: "influence", q2: "sovereignty", target: "influence", diff: 0, cost: "none" },
      "counter_espionage": { label: "Counter-Espionage", q1: "influence", q2: "territory", target: "influence", diff: 0, cost: "none" },
      "defend": { label: "Defend", q1: "might", q2: "territory", target: "none", diff: 0, cost: "none" },
      "espionage": { label: "Espionage", q1: "influence", q2: "treasure", target: "influence", diff: 0, cost: "none" },
      "improve_culture": { label: "Improve the Culture", q1: "territory", q2: "treasure", target: "none", diff: 0, cost: "none" },
      "policing": { label: "Policing", q1: "might", q2: "sovereignty", target: "influence", diff: 0, cost: "none" },
      "rise_in_stature": { label: "Rise in Stature", q1: "sovereignty", q2: "treasure", target: "none", diff: 0, cost: "none" },
      "train_and_levy_troops": { label: "Train and Levy Troops", q1: "sovereignty", q2: "territory", target: "none", diff: 0, cost: "none" },
      "unconventional_warfare": { label: "Unconventional Warfare", q1: "influence", q2: "might", target: "might", diff: 0, cost: "none" }
    };

    let presetOptions = Object.entries(companyActions).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    const qualityOptions = `<option value="none">None</option><option value="might">Might</option><option value="treasure">Treasure</option><option value="influence">Influence</option><option value="territory">Territory</option><option value="sovereignty">Sovereignty</option>`;

    let content = `
    <div style="background: #1a1a1a; color: #fff; padding: 10px; text-align: center; font-size: 1.2em; font-weight: bold; border-radius: 4px; margin-bottom: 15px; border: 2px solid #000; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
      Expected Pool: <span id="pool-value" style="color: #4ade80;">...</span>
    </div>
    <form class="reign-dialog-form">
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
        <div class="form-group"><label style="color: #d97706;">Action Cost (Pay 1 Temp):</label><select name="cost" id="reign-cost">${qualityOptions.replace('value="none"', 'value="none" selected').replace("None", "None (Free)")}</select></div>
        <div class="form-group"><label>Target Quality (If Attacking):</label><select name="targetQuality" id="reign-target">${qualityOptions}</select></div>
      </div>
    </form>`;
    
    const rollData = await DialogV2.wait({ 
      classes: ["reign-dialog-window"], 
      window: { title: "Company Action", resizable: true }, 
      content: content,
      render: (event, html) => {
        const element = event?.target?.element ?? (event instanceof HTMLElement ? event : null);
        if (!element) return;
        const f = element.querySelector("form");
        const poolPreviewSpan = element.querySelector("#pool-value");
        
        if (f) f.addEventListener("submit", e => e.preventDefault());
        if (!f || !poolPreviewSpan) return;

        const updatePool = () => {
          const q1 = f.querySelector('[name="q1"]').value;
          const q2 = f.querySelector('[name="q2"]').value;
          const mod = parseInt(f.querySelector('[name="mod"]').value) || 0;
          
          let val1 = system.qualities[q1]?.current || 0;
          let val2 = q2 !== "none" ? (system.qualities[q2]?.current || 0) : 0;
          let intendedPool = val1 + val2 + mod;
          let diceToRoll = Math.min(intendedPool, 10);
          
          if (diceToRoll < 1) {
              poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Action Fails (Pool < 1)</span>`;
          } else {
              let displayStr = `${diceToRoll}d10`;
              if (intendedPool > 10) displayStr += ` <span style="font-size:0.8em; color:#aaa; font-weight: normal;">(Capped at 10)</span>`;
              poolPreviewSpan.innerHTML = displayStr;
          }
        };

        const presetSelect = element.querySelector("#reign-action-preset");
        presetSelect.addEventListener("change", (ev) => {
          const val = ev.target.value;
          if (val !== "none" && companyActions[val]) {
            const action = companyActions[val];
            element.querySelector("#reign-q1").value = action.q1;
            element.querySelector("#reign-q2").value = action.q2;
            element.querySelector("#reign-diff").value = action.diff;
            element.querySelector("#reign-target").value = action.target;
            element.querySelector("#reign-cost").value = action.cost;
            updatePool();
          }
        });

        f.querySelectorAll("input, select").forEach(input => {
            input.addEventListener("input", updatePool);
            input.addEventListener("change", updatePool);
        });

        updatePool();
      },
      buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
        const f = d.element.querySelector("form"); 
        const presetKey = f.querySelector('[name="preset"]').value;
        const data = { 
            q1: f.querySelector('[name="q1"]').value, q2: f.querySelector('[name="q2"]').value,
            difficulty: parseInt(f.querySelector('[name="difficulty"]').value) || 0, mod: parseInt(f.querySelector('[name="mod"]').value) || 0,
            targetQuality: f.querySelector('[name="targetQuality"]').value, cost: f.querySelector('[name="cost"]').value,
            presetLabel: presetKey !== "none" ? companyActions[presetKey].label : null
        }; 

        d.close({ animate: false });
        return data;
      }}] 
    });
    
    if (!rollData) return;
    
    let val1 = system.qualities[rollData.q1]?.current || 0;
    let val2 = rollData.q2 !== "none" ? (system.qualities[rollData.q2]?.current || 0) : 0;
    let intendedPool = val1 + val2 + rollData.mod;
    let diceToRoll = Math.min(intendedPool, 10);
    let wasCapped = intendedPool > 10;
    
    if (diceToRoll < 1) return ui.notifications.warn("Company dice pool reduced below 1. Action fails.");

    const roll = new Roll(`${diceToRoll}d10`); 
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];

    let costPaidNotice = "";
    if (rollData.cost !== "none") {
        const latestActor = game.actors.get(actor.id);
        let currentTemp = latestActor.system.qualities[rollData.cost]?.current || 0;
        
        if (currentTemp > 0) {
            await latestActor.update({ [`system.qualities.${rollData.cost}.current`]: currentTemp - 1 });
            costPaidNotice = ` [Paid 1 Temp ${rollData.cost.toUpperCase()}]`;
        } else {
            ui.notifications.warn(`${latestActor.name} has 0 Temporary ${rollData.cost.toUpperCase()}! Proceeding desperately...`);
            costPaidNotice = ` [Desperate! 0 Temp ${rollData.cost.toUpperCase()}]`;
        }
    }

    let actionLabel = rollData.presetLabel ? `Company Action: ${rollData.presetLabel}` : "Company Action";
    actionLabel += costPaidNotice;

    await postOREChat(actor, actionLabel, diceToRoll, results, 0, 0, null, { targetQuality: rollData.targetQuality, wasCapped: wasCapped, difficulty: rollData.difficulty });
  }

  // ==========================================
  // 3. THREAT ROLLER
  // ==========================================
  static async rollThreat(actor, dataset) {
    const system = actor.system;
    const basePool = system.threatLevel || 0;
    
    let content = `
    <div style="background: #1a1a1a; color: #fff; padding: 10px; text-align: center; font-size: 1.2em; font-weight: bold; border-radius: 4px; margin-bottom: 15px; border: 2px solid #000; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
      Expected Pool: <span id="pool-value" style="color: #4ade80;">...</span>
    </div>
    <form class="reign-dialog-form">
      <div class="form-group"><label>${game.i18n.localize("REIGN.ThreatLevel")}:</label><input type="number" disabled value="${basePool}"/></div>
      <div class="dialog-grid dialog-grid-2">
        <div class="form-group"><label>Ganging Up / Bonus (+d):</label><input type="number" name="bonus" value="0"/></div>
        <div class="form-group"><label>Penalty Dice (-d):</label><input type="number" name="penalty" value="0"/></div>
      </div>
    </form>`;
    
    const rollData = await DialogV2.wait({
      classes: ["reign-dialog-window"], 
      window: { title: game.i18n.localize("REIGN.RollThreatAction"), resizable: true }, 
      content: content,
      render: (event, html) => {
        const element = event?.target?.element ?? (event instanceof HTMLElement ? event : null);
        if (!element) return;
        const f = element.querySelector("form");
        const poolPreviewSpan = element.querySelector("#pool-value");
        
        if (f) f.addEventListener("submit", e => e.preventDefault());
        if (!f || !poolPreviewSpan) return;

        const updatePool = () => {
          const bonus = parseInt(f.querySelector('[name="bonus"]').value) || 0;
          const penalty = parseInt(f.querySelector('[name="penalty"]').value) || 0;
          
          let intendedPool = basePool + bonus - penalty;
          let diceToRoll = Math.min(intendedPool, 15);
          
          if (diceToRoll < 1) {
              poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Action Fails (Pool < 1)</span>`;
          } else {
              let displayStr = `${diceToRoll}d10`;
              if (intendedPool > 15) displayStr += ` <span style="font-size:0.8em; color:#aaa; font-weight: normal;">(Capped at 15)</span>`;
              poolPreviewSpan.innerHTML = displayStr;
          }
        };

        f.querySelectorAll("input").forEach(input => {
            input.addEventListener("input", updatePool);
            input.addEventListener("change", updatePool);
        });

        updatePool();
      },
      buttons: [{ action: "roll", label: game.i18n.localize("REIGN.RollThreatAction"), default: true, callback: (e, b, d) => {
          const f = d.element.querySelector("form");
          const data = { bonus: parseInt(f.querySelector('[name="bonus"]').value) || 0, penalty: parseInt(f.querySelector('[name="penalty"]').value) || 0 };
          d.close({ animate: false });
          return data;
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
    
    const pseudoWeapon = { 
        type: "weapon", 
        name: actor.name, 
        system: { 
            damage: system.damageFormula || "Width Shock",
            damageFormula: system.damageFormula || "Width Shock"
        } 
    };
    
    await postOREChat(actor, game.i18n.localize("REIGN.RollThreatAction"), diceToRoll, results, 0, 0, pseudoWeapon, { wasCapped, isAttack: true, isMinion: true });
  }

  // ==========================================
  // 4. WEALTH / HAGGLE ROLLER
  // ==========================================
  static async rollWealthPurchase(actor) {
    const system = actor.system;
    const currentWealth = system.wealth?.value || 0;

    const content = `
      <form class="reign-dialog-form">
        <div class="form-group" style="text-align: center; margin-bottom: 15px;">
          <label>Your Current Wealth</label>
          <div style="font-size: 2em; font-weight: bold; color: #8b1f1f;">${currentWealth}</div>
        </div>
        <div class="form-group">
          <label>Cost of the Item you want to buy (1-10):</label>
          <input type="number" name="cost" value="1" min="1" max="10"/>
        </div>
      </form>
    `;

    const result = await DialogV2.wait({
      classes: ["reign-dialog-window"],
      window: { title: game.i18n.localize("REIGN.PurchaseHelper"), resizable: true },
      content: content,
      render: (event, html) => {
        let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
        if (!element) return;
        const f = element.querySelector("form");
        if (f) f.addEventListener("submit", e => e.preventDefault());
      },
      buttons: [{
        action: "check",
        label: "Check Affordability",
        default: true,
        callback: (e, b, d) => {
          const val = parseInt(d.element.querySelector('[name="cost"]').value) || 0;
          d.close({ animate: false });
          return val;
        }
      }]
    });

    if (result === undefined || result === null) return;
    await new Promise(resolve => setTimeout(resolve, 250)); // Breather
    const cost = result;

    if (cost < currentWealth) {
      await ChatMessage.create({ 
        speaker: ChatMessage.getSpeaker({actor: actor}), 
        content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Trivial Purchase</h3><p>Item Cost (${cost}) is below Wealth (${currentWealth}). The purchase is trivial and succeeds automatically.</p></div>` 
      });
      await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "Purchase Trivial", resizable: true },
        content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Cost ${cost} is below your Wealth ${currentWealth}.<br><br><strong>The purchase is trivial and costs nothing!</strong></p></div>`,
        render: (event, html) => {
          let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
          if (element) {
              const f = element.querySelector("form");
              if (f) f.addEventListener("submit", e => e.preventDefault());
          }
        },
        buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
      });
    } else if (cost > currentWealth) {
      await ChatMessage.create({ 
        speaker: ChatMessage.getSpeaker({actor: actor}), 
        content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Purchase Impossible</h3><p>Item Cost (${cost}) exceeds Wealth (${currentWealth}). The character cannot afford this item.</p></div>` 
      });
      await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "Purchase Impossible", resizable: true },
        content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Cost ${cost} exceeds your Wealth ${currentWealth}.<br><br><strong>You cannot afford this item.</strong></p></div>`,
        render: (event, html) => {
          let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
          if (element) {
              const f = element.querySelector("form");
              if (f) f.addEventListener("submit", e => e.preventDefault());
          }
        },
        buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
      });
    } else {
      // AUDIT FIX 4.2: Wealth Bargaining Gap resolved.
      const confirmContent = `
        <div class="reign-dialog-form">
          <p>This item's Cost (${cost}) equals your current Wealth.</p>
          <p>You can outright buy it and <strong>lose 1 Wealth</strong>, or attempt to save your wealth by rolling <strong>Wealth</strong> or <strong>Command + Haggle</strong>.</p>
          <p><em>(On a success, you keep your Wealth. On a failure, it drops by 1.)</em></p>
        </div>
      `;
      const action = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "Significant Purchase", resizable: true },
        content: confirmContent,
        render: (event, html) => {
          let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
          if (element) {
              const f = element.querySelector("form");
              if (f) f.addEventListener("submit", e => e.preventDefault());
          }
        },
        buttons: [
          { action: "buy", label: "Pay 1 Wealth", callback: (e, b, d) => { d.close({ animate: false }); return "buy"; } },
          { action: "roll_wealth", label: "Roll Wealth", callback: (e, b, d) => { d.close({ animate: false }); return "roll_wealth"; } },
          { action: "haggle", label: "Roll Haggle", callback: (e, b, d) => { d.close({ animate: false }); return "haggle"; } }
        ]
      });

      if (!action) return;
      await new Promise(resolve => setTimeout(resolve, 250)); // Breather

      if (action === "buy") {
        const newWealth = Math.max(0, currentWealth - 1);
        await actor.update({ "system.wealth.value": newWealth });
        
        await ChatMessage.create({ 
          speaker: ChatMessage.getSpeaker({actor: actor}), 
          content: `<div class="reign-chat-card"><h3 style="color: #d97706;">Significant Purchase</h3><p>Item Cost (${cost}) equals Wealth. Paid outright. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
        });

        await DialogV2.wait({
          classes: ["reign-dialog-window"],
          window: { title: "Purchase Complete", resizable: true },
          content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Purchased!<br><br>Your Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
          render: (event, html) => {
            let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
            if (element) {
                const f = element.querySelector("form");
                if (f) f.addEventListener("submit", e => e.preventDefault());
            }
          },
          buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
        });
      } else if (action === "roll_wealth") {
        if (currentWealth < 2) {
          const newWealth = Math.max(0, currentWealth - 1);
          await actor.update({ "system.wealth.value": newWealth });
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: actor}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Wealth Roll Failed</h3><p>Wealth pool is too small to attempt a roll. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
          });
          await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Wealth Roll Failed", resizable: true },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Wealth pool is too small to attempt a roll (Requires at least 2 dice).<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
            render: (event, html) => {
              let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
              if (element) {
                  const f = element.querySelector("form");
                  if (f) f.addEventListener("submit", e => e.preventDefault());
              }
            },
            buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
          });
          return;
        }

        let diceToRoll = Math.min(currentWealth, 10);
        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        
        const parsed = parseORE(results);
        if (parsed.sets.length > 0) {
            await postOREChat(actor, "Wealth Roll (Purchase)", currentWealth, results, 0, 0);
            await DialogV2.wait({
              classes: ["reign-dialog-window"],
              window: { title: "Purchase Succeeded", resizable: true },
              content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Roll succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p></div>`,
              render: (event, html) => {
                let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                if (element) {
                    const f = element.querySelector("form");
                    if (f) f.addEventListener("submit", e => e.preventDefault());
                }
              },
              buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
            });
        } else {
            const newWealth = Math.max(0, currentWealth - 1);
            await actor.update({ "system.wealth.value": newWealth });
            await postOREChat(actor, "Wealth Roll (Purchase)", currentWealth, results, 0, 0);
            await DialogV2.wait({
              classes: ["reign-dialog-window"],
              window: { title: "Purchase Failed", resizable: true },
              content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #d97706;">Roll failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
              render: (event, html) => {
                let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                if (element) {
                    const f = element.querySelector("form");
                    if (f) f.addEventListener("submit", e => e.preventDefault());
                }
              },
              buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
            });
        }
      } else if (action === "haggle") {
        const commandVal = system.attributes.command?.value || 0;
        const haggleVal = system.skills.haggle?.value || 0;
        let hasEd = system.skills.haggle?.expert;
        let hasMd = system.skills.haggle?.master;
        const pool = commandVal + haggleVal;

        if (hasEd && hasMd) {
            hasEd = false;
        }
        
        let specialDiceCount = (hasEd ? 1 : 0) + (hasMd ? 1 : 0);
        
        if (pool < 2) {
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: actor}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Haggle Failed</h3><p>Command + Haggle pool is too small to attempt haggling.</p></div>` 
          });
          await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Haggle Failed", resizable: true },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Command + Haggle pool is too small to attempt haggling (Requires at least 2 dice).</p></div>`,
            render: (event, html) => {
              let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
              if (element) {
                  const f = element.querySelector("form");
                  if (f) f.addEventListener("submit", e => e.preventDefault());
              }
            },
            buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
          });
          return;
        }

        let edFace = 10;
        if (hasEd) {
            const edChoice = await DialogV2.wait({
                classes: ["reign-dialog-window"],
                window: { title: "Set Expert Die (Haggle)", resizable: true },
                content: `<form class="reign-dialog-form"><div class="form-group"><label>Expert Die Face:</label><input type="number" name="edFace" value="10" min="1" max="10"/></div></form>`,
                render: (event, html) => {
                  let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                  if (element) {
                      const f = element.querySelector("form");
                      if (f) f.addEventListener("submit", e => e.preventDefault());
                  }
                },
                buttons: [{
                  action: "set", label: "Roll Haggle", default: true,
                  callback: (event, button, dialog) => {
                    const val = parseInt(dialog.element.querySelector('[name="edFace"]').value) || 10;
                    dialog.close({ animate: false });
                    return val;
                  }
                }]
            });
            
            if (!edChoice) return;
            await new Promise(resolve => setTimeout(resolve, 250)); // Breather
            edFace = edChoice || 10;
        }

        let diceToRoll = Math.min(pool, 10);
        let randomDiceCount = Math.max(0, diceToRoll - specialDiceCount);
        let results = [];

        if (randomDiceCount > 0) {
          const roll = new Roll(`${randomDiceCount}d10`);
          await roll.evaluate();
          results = roll.dice[0]?.results.map(r => r.result) || [];
        }

        if (hasEd) results.push(edFace);
        
        const finalizeHaggle = async (finalResults, mdCount, edCount, edVal) => {
            const parsed = parseORE(finalResults);
            if (parsed.sets.length > 0) {
              await postOREChat(actor, "Haggle (Purchase)", pool, finalResults, edCount > 0 ? edVal : 0, mdCount);
              await DialogV2.wait({
                classes: ["reign-dialog-window"],
                window: { title: "Haggle Succeeded", resizable: true },
                content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Haggle succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p></div>`,
                render: (event, html) => {
                  let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                  if (element) {
                      const f = element.querySelector("form");
                      if (f) f.addEventListener("submit", e => e.preventDefault());
                  }
                },
                buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
              });
            } else {
              const newWealth = Math.max(0, currentWealth - 1);
              await actor.update({ "system.wealth.value": newWealth });
              await postOREChat(actor, "Haggle (Purchase)", pool, finalResults, edCount > 0 ? edVal : 0, mdCount);
              await DialogV2.wait({
                classes: ["reign-dialog-window"],
                window: { title: "Haggle Failed", resizable: true },
                content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #d97706;">Haggle failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
                render: (event, html) => {
                  let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                  if (element) {
                      const f = element.querySelector("form");
                      if (f) f.addEventListener("submit", e => e.preventDefault());
                  }
                },
                buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { d.close({ animate: false }); } }]
              });
            }
        };

        if (hasMd) {
          results.sort((a, b) => b - a); 
          let mdHtml = `<form class="reign-dialog-form">
            <p style="margin-top: 0; font-size: 1.1em;"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
            <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Assign a face value to your Master Die to complete your Haggle set.</p>
            <div class="form-group"><label>Master Die Face:</label><input type="number" name="mdFace" value="10" min="1" max="10"/></div>
            </form>`;

          const mdResult = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Assign Master Die (Haggle)", resizable: true },
            content: mdHtml,
            render: (event, html) => {
              let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
              if (element) {
                  const f = element.querySelector("form");
                  if (f) f.addEventListener("submit", e => e.preventDefault());
              }
            },
            buttons: [{
              action: "assign", label: "Finalize Haggle", default: true,
              callback: (event, button, dialog) => {
                const val = parseInt(dialog.element.querySelector('[name="mdFace"]').value) || 10;
                dialog.close({ animate: false });
                return val;
              }
            }]
          });

          if (!mdResult) return;
          await new Promise(resolve => setTimeout(resolve, 250)); // Breather
          
          results.push(mdResult);
          await finalizeHaggle(results, 1, hasEd ? 1 : 0, edFace);
        } else {
          await finalizeHaggle(results, 0, hasEd ? 1 : 0, edFace);
        }
      }
    }
  }
}