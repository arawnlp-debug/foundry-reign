// scripts/sheets/character-sheet.js
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

import { parseORE, getEffectiveMax } from "../helpers/ore-engine.js";
import { postOREChat } from "../helpers/chat.js";
import { OneRollGenerator } from "../generators/one-roll.js";
// NEW: Import our centralized roller
import { ReignRoller } from "../helpers/reign-roller.js";

export class ReignActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor"], position: { width: 800, height: 850 }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      // NEW: Image editing action for ApplicationV2
      editImage: async function(event, target) {
        const fp = new FilePicker({
          type: "image",
          current: this.document.img,
          callback: path => this.document.update({ img: path })
        });
        return fp.browse();
      },
      generateCharacter: async function(event, target) {
        await OneRollGenerator.start(this.document);
      },
      recoverShock: async function(event, target) {
        const system = this.document.system;
        const updates = {};
        let totalRecovered = 0;

        ["head", "torso", "armR", "armL", "legR", "legL"].forEach(loc => {
          let currentShock = system.health[loc].shock || 0;
          if (currentShock > 0) {
            let newShock = currentShock - Math.ceil(currentShock / 2); 
            totalRecovered += (currentShock - newShock);
            updates[`system.health.${loc}.shock`] = newShock;
          }
        });

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
      
      // ==========================================
      // NEW: ONE-LINE ROLL CALL
      // ==========================================
      rollStat: async function(event, target) {
        // We pass the document (actor) and the HTML dataset to the new central roller
        await ReignRoller.rollCharacter(this.document, target.dataset);
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
    context.shields = items.filter(i => i.type === "shield");

    context.reignHealth = ["head", "torso", "armR", "armL", "legR", "legL"].map(k => {
      const labelMap = { head: "Head (10)", torso: "Torso (7–9)", armR: "R. Arm (5–6)", armL: "L. Arm (3–4)", legR: "R. Leg (2)", legL: "L. Leg (1)" };
      const loc = foundry.utils.deepClone(system.health[k]);
      loc.max = getEffectiveMax(this.document, k);
      
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