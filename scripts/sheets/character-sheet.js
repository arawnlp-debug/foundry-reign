// scripts/sheets/character-sheet.js
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

// FIXED: Imported getEffectiveMax to use the secure, centralized hook parser
import { parseORE, getEffectiveMax } from "../helpers/ore-engine.js";
import { postOREChat } from "../helpers/chat.js";
import { OneRollGenerator } from "../generators/one-roll.js";

export class ReignActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor"], position: { width: 800, height: 850 }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      generateCharacter: async function(event, target) {
        await OneRollGenerator.start(this.document);
      },
      recoverShock: async function(event, target) {
        const system = this.document.system;
        const updates = {};
        let totalRecovered = 0;

        // FIXED: Loop through all locations and remove half the shock (round up per RAW)
        ["head", "torso", "armR", "armL", "legR", "legL"].forEach(loc => {
          let currentShock = system.health[loc].shock || 0;
          if (currentShock > 0) {
            let newShock = currentShock - Math.ceil(currentShock / 2); 
            totalRecovered += (currentShock - newShock);
            updates[`system.health.${loc}.shock`] = newShock;
          }
        });

        // Apply updates and post to chat if they actually healed
        if (totalRecovered > 0) {
          await this.document.update(updates);
          const safeName = foundry.utils.escapeHTML(this.document.name);
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Post-Combat Recovery</h3><p>Catching their breath, ${safeName} recovers <strong>${totalRecovered} Shock</strong> damage across their body.</p></div>`
          });
        } else {
          ui.notifications.info(`${this.document.name} has no Shock damage to recover.`);
        }
      },
      purchaseHelper: async function(event, target) {
        const system = this.document.system;
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
          window: { title: game.i18n.localize("REIGN.PurchaseHelper") },
          content: content,
          buttons: [{
            action: "check",
            label: "Check Affordability",
            default: true,
            callback: (e, b, d) => parseInt(d.element.querySelector('[name="cost"]').value) || 0
          }]
        });

        if (!result) return;
        const cost = result;

        if (cost < currentWealth) {
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: this.document}), 
            content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Trivial Purchase</h3><p>Item Cost (${cost}) is below Wealth (${currentWealth}). The purchase is trivial and succeeds automatically.</p></div>` 
          });
          await DialogV2.prompt({
            classes: ["reign-dialog-window"],
            window: { title: "Purchase Trivial" },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Cost ${cost} is below your Wealth ${currentWealth}.<br><br><strong>The purchase is trivial and costs nothing!</strong></p></div>`,
            rejectClose: false
          });
        } else if (cost > currentWealth) {
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: this.document}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Purchase Impossible</h3><p>Item Cost (${cost}) exceeds Wealth (${currentWealth}). The character cannot afford this item.</p></div>` 
          });
          await DialogV2.prompt({
            classes: ["reign-dialog-window"],
            window: { title: "Purchase Impossible" },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Cost ${cost} exceeds your Wealth ${currentWealth}.<br><br><strong>You cannot afford this item.</strong></p></div>`,
            rejectClose: false
          });
        } else {
          const confirmContent = `
            <div class="reign-dialog-form">
              <p>This item's Cost (${cost}) equals your current Wealth.</p>
              <p>You can outright buy it and <strong>lose 1 Wealth</strong>, or attempt to <strong>Haggle</strong>.</p>
              <p><em>(Haggling will automatically roll Command + Haggle. On a success, you keep your Wealth. On a failure, it drops by 1.)</em></p>
            </div>
          `;
          const action = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Significant Purchase" },
            content: confirmContent,
            buttons: [
              { action: "buy", label: "Pay 1 Wealth" },
              { action: "haggle", label: "Auto-Roll Haggle" }
            ]
          });

          if (action === "buy") {
            const newWealth = Math.max(0, currentWealth - 1);
            await this.document.update({ "system.wealth.value": newWealth });
            
            await ChatMessage.create({ 
              speaker: ChatMessage.getSpeaker({actor: this.document}), 
              content: `<div class="reign-chat-card"><h3 style="color: #d97706;">Significant Purchase</h3><p>Item Cost (${cost}) equals Wealth. Paid outright. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
            });

            await DialogV2.prompt({
              classes: ["reign-dialog-window"],
              window: { title: "Purchase Complete" },
              content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Purchased!<br><br>Your Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
              rejectClose: false
            });
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
                speaker: ChatMessage.getSpeaker({actor: this.document}), 
                content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Haggle Failed</h3><p>Command + Haggle pool is too small to attempt haggling.</p></div>` 
              });
              await DialogV2.prompt({
                classes: ["reign-dialog-window"],
                window: { title: "Haggle Failed" },
                content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Command + Haggle pool is too small to attempt haggling (Requires at least 2 dice).</p></div>`,
                rejectClose: false
              });
              return;
            }

            let edFace = 10;
            if (hasEd) {
                const edChoice = await DialogV2.wait({
                    classes: ["reign-dialog-window"],
                    window: { title: `Set Expert Die (Haggle)` },
                    content: `<form class="reign-dialog-form"><div class="form-group"><label>Expert Die Face:</label><input type="number" name="edFace" value="10" min="1" max="10"/></div></form>`,
                    buttons: [{
                      action: "set", label: "Roll Haggle", default: true,
                      callback: (event, button, dialog) => parseInt(dialog.element.querySelector('[name="edFace"]').value) || 10
                    }]
                });
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
                  await postOREChat(this.document, "Haggle (Purchase)", pool, finalResults, edCount > 0 ? edVal : 0, mdCount);
                  await DialogV2.prompt({
                    classes: ["reign-dialog-window"],
                    window: { title: "Haggle Succeeded" },
                    content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Haggle succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p></div>`,
                    rejectClose: false
                  });
                } else {
                  const newWealth = Math.max(0, currentWealth - 1);
                  await this.document.update({ "system.wealth.value": newWealth });
                  await postOREChat(this.document, "Haggle (Purchase)", pool, finalResults, edCount > 0 ? edVal : 0, mdCount);
                  await DialogV2.prompt({
                    classes: ["reign-dialog-window"],
                    window: { title: "Haggle Failed" },
                    content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #d97706;">Haggle failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
                    rejectClose: false
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
                window: { title: `Assign Master Die (Haggle)` },
                content: mdHtml,
                buttons: [{
                  action: "assign", label: "Finalize Haggle", default: true,
                  callback: (event, button, dialog) => parseInt(dialog.element.querySelector('[name="mdFace"]').value) || 10
                }]
              });

              if (mdResult) {
                results.push(mdResult);
                await finalizeHaggle(results, 1, hasEd ? 1 : 0, edFace);
              }
            } else {
              await finalizeHaggle(results, 0, hasEd ? 1 : 0, edFace);
            }
          }
        }
      },
      toggleProgression: async function(event, target) {
        const current = this.document.getFlag("reign", "progressionMode") || false;
        await this.document.setFlag("reign", "progressionMode", !current);
      },
      upgradeStat: async function(event, target) {
        const type = target.dataset.type;
        const key = target.dataset.key;
        const label = target.dataset.label;
        const isCustom = target.dataset.iscustom === "true";
        const isEsoterica = target.dataset.isesoterica === "true";
        const system = this.document.system;
        
        let currentVal = 0, cost = 0, newPath = "", newVal = 0, upgradeText = "";
        let removeEdPath = null;

        if (type === "attribute") {
          currentVal = system.attributes[key].value;
          if (currentVal >= 6) return ui.notifications.warn("Attributes cannot be upgraded past 6.");
          cost = 5; 
          newPath = `system.attributes.${key}.value`;
          newVal = currentVal + 1;
          upgradeText = `${label} Attribute to ${newVal}`;
        } else if (type === "skill" || type === "customSkill" || type === "esoterica") {
          let skillPath;
          if (type === "esoterica") {
            skillPath = `system.esoterica.${key}`;
            currentVal = system.esoterica[key];
          } else {
            skillPath = type === "customSkill" ? `system.customSkills.${key}` : `system.skills.${key}`;
            currentVal = foundry.utils.getProperty(system, skillPath.replace("system.", "")).value;
          }
          
          if (currentVal >= 6) return ui.notifications.warn("Skills cannot be upgraded past 6.");
          
          cost = 1; 
          newPath = type === "esoterica" ? skillPath : `${skillPath}.value`;
          newVal = currentVal + 1;
          upgradeText = `${label} to ${newVal}`;
        } else if (type === "ed") {
          cost = 1; 
          newPath = isCustom ? `system.customSkills.${key}.expert` : (isEsoterica ? `system.esoterica.expert` : `system.skills.${key}.expert`);
          newVal = true;
          upgradeText = `Expert Die for ${label}`;
        } else if (type === "md") {
          const hasEd = target.dataset.hased === "true";
          if (!hasEd) return ui.notifications.warn("You must acquire an Expert Die before upgrading to Master Die (RAW).");
          cost = 5; 
          newPath = isCustom ? `system.customSkills.${key}.master` : (isEsoterica ? `system.esoterica.master` : `system.skills.${key}.master`);
          newVal = true;
          upgradeText = `Master Die for ${label}`;
          if (hasEd) removeEdPath = isCustom ? `system.customSkills.${key}.expert` : (isEsoterica ? `system.esoterica.expert` : `system.skills.${key}.expert`);
        }

        const unspent = system.xp?.value || 0;
        if (cost > unspent) {
          return ui.notifications.error(`Insufficient XP. Upgrading ${label} requires ${cost} XP, but you only have ${unspent}.`);
        }

        const confirm = await DialogV2.confirm({
          window: { title: "Confirm Advancement" },
          content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Spend <strong>${cost} XP</strong> to acquire <strong>${upgradeText}</strong>?</p></div>`,
          rejectClose: false
        });

        if (confirm) {
          const updates = {
            "system.xp.value": unspent - cost,
            "system.xp.spent": (system.xp?.spent || 0) + cost,
            [newPath]: newVal
          };
          if (removeEdPath) updates[removeEdPath] = false; 
          
          await this.document.update(updates);
          ui.notifications.info(`Successfully spent ${cost} XP on ${upgradeText}.`);
        }
      },
      rollStat: async function(event, target) {
        const type = target.dataset.type;
        const key = target.dataset.key;
        const label = target.dataset.label;
        const system = this.document.system;

        const headMax = getEffectiveMax(this.document, "head");
        const torsoMax = getEffectiveMax(this.document, "torso");
        const headK = system.health.head.killing || 0;
        const headS = system.health.head.shock || 0;
        const torsoK = system.health.torso.killing || 0;
        const torsoS = system.health.torso.shock || 0;

        if (headK >= headMax || torsoK >= torsoMax) {
             return ui.notifications.error("Character is dead and cannot act.");
        }
        if (headS + headK >= headMax) {
             return ui.notifications.warn("Character is unconscious and cannot act.");
        }

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
            baseValue = 0; 
            defaultAttr = key; 
        }
        else if (type === "skill") { 
            baseValue = system.skills[key]?.value || 0; 
            hasExpert = system.skills[key]?.expert; 
            hasMaster = system.skills[key]?.master; 
            defaultAttr = skillAttrMap[key] || "none"; 
        }
        else if (type === "customSkill") { 
            baseValue = system.customSkills[key]?.value || 0; 
            hasExpert = system.customSkills[key]?.expert; 
            hasMaster = system.customSkills[key]?.master; 
            defaultAttr = system.customSkills[key]?.attribute || "none"; 
        }
        else if (type === "esoterica") { 
            baseValue = system.esoterica[key] || 0; 
            hasExpert = system.esoterica.expert || false;
            hasMaster = system.esoterica.master || false;
            defaultAttr = "knowledge"; 
        }
        else if (type === "move") {
          const m = system.customMoves[key];
          let aVal = m.attrKey !== "none" ? (system.attributes[m.attrKey]?.value || 0) : 0;
          let sVal = 0;
          if (m.skillKey !== "none") {
            if (system.skills[m.skillKey]) { 
                sVal = system.skills[m.skillKey].value; 
                hasExpert = system.skills[m.skillKey].expert; 
                hasMaster = system.skills[m.skillKey].master;
            }
            else if (system.customSkills[m.skillKey]) { 
                sVal = system.customSkills[m.skillKey].value; 
                hasExpert = system.customSkills[m.skillKey].expert; 
                hasMaster = system.customSkills[m.skillKey].master;
            }
          }
          baseValue = aVal + sVal + (m.modifier || 0);
        } 
        else if (type === "item") { 
          itemRef = this.document.items.get(key); 
          const poolRaw = itemRef?.system?.pool || ""; 
          
          if (itemRef?.type === "spell") {
            defaultSkill = "esoterica_sorcery";
            baseValue = 0;
            hasExpert = system.esoterica.expert || false;
            hasMaster = system.esoterica.master || false;
            defaultAttr = "knowledge"; 
          } else {
            const matchedStatic = Object.keys(system.skills).find(k => k.toLowerCase() === poolRaw.toLowerCase());
            const matchedCustom = Object.entries(system.customSkills || {}).find(([id, cSk]) => cSk.customLabel.toLowerCase() === poolRaw.toLowerCase());
            
            if (matchedStatic) {
              defaultSkill = `static_${matchedStatic}`;
              baseValue = 0; 
              hasExpert = system.skills[matchedStatic].expert;
              hasMaster = system.skills[matchedStatic].master;
              defaultAttr = skillAttrMap[matchedStatic] || "coordination"; 
            } else if (matchedCustom) {
              defaultSkill = `custom_${matchedCustom[0]}`;
              baseValue = 0;
              hasExpert = matchedCustom[1].expert;
              hasMaster = matchedCustom[1].master;
              defaultAttr = matchedCustom[1].attribute || "coordination";
            } else {
              baseValue = parseInt(poolRaw) || 0; 
              defaultAttr = "coordination";
            }
          }
        }

        if (type === "item" && itemRef?.type === "weapon" && itemRef.system.qualities?.slow > 0) {
          const combatant = game.combat?.combatants.find(c => c.actorId === this.document.id);
          if (combatant && game.combat) {
            const cooldownUntil = combatant.getFlag("reign", "slowCooldown") || 0;
            if (game.combat.round <= cooldownUntil) {
              return ui.notifications.warn(`${itemRef.name} is still being readied. Available on round ${cooldownUntil + 1}.`);
            }
          }
        }

        let woundPenalty = 0;
        let isDazed = false;

        if (headS + headK >= headMax) woundPenalty += 1;
        
        if (torsoS + torsoK >= torsoMax) {
            woundPenalty += 1;
            isDazed = true;
        }

        let armorWeight = "none";
        const equippedArmor = this.document.items.filter(i => i.type === "armor" && i.system.equipped);
        if (equippedArmor.some(a => a.system.armorWeight === "heavy")) armorWeight = "heavy";
        else if (equippedArmor.some(a => a.system.armorWeight === "medium")) armorWeight = "medium";
        else if (equippedArmor.some(a => a.system.armorWeight === "light")) armorWeight = "light";

        let rawSkillKey = defaultSkill.replace("static_", "").replace("custom_", "").replace("esoterica_", "");
        if (!rawSkillKey || rawSkillKey === "none") rawSkillKey = key; 
        
        let encumbDiff = 0;
        let encumbPen = 0;
        let encumbImpossible = false;

        if (armorWeight === "heavy") {
          if (rawSkillKey === "stealth") encumbImpossible = true;
          else if (rawSkillKey === "climb" || rawSkillKey === "run") encumbPen = 2;
          else if (rawSkillKey === "endurance" || rawSkillKey === "athletics") encumbDiff = 4;
        } else if (armorWeight === "medium") {
          if (["stealth", "climb", "run", "endurance", "athletics"].includes(rawSkillKey)) {
            encumbDiff = 3;
          }
        }

        if (encumbImpossible) return ui.notifications.error("Stealth is impossible in heavy armor. Action auto-fails.");
        
        let isAgility = defaultAttr === "coordination" || ["athletics", "dodge", "run", "stealth", "vigor", "ride"].includes(rawSkillKey);
        
        let autoPenalty = woundPenalty;
        let penaltyTitle = isDazed ? `DAZED (−1d)` : `Wounds (−${woundPenalty}d)`;
        
        if (isAgility && (encumbPen > 0 || encumbDiff > 0)) {
            autoPenalty += encumbPen;
            penaltyTitle += ` & Armor (−${encumbPen}d, Diff ${encumbDiff})`;
        }

        let shieldBonus = 0;
        if (rawSkillKey === "parry") {
            const equippedShields = this.document.items.filter(i => i.type === "shield" && i.system.equipped);
            if (equippedShields.length > 0) {
                shieldBonus = Math.max(...equippedShields.map(s => s.system.parryBonus || 0));
            }
        }

        const showSkillSelect = (type === "item");
        const isCombatRoll = (type === "item" && itemRef?.type === "weapon") || 
                             (type === "skill" && key === "fight") || 
                             (type === "move") || 
                             (type === "customSkill" && system.customSkills[key]?.isCombat);

        let initialEdValue = hasExpert ? 10 : 0;
        let initialMdValue = hasMaster ? 1 : 0; 

        let dialogTitle = `Roll ${label || 'Action'}`;
        if (shieldBonus > 0) dialogTitle += ` (+${shieldBonus}d Shield Bonus)`;

        let content = `<form class="reign-dialog-form">`;
        
        content += `<div class="form-group"><label>Attribute:</label><select name="attr">
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
            <div class="form-group">
              <label>Total Actions:</label>
              <input type="number" name="multiActions" value="1" min="1" title="Penalty: -1d per extra action"/>
            </div>
            <div class="form-group">
              <label>Bonus Dice (+d):</label>
              <input type="number" name="bonus" value="${shieldBonus}" title="Shield Bonus applied automatically if > 0"/>
            </div>
            <div class="form-group">
              <label>Penalty Dice (-d):</label>
              <input type="number" name="penalty" value="${autoPenalty}" title="${penaltyTitle}"/>
            </div>
          </div>
            
          <div class="form-group">
            <label>Passions:</label>
            <div class="dialog-grid dialog-grid-3">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.75em;">Mission</label>
                <select name="pMiss" style="font-size: 0.85em; padding: 2px;">
                  <option value="1">Aligned (+1d)</option>
                  <option value="0" selected>Neutral</option>
                  <option value="-1">Against (-1d)</option>
                </select>
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.75em;">Duty</label>
                <select name="pDuty" style="font-size: 0.85em; padding: 2px;">
                  <option value="1">Aligned (+1d)</option>
                  <option value="0" selected>Neutral</option>
                  <option value="-1">Against (-1d)</option>
                </select>
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.75em;">Craving</label>
                <select name="pCrav" style="font-size: 0.85em; padding: 2px;">
                  <option value="1">Aligned (+1d)</option>
                  <option value="0" selected>Neutral</option>
                  <option value="-1">Against (-1d)</option>
                </select>
              </div>
            </div>
          </div>
          
          <div class="dialog-grid dialog-grid-2" style="margin-top: 15px;">
            <div class="form-group"><label>Expert Die (1-10, 0=None):</label><input type="number" name="ed" value="${initialEdValue}" min="0" max="10"/></div>
            <div class="form-group"><label>Master Dice Count (Max 1):</label><input type="number" name="md" value="${initialMdValue}" min="0" max="1"/></div>
          </div>
        </form>`;

        const rollData = await DialogV2.wait({ 
          classes: ["reign-dialog-window"],
          window: { title: dialogTitle }, 
          content: content, 
          render: (event, html) => {
            let element;
            if (event instanceof Event && event.target?.element) {
                element = event.target.element; 
            } else if (event.querySelector) {
                element = event; 
            } else if (event[0] && event[0].querySelector) {
                element = event[0]; 
            }
            
            if (!element) return;
            
            const edInput = element.querySelector('[name="ed"]');
            const mdInput = element.querySelector('[name="md"]');
            
            if (!edInput || !mdInput) return;
            
            const enforceExclusivity = () => {
              let edVal = parseInt(edInput.value) || 0;
              let mdVal = parseInt(mdInput.value) || 0;
              
              if (edVal > 0) {
                mdInput.value = 0;
                mdInput.disabled = true;
              } else {
                mdInput.disabled = false;
              }
              
              if (mdVal > 0) {
                edInput.value = 0;
                edInput.disabled = true;
              } else {
                edInput.disabled = false;
              }
            };
            
            edInput.addEventListener('input', enforceExclusivity);
            mdInput.addEventListener('input', enforceExclusivity);
            enforceExclusivity(); 
          },
          buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
            const f = d.element.querySelector("form"); 
            return { 
              attr: f.querySelector('[name="attr"]')?.value || "none", 
              skillKey: f.querySelector('[name="skillKey"]')?.value || "none",
              calledShot: parseInt(f.querySelector('[name="calledShot"]')?.value) || 0,
              difficulty: parseInt(f.querySelector('[name="difficulty"]')?.value) || 0,
              multiActions: Math.max(parseInt(f.querySelector('[name="multiActions"]')?.value) || 1, 1),
              bonus: parseInt(f.querySelector('[name="bonus"]')?.value) || 0, 
              penalty: parseInt(f.querySelector('[name="penalty"]')?.value) || 0, 
              passionBonus: (parseInt(f.querySelector('[name="pMiss"]')?.value) || 0) + (parseInt(f.querySelector('[name="pDuty"]')?.value) || 0) + (parseInt(f.querySelector('[name="pCrav"]')?.value) || 0),
              ed: parseInt(f.querySelector('[name="ed"]')?.value) || 0, 
              md: parseInt(f.querySelector('[name="md"]')?.value) || 0 
            }; 
          } }] 
        });
        
        if (!rollData) return;
        
        let attrVal = rollData.attr !== "none" ? (system.attributes[rollData.attr]?.value || 0) : 0;
        let itemSkillValue = 0;
        if (showSkillSelect && rollData.skillKey !== "none") {
           if (rollData.skillKey.startsWith("static_")) itemSkillValue = system.skills[rollData.skillKey.replace("static_", "")]?.value || 0;
           else if (rollData.skillKey.startsWith("custom_")) itemSkillValue = system.customSkills[rollData.skillKey.replace("custom_", "")]?.value || 0;
           else if (rollData.skillKey === "esoterica_sorcery") itemSkillValue = system.esoterica.sorcery || 0;
        }

        if (rollData.ed > 0 && rollData.md > 0) {
            return ui.notifications.error("Reign rules strictly forbid using both Expert and Master dice in the same pool.");
        }

        let actualMd = rollData.md > 0 ? 1 : 0;
        let actualEd = rollData.ed > 0 ? 1 : 0;
        let remainingPenalty = rollData.penalty;
        let calledShotPenalty = rollData.calledShot > 0 ? 1 : 0;

        if (rollData.calledShot > 0 && actualEd > 0) {
            calledShotPenalty = 0; 
        }
        if (rollData.calledShot > 0 && actualMd > 0) {
            ui.notifications.warn("Called shots are unnecessary with a Master Die. Dropping penalty.");
            rollData.calledShot = 0;
            calledShotPenalty = 0;
        }

        if (remainingPenalty > 0 && actualMd > 0) { actualMd = 0; remainingPenalty--; }
        if (remainingPenalty > 0 && actualEd > 0) { actualEd = 0; remainingPenalty--; }

        // FIXED: Added shieldBonus directly to the pool calculation so the dice are actually rolled
        let baseDice = baseValue + attrVal + itemSkillValue + rollData.bonus + rollData.passionBonus;
        let multiActionPenalty = rollData.multiActions > 1 ? (rollData.multiActions - 1) : 0;
        
        let intendedPool = baseDice - remainingPenalty - multiActionPenalty - calledShotPenalty;
        let diceToRoll = Math.min(intendedPool, 10);
        let wasCapped = intendedPool > 10;

        if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced your dice pool below 1. Action fails.");

        let specialDiceCount = actualEd + actualMd + (rollData.calledShot > 0 ? 1 : 0);
        if (specialDiceCount > diceToRoll) return ui.notifications.warn("You cannot assign more Expert/Master/Called Shot dice than your total remaining pool limit!");

        let randomDiceCount = diceToRoll - specialDiceCount;
        let results = [];

        if (randomDiceCount > 0) {
          const roll = new Roll(`${randomDiceCount}d10`);
          await roll.evaluate();
          results = roll.dice[0]?.results.map(r => r.result) || [];
        }

        if (actualEd > 0) results.push(rollData.ed);
        if (rollData.calledShot > 0) results.push(rollData.calledShot);
        
        const finalizeCombatRoll = async (finalResults, mdCount, edCount, edVal) => {
            if (rawSkillKey === "counterspell") {
                const parsed = parseORE(finalResults);
                if (parsed.sets.length > 0) {
                     const bestSet = parsed.sets[0]; 
                     let csHtml = `<div class="reign-chat-card" style="border-color: #1a237e;">`;
                     csHtml += `<h3 style="color: #1a237e;">Counterspell Declared</h3>`;
                     csHtml += `<p style="font-size: 1.1em; margin-bottom: 5px;">The caster anchors their magic with <strong>${bestSet.text}</strong>.</p>`;
                     // FIXED: Corrected Counterspell text to reflect RAW Gobble Dice logic
                     csHtml += `<p style="font-size: 0.9em; color: #555;">This produces <strong>${bestSet.width} Gobble Dice</strong> at Height <strong>${bestSet.height}</strong>. Each can cancel one die from an incoming spell set of equal or lower Height.</p>`;
                     csHtml += `</div>`;
                     
                     await postOREChat(this.document, label || "Counterspell", diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, {
                          multiActions: rollData.multiActions,
                          calledShot: rollData.calledShot,
                          difficulty: rollData.difficulty,
                          wasCapped: wasCapped,
                          isAttack: false
                      });
                      
                     await ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({actor: this.document}),
                        content: csHtml
                     });
                } else {
                     await postOREChat(this.document, label || "Counterspell", diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, {
                          multiActions: rollData.multiActions,
                          calledShot: rollData.calledShot,
                          difficulty: rollData.difficulty,
                          wasCapped: wasCapped,
                          isAttack: false
                      });
                     await ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({actor: this.document}),
                        content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Counterspell Fizzled</h3><p>The caster failed to anchor the spell. They are unprotected!</p></div>`
                     });
                }
            } else {
                await postOREChat(this.document, label || "Action", diceToRoll, finalResults, edCount > 0 ? edVal : 0, mdCount, itemRef, {
                    multiActions: rollData.multiActions,
                    calledShot: rollData.calledShot,
                    difficulty: rollData.difficulty,
                    wasCapped: wasCapped,
                    isAttack: isCombatRoll
                });
            }
        };

        if (actualMd > 0) {
          results.sort((a, b) => b - a); 
          
          let mdHtml = `<form class="reign-dialog-form">
            <p style="margin-top: 0; font-size: 1.1em;"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None (All Master Dice)"}</p>
            <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Assign a face value to your Master Dice to build or improve sets.</p>
            <div class="dialog-grid dialog-grid-2">`;
          for(let i=0; i<actualMd; i++) {
            mdHtml += `<div class="form-group"><label>Master Die ${i+1} Face:</label><input type="number" id="mdFace${i}" value="10" min="1" max="10"/></div>`;
          }
          mdHtml += `</div></form>`;

          const mdResult = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: `Assign Master Dice` },
            content: mdHtml,
            buttons: [{
              action: "assign",
              label: "Finalize Sets",
              default: true,
              callback: (event, button, dialog) => {
                const faces = [];
                for(let i=0; i<actualMd; i++) {
                  faces.push(parseInt(dialog.element.querySelector(`#mdFace${i}`).value) || 10);
                }
                return faces;
              }
            }]
          });

          if (mdResult) {
            results.push(...mdResult);
            await finalizeCombatRoll(results, actualMd, actualEd, rollData.ed);
          }
        } else {
            await finalizeCombatRoll(results, 0, actualEd, rollData.ed);
        }
      },
      changeTab: async function(event, target) { 
        this._activeTab = target.dataset.tab;
        this.render();
      },
      itemCreate: async function(event, target) { await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); },
      itemEdit: async function(event, target) { this.document.items.get(target.dataset.itemId)?.sheet.render(true); },
      itemDelete: async function(event, target) { await this.document.items.get(target.dataset.itemId)?.delete(); },
      toggleEquip: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) await item.update({ "system.equipped": !item.system.equipped });
      },
      addCustomSkill: async function(event, target) {
        const newId = foundry.utils.randomID();
        await this.document.update({ [`system.customSkills.${newId}`]: { attribute: target.dataset.attr, customLabel: "", value: 0, expert: false, master: false, isCombat: false } });
      },
      deleteCustomSkill: async function(event, target) { await this.document.update({ [`system.customSkills.-=${target.dataset.skillId}`]: null }); },
      addCustomMove: async function(event, target) {
        const newId = foundry.utils.randomID();
        await this.document.update({ [`system.customMoves.${newId}`]: { name: "", attrKey: "none", skillKey: "none", modifier: 0 } });
      },
      deleteCustomMove: async function(event, target) { await this.document.update({ [`system.customMoves.-=${target.dataset.moveId}`]: null }); },
      itemToChat: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const safeName = foundry.utils.escapeHTML(item.name);
        const safeDesc = foundry.utils.escapeHTML(item.system.notes || item.system.effect || "");
        let content = `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><p>${safeDesc}</p></div>`;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/character-sheet.hbs" } };

  _onRender(context, options) {
    super._onRender(context, options);
    
    this.element.querySelectorAll(".health-box").forEach(box => {
      box.addEventListener("mousedown", async (ev) => {
        ev.preventDefault();
        const locKey = ev.currentTarget.closest(".health-track").dataset.loc;
        const actor = this.document;
        
        let { shock, killing } = actor.system.health[locKey];
        let max = getEffectiveMax(actor, locKey);
        
        if (ev.button === 0) { 
           if (shock + killing < max) shock++;
           else if (shock > 0) { shock--; killing++; } 
        } else if (ev.button === 2) { 
           if (shock > 0) shock--;
           else if (killing > 0) killing--;
        }

        setTimeout(async () => {
            await actor.update({ [`system.health.${locKey}.shock`]: shock, [`system.health.${locKey}.killing`]: killing });
        }, 50);
      });
      box.addEventListener("contextmenu", ev => ev.preventDefault());
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.actor = this.document;
    context.system = system;
    context.progressionMode = this.document.getFlag("reign", "progressionMode") || false;
    this._activeTab = this._activeTab || "stats";
    context.tabs = { stats: this._activeTab === "stats" ? "active" : "", combat: this._activeTab === "combat" ? "active" : "", esoterica: this._activeTab === "esoterica" ? "active" : "", biography: this._activeTab === "biography" ? "active" : "" };

    const skillMapping = {
      body: [ { key: "athletics", label: "ATHLETICS" }, { key: "endurance", label: "ENDURANCE" }, { key: "fight", label: "FIGHT" }, { key: "parry", label: "PARRY" }, { key: "run", label: "RUN" }, { key: "vigor", label: "VIGOR" } ],
      coordination: [ { key: "climb", label: "CLIMB" }, { key: "dodge", label: "DODGE" }, { key: "ride", label: "RIDE" }, { key: "stealth", label: "STEALTH" } ],
      sense: [ { key: "direction", label: "DIRECTION" }, { key: "eerie", label: "EERIE" }, { key: "empathy", label: "EMPATHY" }, { key: "hearing", label: "HEARING" }, { key: "scrutinize", label: "SCRUTINIZE" }, { key: "sight", label: "SIGHT" }, { key: "taste_touch_smell", label: "TASTE, TOUCH & SMELL" } ],
      knowledge: [ { key: "counterspell", label: "COUNTERSPELL" }, { key: "healing", label: "HEALING" }, { key: "languageNative", label: "LANGUAGE (NATIVE)" }, { key: "lore", label: "LORE" }, { key: "strategy", label: "STRATEGY" }, { key: "tactics", label: "TACTICS" } ],
      command: [ { key: "haggle", label: "HAGGLE" }, { key: "inspire", label: "INSPIRE" }, { key: "intimidate", label: "INTIMIDATE" } ],
      charm: [ { key: "fascinate", label: "FASCINATE" }, { key: "graces", label: "GRACES" }, { key: "jest", label: "JEST" }, { key: "lie", label: "LIE" }, { key: "plead", label: "PLEAD" } ]
    };

    context.attributeOptions = {none: "None", body: "Body", coordination: "Coordination", sense: "Sense", knowledge: "Knowledge", command: "Command", charm: "Charm"};
    context.skillOptions = {none: "None"};
    for (const [attr, skills] of Object.entries(skillMapping)) { skills.forEach(s => context.skillOptions[s.key] = s.label); }
    if (system.customSkills) { for (const [id, cSkill] of Object.entries(system.customSkills)) { context.skillOptions[id] = cSkill.customLabel || "Custom"; } }

    context.reignStatBlocks = Object.entries(skillMapping).map(([attrKey, skills]) => {
      let compiledSkills = skills.map(s => ({
        key: s.key, label: s.label, isCustom: false,
        value: system.skills[s.key]?.value || 0, expert: system.skills[s.key]?.expert || false, master: system.skills[s.key]?.master || false
      }));
      if (system.customSkills) {
        Object.entries(system.customSkills).forEach(([id, cSk]) => {
          if (cSk.attribute === attrKey) compiledSkills.push({ key: id, isCustom: true, customLabel: cSk.customLabel, value: cSk.value, expert: cSk.expert, master: cSk.master, isCombat: cSk.isCombat });
        });
      }
      return { key: attrKey, label: attrKey.toUpperCase(), value: system.attributes[attrKey].value, skills: compiledSkills };
    });

    const bodyVal = system.attributes?.body?.value || 0;
    const coordVal = system.attributes?.coordination?.value || 0;
    const parryVal = system.skills?.parry?.value || 0;
    const dodgeVal = system.skills?.dodge?.value || 0;
    
    // Apply shield bonus to the quick Parry pool visual on the sheet if equipped
    let shieldBonus = 0;
    const equippedShields = this.document.items.filter(i => i.type === "shield" && i.system.equipped);
    if (equippedShields.length > 0) shieldBonus = Math.max(...equippedShields.map(s => s.system.parryBonus || 0));

    context.preferredMoves = { 
        body: bodyVal, 
        coord: coordVal, 
        parry: parryVal, 
        dodge: dodgeVal, 
        parryTotal: bodyVal + parryVal + shieldBonus, 
        dodgeTotal: coordVal + dodgeVal,
        shieldBonus: shieldBonus
    };

    context.customMoves = [];
    if (system.customMoves) {
      for (const [id, move] of Object.entries(system.customMoves)) {
        let aVal = move.attrKey !== "none" ? (system.attributes[move.attrKey]?.value || 0) : 0;
        let sVal = 0;
        if (move.skillKey !== "none") {
          if (system.skills[move.skillKey]) sVal = system.skills[move.skillKey].value || 0;
          else if (system.customSkills[move.skillKey]) sVal = system.customSkills[move.skillKey].value || 0;
        }
        context.customMoves.push({ key: id, name: move.name || "", attrKey: move.attrKey, skillKey: move.skillKey, modifier: move.modifier, total: aVal + sVal + (move.modifier || 0) });
      }
    }

    const items = this.document.items;
    context.weapons = items.filter(i => i.type === "weapon");
    context.techniques = items.filter(i => i.type === "technique");
    context.spells = items.filter(i => i.type === "spell");
    context.disciplines = items.filter(i => i.type === "discipline");
    context.gear = items.filter(i => i.type === "gear");
    context.advantages = items.filter(i => i.type === "advantage");
    context.problems = items.filter(i => i.type === "problem");
    context.armors = items.filter(i => i.type === "armor");
    
    // FIXED: The sheet now pulls ALL shields, not just equipped ones, so you can see and manage them!
    context.shields = items.filter(i => i.type === "shield");

    context.reignHealth = ["head", "torso", "armR", "armL", "legR", "legL"].map(k => {
      const labelMap = { head: "Head (10)", torso: "Torso (7–9)", armR: "R. Arm (5–6)", armL: "L. Arm (3–4)", legR: "R. Leg (2)", legL: "L. Leg (1)" };
      const loc = foundry.utils.deepClone(system.health[k]);
      loc.max = getEffectiveMax(this.document, k); // Override max for rendering display
      
      let boxes = Array.from({length: loc.max}).map((_, i) => {
          if (i < loc.killing) return { state: "killing", icon: "X" };
          if (i < loc.killing + loc.shock) return { state: "shock", icon: "/" };
          return { state: "empty", icon: "" };
      });

      return { key: k, label: labelMap[k], boxes: boxes, armor: loc.armor };
    });

    return context;
  }
}