// scripts/sheets/character-sheet.js
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

import { parseORE, getEffectiveMax } from "../helpers/ore-engine.js";
import { postOREChat } from "../helpers/chat.js";
import { OneRollGenerator } from "../generators/one-roll.js";

// PHASE 3 REFACTOR: Import modular rollers instead of ReignRoller
import { CharacterRoller } from "../helpers/character-roller.js";
import { WealthRoller } from "../helpers/wealth-roller.js";

import { syncCharacterStatusEffects } from "../combat/damage.js";

// SPRINT 1: Import the single sources of truth
import { skillAttrMap, getEffectiveShieldLocations } from "../helpers/config.js";

export class ReignActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", 
    classes: ["reign", "sheet", "actor"], 
    position: { width: 800, height: 850 }, 
    
    window: {
      resizable: true,
      minimizable: true
    },
    
    form: { submitOnChange: true, closeOnSubmit: false },
    
    actions: {
      editImage: async function(event, target) {
        try {
          const fp = new FilePicker({
            type: "image",
            current: this.document.img,
            callback: path => this.document.update({ img: path })
          });
          return fp.browse();
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      generateCharacter: async function(event, target) {
        try {
          await OneRollGenerator.start(this.document);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      recoverShock: async function(event, target) {
        try {
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
            await syncCharacterStatusEffects(this.document);
            
            const safeName = foundry.utils.escapeHTML(this.document.name);
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.document }),
              content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Post-Combat Recovery</h3><p>Catching their breath, ${safeName} recovers <strong>${totalRecovered} Shock</strong> damage across their body.</p></div>`
            });
          } else {
            ui.notifications.info(`${this.document.name} has no Shock damage to recover.`);
          }
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      // HEALING ENGINE: Long Term Rest
      restAndRecover: async function(event, target) {
        try {
          const content = `
            <div class="reign-dialog-form">
              <p style="text-align: center; font-size: 1.1em; margin-bottom: 10px;">Select the duration of your rest.</p>
              <div class="form-group">
                <label>Rest Duration:</label>
                <select name="restType">
                  <option value="day">Rest for 1 Day (Heals 1 Shock per location)</option>
                  <option value="week">Rest for 1 Week (Heals 1 Killing per location)</option>
                </select>
              </div>
            </div>
          `;

          const restType = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Rest & Recover" },
            content: content,
            buttons: [{
              action: "confirm", label: "Rest", default: true,
              callback: (e, b, d) => {
                const val = d.element.querySelector('[name="restType"]').value;
                if (d && typeof d.close === 'function') d.close({ animate: false });
                return val;
              }
            }]
          });

          if (!restType) return;

          const system = this.document.system;
          const updates = {};
          let totalHealed = 0;

          ["head", "torso", "armR", "armL", "legR", "legL"].forEach(loc => {
            let currentShock = system.health[loc].shock || 0;
            let currentKilling = system.health[loc].killing || 0;

            if (restType === "day" && currentShock > 0) {
              updates[`system.health.${loc}.shock`] = currentShock - 1;
              totalHealed++;
            } else if (restType === "week" && currentKilling > 0) {
              updates[`system.health.${loc}.killing`] = currentKilling - 1;
              totalHealed++;
            }
          });

          if (totalHealed > 0) {
            await this.document.update(updates);
            await syncCharacterStatusEffects(this.document);
            
            const safeName = foundry.utils.escapeHTML(this.document.name);
            const timeStr = restType === "day" ? "a full day" : "a full week";
            const healStr = restType === "day" ? "Shock" : "Killing";
            
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.document }),
              content: `<div class="reign-chat-card"><h3 style="color: #01579b;"><i class="fas fa-campground"></i> Natural Healing</h3><p>${safeName} rests for <strong>${timeStr}</strong>, naturally recovering <strong>1 ${healStr}</strong> damage across ${totalHealed} affected locations.</p></div>`
            });
          } else {
            ui.notifications.info(`${this.document.name} has no ${restType === "day" ? "Shock" : "Killing"} damage to heal.`);
          }
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      purchaseHelper: async function(event, target) {
        try {
          await WealthRoller.rollWealthPurchase(this.document);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      acquireLoot: async function(event, target) {
        try {
          const system = this.document.system;
          const currentWealth = system.wealth?.value || 0;

          const content = `
            <form class="reign-dialog-form">
              <div class="form-group" style="text-align: center; margin-bottom: 15px;">
                <label>Your Current Wealth</label>
                <div style="font-size: 2em; font-weight: bold; color: #2d5a27;">${currentWealth}</div>
              </div>
              <div class="form-group">
                <label>Value of the Acquired Loot (1-10):</label>
                <input type="number" name="lootValue" value="${Math.max(1, currentWealth)}" min="1" max="10" autofocus/>
              </div>
            </form>
          `;

          const lootValue = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Acquire Loot", resizable: true },
            content: content,
            rejectClose: false,
            render: (event, html) => {
              let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
              if (element) {
                  const closeBtn = element.querySelector('.header-control[data-action="close"]');
                  if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });

                  const f = element.querySelector("form");
                  if (f) f.addEventListener("submit", e => e.preventDefault());
              }
            },
            buttons: [{
              action: "confirm", label: "Evaluate Loot", default: true,
              callback: (e, b, d) => {
                const val = parseInt(d.element.querySelector('[name="lootValue"]').value) || 0;
                if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                d.close({ animate: false });
                return val;
              }
            }]
          });

          if (!lootValue) return;

          if (lootValue >= currentWealth) {
            const newWealth = Math.min(10, currentWealth + 1); 
            await this.document.update({ "system.wealth.value": newWealth });
            
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.document }),
              content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Significant Windfall!</h3><p>Acquired loot (Value <strong>${lootValue}</strong>) meets or exceeds current Wealth.</p><hr><p style="font-size: 1.1em; font-weight: bold;">Permanent Wealth increases to ${newWealth}!</p></div>`
            });
          } else {
             await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.document }),
              content: `<div class="reign-chat-card"><h3 style="color: #555;">Trivial Loot</h3><p>Acquired loot (Value <strong>${lootValue}</strong>) is below current Wealth (${currentWealth}).</p><hr><p style="font-size: 0.9em; font-style: italic;">It's pocket change and does not affect your permanent standing.</p></div>`
            });
          }
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleProgression: async function(event, target) {
        try {
          const current = this.document.getFlag("reign", "progressionMode") || false;
          await this.document.setFlag("reign", "progressionMode", !current);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      upgradeStat: async function(event, target) {
        try {
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
            newPath = isCustom ? `system.customSkills.${key}.master` : (isEsoterica ? `system.esoterica.master` : `system.skills.${key}.expert`);
            newVal = true;
            upgradeText = `Master Die for ${label}`;
            if (hasEd) removeEdPath = isCustom ? `system.customSkills.${key}.expert` : (isEsoterica ? `system.esoterica.expert` : `system.skills.${key}.expert`);
          }

          const unspent = system.xp?.value || 0;
          if (cost > unspent) {
            return ui.notifications.error(`Insufficient XP. Upgrading ${label} requires ${cost} XP, but you only have ${unspent}.`);
          }

          const confirm = await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Confirm Advancement" },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Spend <strong>${cost} XP</strong> to acquire <strong>${upgradeText}</strong>?</p></div>`,
            rejectClose: false,
            render: (event, html) => {
              let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
              if (element) {
                  const closeBtn = element.querySelector('.header-control[data-action="close"]');
                  if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });
              }
            },
            buttons: [
              { action: "yes", label: "Yes", default: true, callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } return true; } },
              { action: "no", label: "No", callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } return false; } }
            ]
          });
          
          if (!confirm) return;
          await new Promise(resolve => setTimeout(resolve, 250)); // Breather

          const updates = {
            "system.xp.value": unspent - cost,
            "system.xp.spent": (system.xp?.spent || 0) + cost,
            [newPath]: newVal
          };
          if (removeEdPath) updates[removeEdPath] = false; 
          
          await this.document.update(updates);
          ui.notifications.info(`Successfully spent ${cost} XP on ${upgradeText}.`);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      rollStat: async function(event, target) {
        try {
          const dataset = target.dataset;
          
          if (this.document.system.hasTowerShieldPenalty) {
              const key = dataset.key?.toLowerCase();
              if (key === "stealth" || key === "climb") {
                  return ui.notifications.error("Cannot make Stealth or Climb rolls while dragging a massive Tower Shield!");
              }
          }

          await CharacterRoller.rollCharacter(this.document, dataset);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      changeTab: async function(event, target) { 
        try {
          this._activeTab = target.dataset.tab;
          this.render();
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemCreate: async function(event, target) { 
        try {
          await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemEdit: async function(event, target) { 
        try {
          this.document.items.get(target.dataset.itemId)?.sheet.render(true); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemDelete: async function(event, target) { 
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (!item) return;

          // Replaced standard confirm with properly styled anti-ghost DialogV2.wait
          const confirm = await DialogV2.wait({
              classes: ["reign-dialog-window"],
              window: { title: `Delete ${item.name}?` },
              content: `<div class="reign-dialog-form"><p style="text-align: center; font-size: 1.1em;">Are you sure you want to permanently delete <strong>${item.name}</strong>?<br>This action cannot be undone.</p></div>`,
              rejectClose: false,
              render: (event, html) => {
                let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                if (element) {
                    const closeBtn = element.querySelector('.header-control[data-action="close"]');
                    if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });
                }
              },
              buttons: [
                { action: "yes", label: "Yes", default: true, callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } return true; } },
                { action: "no", label: "No", callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } return false; } }
              ]
          });
          if (confirm) await item.delete(); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleEquip: async function(event, target) {
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (item) await item.update({ "system.equipped": !item.system.equipped });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleStationary: async function(event, target) {
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (item) await item.update({ "system.isStationary": !item.system.isStationary });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      addCustomSkill: async function(event, target) {
        try {
          const newId = foundry.utils.randomID();
          await this.document.update({ [`system.customSkills.${newId}`]: { attribute: target.dataset.attr, customLabel: "", value: 0, expert: false, master: false, isCombat: false } });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      deleteCustomSkill: async function(event, target) { 
        try {
          await this.document.update({ [`system.customSkills.-=${target.dataset.skillId}`]: null }); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      addCustomMove: async function(event, target) {
        try {
          const newId = foundry.utils.randomID();
          await this.document.update({ [`system.customMoves.${newId}`]: { name: "", attrKey: "none", skillKey: "none", modifier: 0 } });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      deleteCustomMove: async function(event, target) { 
        try {
          await this.document.update({ [`system.customMoves.-=${target.dataset.moveId}`]: null }); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemToChat: async function(event, target) {
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (!item) return;
          const safeName = foundry.utils.escapeHTML(item.name);
          let rawDesc = String(item.system.notes || item.system.effect || "");
          rawDesc = rawDesc
            .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
            .replace(/<img[\s\S]*?>/gi, "")
            .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
            .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
            .replace(/<embed[\s\S]*?>/gi, "");
            
          const safeDesc = await TextEditor.enrichHTML(rawDesc, {
            async: true,
            secrets: this.document.isOwner,
            relativeTo: this.document
          });
          
          let content = `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><div>${safeDesc}</div></div>`;
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleShieldLocation: async function(event, target) {
        try {
          const locKey = target.dataset.loc;
          const shieldId = target.dataset.shieldId;
          const shield = this.document.items.get(shieldId);
          if (!shield) return;

          const sys = shield.system;
          const currentLocs = foundry.utils.deepClone(sys.protectedLocations);
          
          if (sys.shieldSize === "tower") {
              if (!sys.isStationary) {
                  return ui.notifications.warn("Cannot adjust protection while moving. The shield only covers your arm.");
              }
              const carryingArm = sys.shieldArm || "armL";
              const carryingLeg = carryingArm === "armL" ? "legL" : "legR";
              
              if (locKey === carryingArm || locKey === carryingLeg) {
                  return ui.notifications.warn("Tower Shields automatically protect the carrying arm and leg while stationary.");
              }

              if (currentLocs[locKey]) {
                  currentLocs[locKey] = false;
              } else {
                  const activeManual = Object.keys(currentLocs).filter(k => 
                      currentLocs[k] && k !== carryingArm && k !== carryingLeg
                  );
                  if (activeManual.length >= 2) {
                      for (const k of activeManual) currentLocs[k] = false;
                  }
                  currentLocs[locKey] = true;
              }
          } else {
              const limits = { small: 1, large: 2 }; 
              const max = limits[sys.shieldSize] || 1;

              if (currentLocs[locKey]) {
                  currentLocs[locKey] = false;
              } else {
                  const active = Object.keys(currentLocs).filter(k => currentLocs[k]);
                  if (active.length >= max) {
                      for (const k of active) currentLocs[k] = false;
                  }
                  currentLocs[locKey] = true;
              }
          }

          await shield.update({ "system.protectedLocations": currentLocs });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      createEffect: async function(event, target) {
        const actor = this.document;
        // V13 STRICT: Use createEmbeddedDocuments
        await actor.createEmbeddedDocuments("ActiveEffect", [{
          name: `New Effect`,
          img: "icons/svg/aura.svg",
          origin: actor.uuid,
          disabled: false
        }]);
      },
      editEffect: async function(event, target) {
        const effectId = target.closest(".effect-item").dataset.effectId;
        const effect = this.document.effects.get(effectId);
        if (effect) effect.sheet.render(true);
      },
      deleteEffect: async function(event, target) {
        const effectId = target.closest(".effect-item").dataset.effectId;
        const effect = this.document.effects.get(effectId);
        if (effect) {
          await effect.delete();
          this.render(true);
        }
      },
      toggleEffect: async function(event, target) {
        const effectId = target.closest(".effect-item").dataset.effectId;
        const effect = this.document.effects.get(effectId);
        if (effect) {
          await effect.update({ disabled: !effect.disabled });
          this.render(true);
        }
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/character-sheet.hbs" } };

  _prepareSubmitData(event, form, formData) {
    let data = super._prepareSubmitData(event, form, formData);
    
    let flatData = foundry.utils.flattenObject(data);
    let changed = false;

    for (const key in flatData) {
        if (key.endsWith(".armor") || key.endsWith(".value") || key.endsWith(".sorcery") || 
            key.endsWith(".spent") || key.endsWith(".modifier") || key.endsWith(".cost") || 
            key.endsWith(".bonus") || key.endsWith(".quantity") || key.endsWith(".intensity") || 
            key.endsWith(".parryBonus") || key.endsWith(".coverAR")) {
            
            if (flatData[key] === "" || flatData[key] === null) {
                flatData[key] = 0;
                changed = true;
            } else if (typeof flatData[key] === "string" && !isNaN(parseInt(flatData[key]))) {
                flatData[key] = parseInt(flatData[key]) || 0;
                changed = true;
            }
        }
    }
    
    return changed ? foundry.utils.expandObject(flatData) : data;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    
    const healthContainer = this.element.querySelector(".reign-health-container");
    if (healthContainer) {
      healthContainer.addEventListener("mousedown", async (ev) => {
        const box = ev.target.closest(".health-box");
        if (!box) return;
        
        ev.preventDefault();
        const locKey = box.closest(".health-track").dataset.loc;
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

        await actor.update({ [`system.health.${locKey}.shock`]: shock, [`system.health.${locKey}.killing`]: killing });
        await syncCharacterStatusEffects(actor);
      });
      
      healthContainer.addEventListener("contextmenu", ev => {
        if (ev.target.closest(".health-box")) ev.preventDefault();
      });
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.actor = this.document;
    context.system = system;

    context.creationMode = system.creationMode || false;

    context.progressionMode = this.document.getFlag("reign", "progressionMode") || false;
    this._activeTab = this._activeTab || "stats";
    context.tabs = { 
      stats: this._activeTab === "stats" ? "active" : "", 
      combat: this._activeTab === "combat" ? "active" : "", 
      esoterica: this._activeTab === "esoterica" ? "active" : "", 
      biography: this._activeTab === "biography" ? "active" : "",
      effects: this._activeTab === "effects" ? "active" : ""
    };

    const skillMapping = { body: [], coordination: [], sense: [], knowledge: [], command: [], charm: [] };
    for (const [sKey, aKey] of Object.entries(skillAttrMap)) {
      if (skillMapping[aKey]) {
          let label = sKey.replace(/_/g, ", ").toUpperCase();
          if (sKey === "languageNative") label = "LANGUAGE (NATIVE)";
          if (sKey === "taste_touch_smell") label = "TASTE, TOUCH & SMELL";
          skillMapping[aKey].push({ key: sKey, label: label });
      }
    }
    for (const group in skillMapping) { skillMapping[group].sort((a, b) => a.label.localeCompare(b.label)); }

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
    
    const parryShields = equippedShields.filter(s => s.system.shieldSize !== "tower");
    if (parryShields.length > 0) shieldBonus = Math.max(...parryShields.map(s => s.system.parryBonus || 0));

    context.preferredMoves = { 
        body: bodyVal, 
        coord: coordVal, 
        parry: parryVal, 
        dodge: dodgeVal, 
        parryTotal: system.baseParryPool + shieldBonus, 
        dodgeTotal: system.baseDodgePool,
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

    context.activeShields = equippedShields;

    context.reignHealth = ["head", "torso", "armR", "armL", "legR", "legL"].map(k => {
      const labelMap = { head: "Head (10)", torso: "Torso (7–9)", armR: "R. Arm (5–6)", armL: "L. Arm (3–4)", legR: "R. Leg (2)", legL: "L. Leg (1)" };
      const loc = foundry.utils.deepClone(system.health[k]);
      loc.max = getEffectiveMax(this.document, k);
      
      let boxes = Array.from({length: loc.max}).map((_, i) => {
          if (i < loc.killing) return { state: "killing", icon: "X" };
          if (i < loc.killing + loc.shock) return { state: "shock", icon: "/" };
          return { state: "empty", icon: "" };
      });

      let isShielded = false;
      if (context.activeShields && context.activeShields.length > 0) {
         isShielded = context.activeShields.some(shield => {
             const effectiveLocs = shield.system.effectiveLocations || shield.system.protectedLocations || {};
             return !!effectiveLocs[k];
         });
      }

      return { 
        key: k, 
        label: labelMap[k], 
        boxes: boxes, 
        armor: loc.armor,
        isShielded: isShielded
      };
    });

    const autoStatuses = new Set(["dead", "unconscious", "dazed", "maimed", "prone", "bleeding"]);
    context.autoEffects = [];
    context.manualEffects = [];
    
    for (let e of this.document.effects) {
      if (Array.from(e.statuses).some(s => autoStatuses.has(s))) {
        context.autoEffects.push(e);
      } else {
        context.manualEffects.push(e);
      }
    }

    // V13 FIX: Ensure the master 'effects' array is also available for the template
    context.effects = Array.from(this.document.effects);

    return context;
  }
}