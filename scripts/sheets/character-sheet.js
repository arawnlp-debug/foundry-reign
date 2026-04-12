// scripts/sheets/character-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { parseORE } from "../helpers/ore-engine.js";
import { postOREChat } from "../helpers/chat.js";
import { ReignCharactermancer } from "../generators/charactermancer.js";
import { CharacterRoller } from "../helpers/character-roller.js";
import { WealthRoller } from "../helpers/wealth-roller.js";
import { syncCharacterStatusEffects } from "../combat/damage.js";
import { skillAttrMap } from "../helpers/config.js";

// Import the extracted dialog utilities
import { reignDialog, reignConfirm } from "../helpers/dialog-util.js";

/**
 * Main application class for rendering Character Actor sheets.
 */
export class ReignActorSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", 
    classes: ["reign", "sheet", "actor"], 
    position: { width: 800, height: 850 }, 
    window: { resizable: true, minimizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      generateCharacter: async function(event, target) {
        try {
          await ReignCharactermancer.start(this.document);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      recoverShock: async function(event, target) {
        try {
          const system = this.document.system;
          const updates = {};
          let totalRecovered = 0;

          ["head", "torso", "armR", "armL", "legR", "legL"].forEach(loc => {
            let currentShock = parseInt(system.health[loc].shock) || 0;
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
      restAndRecover: async function(event, target) {
        try {
          const content = `
            <div class="reign-dialog-form">
              <p style="text-align: center; font-size: 1.1em; margin-bottom: 10px;">Select the type of rest.</p>
              <div class="form-group">
                <label>Rest Type:</label>
                <select name="restType">
                  <option value="vigor">Vigorous Recovery (Roll Body + Vigor to heal Shock)</option>
                  <option value="day">Rest for 1 Full Day (Heals 1 Shock per location)</option>
                  <option value="week">Rest for 1 Full Week (Heals 1 Killing per location)</option>
                </select>
              </div>
            </div>
          `;

          const restType = await reignDialog("Rest & Recover", content, (e, b, d) => d.element.querySelector('[name="restType"]').value, { defaultLabel: "Rest" });

          if (!restType) return;
          const system = this.document.system;

          if (restType === "vigor") {
            const body = parseInt(system.attributes.body?.value) || 0;
            const vigor = parseInt(system.skills.vigor?.value) || 0;
            let pool = Math.min(body + vigor, 10);
            
            if (pool < 1) return ui.notifications.warn("Pool too low to roll for Vigorous Recovery.");

            const roll = new Roll(`${pool}d10`);
            await roll.evaluate();
            const results = roll.dice[0]?.results.map(r => r.result) || [];
            const parsed = parseORE(results);

            if (parsed.sets.length === 0) {
                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Vigorous Recovery Failed</h3><p>Rolled ${pool}d10 (Body + Vigor) and found no matches. No Shock was recovered.</p></div>` });
                return;
            }

            const bestSet = parsed.sets[0];
            const width = bestSet.width;

            const distContent = `
              <form class="reign-dialog-form">
                <p style="text-align:center;">Your roll succeeded! Width: <strong>${width}</strong>. You may remove up to ${width} Shock.</p>
                <div class="form-group"><label>Head (Shock: ${system.health.head.shock}):</label><input type="number" name="head" value="0" min="0" max="${Math.min(width, system.health.head.shock)}"></div>
                <div class="form-group"><label>Torso (Shock: ${system.health.torso.shock}):</label><input type="number" name="torso" value="0" min="0" max="${Math.min(width, system.health.torso.shock)}"></div>
                <div class="form-group"><label>R. Arm (Shock: ${system.health.armR.shock}):</label><input type="number" name="armR" value="0" min="0" max="${Math.min(width, system.health.armR.shock)}"></div>
                <div class="form-group"><label>L. Arm (Shock: ${system.health.armL.shock}):</label><input type="number" name="armL" value="0" min="0" max="${Math.min(width, system.health.armL.shock)}"></div>
                <div class="form-group"><label>R. Leg (Shock: ${system.health.legR.shock}):</label><input type="number" name="legR" value="0" min="0" max="${Math.min(width, system.health.legR.shock)}"></div>
                <div class="form-group"><label>L. Leg (Shock: ${system.health.legL.shock}):</label><input type="number" name="legL" value="0" min="0" max="${Math.min(width, system.health.legL.shock)}"></div>
              </form>
            `;

            const dist = await reignDialog("Distribute Healing", distContent, (e,b,d) => {
                    const f = d.element.querySelector("form");
                    return { head: parseInt(f.head.value)||0, torso: parseInt(f.torso.value)||0, armR: parseInt(f.armR.value)||0, armL: parseInt(f.armL.value)||0, legR: parseInt(f.legR.value)||0, legL: parseInt(f.legL.value)||0 };
                }, { defaultLabel: "Apply Healing" }
            );

            if (!dist) return;

            const totalAllocated = dist.head + dist.torso + dist.armR + dist.armL + dist.legR + dist.legL;
            if (totalAllocated > width) return ui.notifications.error(`You allocated ${totalAllocated} healing, but only generated ${width}. Rest cancelled.`);

            const updates = {};
            for (const [k, v] of Object.entries(dist)) { if (v > 0) updates[`system.health.${k}.shock`] = Math.max(0, system.health[k].shock - v); }
            
            if (Object.keys(updates).length > 0) {
                await this.document.update(updates);
                await syncCharacterStatusEffects(this.document);
            }

            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Vigorous Recovery</h3><p>Rolled ${pool}d10 (Body+Vigor). Set: ${bestSet.text}.<br>Recovered <strong>${totalAllocated} Shock</strong> total.</p></div>` });
            return;
          }

          const updates = {};
          let totalHealed = 0;

          ["head", "torso", "armR", "armL", "legR", "legL"].forEach(loc => {
            let currentShock = parseInt(system.health[loc].shock) || 0;
            let currentKilling = parseInt(system.health[loc].killing) || 0;

            if (restType === "day" && currentShock > 0) { updates[`system.health.${loc}.shock`] = currentShock - 1; totalHealed++; } 
            else if (restType === "week" && currentKilling > 0) { updates[`system.health.${loc}.killing`] = currentKilling - 1; totalHealed++; }
          });

          if (totalHealed > 0) {
            await this.document.update(updates);
            await syncCharacterStatusEffects(this.document);
            const timeStr = restType === "day" ? "a full day" : "a full week";
            const healStr = restType === "day" ? "Shock" : "Killing";
            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.document }), content: `<div class="reign-chat-card"><h3 style="color: #01579b;"><i class="fas fa-campground"></i> Natural Healing</h3><p>${foundry.utils.escapeHTML(this.document.name)} rests for <strong>${timeStr}</strong>, naturally recovering <strong>1 ${healStr}</strong> damage across ${totalHealed} affected locations.</p></div>` });
          } else {
            ui.notifications.info(`${this.document.name} has no ${restType === "day" ? "Shock" : "Killing"} damage to heal via passive resting.`);
          }
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      purchaseHelper: async function(event, target) {
        try { await WealthRoller.rollWealthPurchase(this.document); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      // AUDIT FIX B4: JS-level clamping of Wealth
      acquireLoot: async function(event, target) {
        try {
          const currentWealth = this.document.system.wealth?.value || 0;
          const content = `<form class="reign-dialog-form"><div class="form-group" style="text-align: center; margin-bottom: 15px;"><label>Your Current Wealth</label><div style="font-size: 2em; font-weight: bold; color: #2d5a27;">${currentWealth}</div></div><div class="form-group"><label>Value of the Acquired Loot (1-10):</label><input type="number" name="lootValue" value="${Math.max(1, currentWealth)}" min="1" max="10" autofocus/></div></form>`;
          let lootValue = await reignDialog("Acquire Loot", content, (e, b, d) => parseInt(d.element.querySelector('[name="lootValue"]').value) || 0, { defaultLabel: "Evaluate Loot" });
          if (!lootValue) return;

          // Clamp to valid range (1-10) regardless of what is typed in DOM
          lootValue = Math.max(1, Math.min(10, lootValue));

          if (lootValue >= currentWealth) {
            const newWealth = Math.min(10, currentWealth + 1); 
            await this.document.update({ "system.wealth.value": newWealth });
            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.document }), content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Significant Windfall!</h3><p>Acquired loot (Value <strong>${lootValue}</strong>) meets or exceeds current Wealth.</p><hr><p style="font-size: 1.1em; font-weight: bold;">Permanent Wealth increases to ${newWealth}!</p></div>` });
          } else {
             await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.document }), content: `<div class="reign-chat-card"><h3 style="color: #555;">Trivial Loot</h3><p>Acquired loot (Value <strong>${lootValue}</strong>) is below current Wealth (${currentWealth}).</p><hr><p style="font-size: 0.9em; font-style: italic;">It's pocket change and does not affect your permanent standing.</p></div>` });
          }
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleProgression: async function(event, target) {
        try { await this.document.setFlag("reign", "progressionMode", !(this.document.getFlag("reign", "progressionMode") || false)); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      // AUDIT FIX B1 (P0): Master Die writes to wrong schema path
      upgradeStat: async function(event, target) {
        try {
          const type = target.dataset.type, key = target.dataset.key, label = target.dataset.label, isCustom = target.dataset.iscustom === "true", isEsoterica = target.dataset.isesoterica === "true";
          const system = this.document.system;
          let currentVal = 0, cost = 0, newPath = "", newVal = 0, upgradeText = "", removeEdPath = null;

          if (type === "attribute") {
            currentVal = system.attributes[key].value;
            if (currentVal >= 6) return ui.notifications.warn("Attributes cannot be upgraded past 6.");
            cost = 5; newPath = `system.attributes.${key}.value`; newVal = currentVal + 1; upgradeText = `${label} Attribute to ${newVal}`;
          } else if (type === "skill" || type === "customSkill" || type === "esoterica") {
            let skillPath = type === "esoterica" ? `system.esoterica.${key}` : (type === "customSkill" ? `system.customSkills.${key}` : `system.skills.${key}`);
            currentVal = type === "esoterica" ? system.esoterica[key] : foundry.utils.getProperty(system, skillPath.replace("system.", "")).value;
            if (currentVal >= 6) return ui.notifications.warn("Skills cannot be upgraded past 6.");
            cost = 1; newPath = type === "esoterica" ? skillPath : `${skillPath}.value`; newVal = currentVal + 1; upgradeText = `${label} to ${newVal}`;
          } else if (type === "ed") {
            cost = 1; newPath = isCustom ? `system.customSkills.${key}.expert` : (isEsoterica ? `system.esoterica.expert` : `system.skills.${key}.expert`); newVal = true; upgradeText = `Expert Die for ${label}`;
          } else if (type === "md") {
            if (target.dataset.hased !== "true") return ui.notifications.warn("You must acquire an Expert Die before upgrading to Master Die (RAW).");
            cost = 5; 
            // FIXED P0 BUG: target system.skills for base skills
            newPath = isCustom ? `system.customSkills.${key}.master` : (isEsoterica ? `system.esoterica.master` : `system.skills.${key}.master`); 
            newVal = true; 
            upgradeText = `Master Die for ${label}`;
            removeEdPath = isCustom ? `system.customSkills.${key}.expert` : (isEsoterica ? `system.esoterica.expert` : `system.skills.${key}.expert`);
          }

          const unspent = system.xp?.value || 0;
          if (cost > unspent) return ui.notifications.error(`Insufficient XP. Upgrading ${label} requires ${cost} XP, but you only have ${unspent}.`);

          const confirm = await reignConfirm("Confirm Advancement", `<p style="font-size: 1.1em; text-align: center;">Spend <strong>${cost} XP</strong> to acquire <strong>${upgradeText}</strong>?</p>`);
          if (!confirm) return;

          const updates = { "system.xp.value": unspent - cost, "system.xp.spent": (system.xp?.spent || 0) + cost, [newPath]: newVal };
          if (removeEdPath) updates[removeEdPath] = false; 
          await this.document.update(updates);
          ui.notifications.info(`Successfully spent ${cost} XP on ${upgradeText}.`);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      rollStat: async function(event, target) {
        try {
          const dataset = target.dataset;
          if (this.document.system.hasTowerShieldPenalty && (dataset.key?.toLowerCase() === "stealth" || dataset.key?.toLowerCase() === "climb")) {
              return ui.notifications.error("Cannot make Stealth or Climb rolls while dragging a massive Tower Shield!");
          }
          await CharacterRoller.rollCharacter(this.document, dataset);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      changeTab: async function(event, target) { 
        try { this._activeTab = target.dataset.tab; this.render(); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemCreate: async function(event, target) { 
        try { await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemEdit: async function(event, target) { 
        try { this.document.items.get(target.dataset.itemId)?.sheet.render(true); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemDelete: async function(event, target) { 
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (!item) return;
          const confirm = await reignConfirm(`Delete ${item.name}?`, `<p style="text-align: center; font-size: 1.1em;">Are you sure you want to permanently delete <strong>${item.name}</strong>?<br>This action cannot be undone.</p>`);
          if (confirm) await item.delete(); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleEquip: async function(event, target) {
        try { const item = this.document.items.get(target.dataset.itemId); if (item) await item.update({ "system.equipped": !item.system.equipped }); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleStationary: async function(event, target) {
        try { const item = this.document.items.get(target.dataset.itemId); if (item) await item.update({ "system.isStationary": !item.system.isStationary }); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      addCustomSkill: async function(event, target) {
        try { await this.document.update({ [`system.customSkills.${foundry.utils.randomID()}`]: { attribute: target.dataset.attr, customLabel: "", value: 0, expert: false, master: false, isCombat: false } }); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      deleteCustomSkill: async function(event, target) { 
        try { await this.document.update({ [`system.customSkills.-=${target.dataset.skillId}`]: null }); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      addCustomMove: async function(event, target) {
        try { await this.document.update({ [`system.customMoves.${foundry.utils.randomID()}`]: { name: "", attrKey: "none", skillKey: "none", modifier: 0 } }); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      deleteCustomMove: async function(event, target) { 
        try { await this.document.update({ [`system.customMoves.-=${target.dataset.moveId}`]: null }); } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemToChat: async function(event, target) {
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (!item) return;
          const safeName = foundry.utils.escapeHTML(item.name);
          let rawDesc = String(item.system.notes || item.system.effect || "").replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "").replace(/<img[\s\S]*?>/gi, "").replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "").replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "").replace(/<embed[\s\S]*?>/gi, "");
          const safeDesc = await TextEditor.enrichHTML(rawDesc, { async: true, secrets: this.document.isOwner, relativeTo: this.document });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><div>${safeDesc}</div></div>` });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      toggleShieldLocation: async function(event, target) {
        if (this._isTogglingShield) return; 
        this._isTogglingShield = true;
        
        try {
          const locKey = target.dataset.loc;
          const shieldId = target.dataset.shieldId;
          const shield = this.document.items.get(shieldId);
          if (!shield) return;

          const sys = shield.system;
          const currentLocs = foundry.utils.deepClone(sys.protectedLocations);
          
          if (sys.shieldSize === "tower") {
              if (!sys.isStationary) return ui.notifications.warn("Cannot adjust protection while moving. The shield only covers your arm.");
              const carryingArm = sys.shieldArm || "armL";
              const carryingLeg = carryingArm === "armL" ? "legL" : "legR";
              if (locKey === carryingArm || locKey === carryingLeg) return ui.notifications.warn("Tower Shields automatically protect the carrying arm and leg while stationary.");

              if (currentLocs[locKey]) currentLocs[locKey] = false;
              else {
                  const activeManual = Object.keys(currentLocs).filter(k => currentLocs[k] && k !== carryingArm && k !== carryingLeg);
                  if (activeManual.length >= 2) for (const k of activeManual) currentLocs[k] = false;
                  currentLocs[locKey] = true;
              }
          } else {
              const limits = { small: 1, large: 2 }; 
              const max = limits[sys.shieldSize] || 1;
              if (currentLocs[locKey]) currentLocs[locKey] = false;
              else {
                  const active = Object.keys(currentLocs).filter(k => currentLocs[k]);
                  if (active.length >= max) for (const k of active) currentLocs[k] = false;
                  currentLocs[locKey] = true;
              }
          }
          await shield.update({ "system.protectedLocations": currentLocs });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); } finally { this._isTogglingShield = false; }
      },
      createEffect: async function(event, target) { await this.document.createEmbeddedDocuments("ActiveEffect", [{ name: `New Effect`, img: "icons/svg/aura.svg", origin: this.document.uuid, disabled: false }]); },
      editEffect: async function(event, target) { this.document.effects.get(target.closest(".effect-item").dataset.effectId)?.sheet.render(true); },
      deleteEffect: async function(event, target) {
        const effect = this.document.effects.get(target.closest(".effect-item").dataset.effectId);
        if (effect) { await effect.delete(); }
      },
      toggleEffect: async function(event, target) {
        const effect = this.document.effects.get(target.closest(".effect-item").dataset.effectId);
        if (effect) { await effect.update({ disabled: !effect.disabled }); }
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/character-sheet.hbs" } };

  /**
   * Extends the base _onFirstRender to attach advanced mouse listeners for silhouettes.
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const html = this.element;

    html.addEventListener('contextmenu', (ev) => {
        if (ev.target.closest('.hit-zone') || ev.target.closest('.health-box')) ev.preventDefault();
    });

    html.addEventListener('mousedown', (ev) => {
        const zone = ev.target.closest('.hit-zone');
        if (zone) { ev.preventDefault(); this._handleSilhouetteClick(ev, zone); return; }
        const healthBox = ev.target.closest('.health-box');
        if (healthBox) { ev.preventDefault(); this._handleHealthBoxClick(ev, healthBox); }
    });
  }

  /**
   * Handles right-click/shift-click damage logic on the SVG Silhouette.
   */
  async _handleSilhouetteClick(event, target) {
      const locKey = target.dataset.loc || target.getAttribute('data-loc');
      if (!locKey) return;
      
      const actor = this.document;
      let shock = parseInt(actor.system.health[locKey]?.shock) || 0;
      let killing = parseInt(actor.system.health[locKey]?.killing) || 0;
      let max = parseInt(actor.system.effectiveMax?.[locKey]) || 5;

      if (event.shiftKey) {
          if (killing > 0) killing--;
          else if (shock > 0) shock--;
      } else if (event.button === 2) {
          if (killing < max) { killing++; if (shock + killing > max && shock > 0) shock--; }
      } else {
          if (shock + killing < max) shock++;
          else if (shock > 0 && killing < max) { shock--; killing++; } 
      }

      await actor.update({ [`system.health.${locKey}.shock`]: shock, [`system.health.${locKey}.killing`]: killing });
      await syncCharacterStatusEffects(actor);
  }

  /**
   * Handles standard physical box clicking for Health.
   */
  async _handleHealthBoxClick(ev, box) {
      const locKey = box.closest(".health-track")?.dataset?.loc;
      if (!locKey) return;

      const actor = this.document;
      let shock = parseInt(actor.system.health[locKey]?.shock) || 0;
      let killing = parseInt(actor.system.health[locKey]?.killing) || 0;
      let max = parseInt(actor.system.effectiveMax?.[locKey]) || 5;
      
      if (ev.button === 0) { 
         if (shock + killing < max) shock++;
         else if (shock > 0) { shock--; killing++; } 
      } else if (ev.button === 2) { 
         if (shock > 0) shock--;
         else if (killing > 0) killing--;
      }

      await actor.update({ [`system.health.${locKey}.shock`]: shock, [`system.health.${locKey}.killing`]: killing });
      await syncCharacterStatusEffects(actor);
  }

  /**
   * Standardizes form output types and string inputs prior to database commitment.
   */
  _prepareSubmitData(event, form, formData) {
    let data = super._prepareSubmitData(event, form, formData);
    let flatData = foundry.utils.flattenObject(data);
    let changed = false;

    for (const key in flatData) {
        if (key.endsWith(".value") || key.endsWith(".sorcery") || key.endsWith(".spent") || key.endsWith(".modifier") || key.endsWith(".cost") || key.endsWith(".bonus") || key.endsWith(".quantity") || key.endsWith(".intensity") || key.endsWith(".parryBonus") || key.endsWith(".coverAR")) {
            if (flatData[key] === "" || flatData[key] === null) { flatData[key] = 0; changed = true; } 
            else if (typeof flatData[key] === "string" && !isNaN(parseInt(flatData[key]))) { flatData[key] = parseInt(flatData[key]) || 0; changed = true; }
        }
    }
    return changed ? foundry.utils.expandObject(flatData) : data;
  }

  /**
   * Prepares the entire data model for rendering the Handlebars template.
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.actor = this.document;
    context.system = system;
    context.appId = this.id; 

    const effMax = system.effectiveMax;
    const effArmor = system.effectiveArmor;

    context.creationMode = system.creationMode || false;
    context.progressionMode = this.document.getFlag("reign", "progressionMode") || false;
    this._activeTab = this._activeTab || "stats";
    context.tabs = { stats: this._activeTab === "stats" ? "active" : "", combat: this._activeTab === "combat" ? "active" : "", esoterica: this._activeTab === "esoterica" ? "active" : "", biography: this._activeTab === "biography" ? "active" : "", effects: this._activeTab === "effects" ? "active" : "" };

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
      let compiledSkills = skills.map(s => ({ key: s.key, label: s.label, isCustom: false, value: system.skills[s.key]?.value || 0, expert: system.skills[s.key]?.expert || false, master: system.skills[s.key]?.master || false }));
      if (system.customSkills) Object.entries(system.customSkills).forEach(([id, cSk]) => { if (cSk.attribute === attrKey) compiledSkills.push({ key: id, isCustom: true, customLabel: cSk.customLabel, value: cSk.value, expert: cSk.expert, master: cSk.master, isCombat: cSk.isCombat }); });
      return { key: attrKey, label: attrKey.toUpperCase(), value: system.attributes[attrKey].value, skills: compiledSkills };
    });

    const bodyVal = system.attributes?.body?.value || 0;
    const coordVal = system.attributes?.coordination?.value || 0;
    const parryVal = system.skills?.parry?.value || 0;
    const dodgeVal = system.skills?.dodge?.value || 0;
    
    const items = this.document.items;
    const buckets = { weapon: [], technique: [], spell: [], discipline: [], gear: [], advantage: [], problem: [], armor: [], shield: [] };
    const equippedShields = [];
    
    for (const item of items) {
        if (buckets[item.type] !== undefined) {
            let tooltip = "";
            let showWarning = false;
            const sys = item.system;

            if (item.type === "weapon") {
                tooltip = `Damage: ${sys.damageFormula || sys.damage || 'None'}`;
                const q = [];
                if (sys.qualities?.armorPiercing) q.push(`AP ${sys.qualities.armorPiercing}`);
                if (sys.qualities?.slow) q.push(`Slow ${sys.qualities.slow}`);
                if (sys.qualities?.twoHanded) q.push("2H");
                if (sys.qualities?.massive) q.push("Massive");
                if (sys.qualities?.area) q.push(`Area ${sys.qualities.area}d`);
                if (q.length) tooltip += ` | ${q.join(", ")}`;
            } else if (item.type === "armor") {
                tooltip = `AR: ${sys.ar || 0} | Weight: ${(sys.armorWeight || 'none').toUpperCase()}`;
                
                const arVal = parseInt(sys.ar) || 0;
                const weight = sys.armorWeight || "light";
                const isExplicitlyManual = sys.isManualWeight || sys.overrideWeight || sys.customWeight;
                
                if (isExplicitlyManual || (arVal > 2 && weight === "light") || (arVal > 4 && weight === "medium")) {
                    showWarning = true;
                }
            } else if (item.type === "shield") {
                tooltip = `Parry: +${sys.parryBonus || 0}d | AR: ${sys.coverAR || 0}`;
            } else if (item.type === "spell" || item.type === "technique" || item.type === "discipline") {
                tooltip = `Pool: ${sys.pool || 'None'}`;
            }

            item.uiTooltip = tooltip;
            item.uiWarning = showWarning;

            buckets[item.type].push(item);
        }
        
        if (item.type === "shield" && item.system.equipped) equippedShields.push(item);
    }
    
    Object.assign(context, {
        weapons: buckets.weapon, techniques: buckets.technique, spells: buckets.spell,
        disciplines: buckets.discipline, gear: buckets.gear, advantages: buckets.advantage,
        problems: buckets.problem, armors: buckets.armor, shields: buckets.shield,
        activeShields: equippedShields
    });

    let shieldBonus = 0;
    const parryShields = equippedShields.filter(s => s.system.shieldSize !== "tower");
    if (parryShields.length > 0) shieldBonus = Math.max(...parryShields.map(s => s.system.parryBonus || 0));

    context.preferredMoves = { body: bodyVal, coord: coordVal, parry: parryVal, dodge: dodgeVal, parryTotal: system.baseParryPool + shieldBonus, dodgeTotal: system.baseDodgePool, shieldBonus: shieldBonus };

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

    // AUDIT FIX B3: Health Dual-Loop Consolidated into a single O(N) pass
    context.health = {};
    context.reignHealth = [];
    const locKeys = ["head", "torso", "armR", "armL", "legR", "legL"];
    const labelMap = { head: "Head (10)", torso: "Torso (7–9)", armR: "R. Arm (5–6)", armL: "L. Arm (3–4)", legR: "R. Leg (2)", legL: "L. Leg (1)" };
    
    for (let k of locKeys) {
        const loc = foundry.utils.deepClone(system.health[k]);
        loc.max = parseInt(effMax?.[k]) || 5;
        loc.killing = parseInt(loc.killing) || 0;
        loc.shock = parseInt(loc.shock) || 0;
        loc.killPct = Math.min(100, Math.round((loc.killing / loc.max) * 100));
        loc.shockPct = Math.min(100, Math.round(((loc.killing + loc.shock) / loc.max) * 100));
        
        let status = "status-healthy";
        if (loc.killing >= loc.max) status = "status-destroyed";
        else if (loc.killing > 0) status = "status-killing";
        else if (loc.shock > 0) status = "status-shock";
        
        loc.status = status;
        context.health[k] = loc;

        let boxes = Array.from({length: loc.max}).map((_, i) => {
            if (i < loc.killing) return { state: "killing", icon: "X" };
            if (i < loc.killing + loc.shock) return { state: "shock", icon: "/" };
            return { state: "empty", icon: "" };
        });

        let isShielded = false;
        if (equippedShields.length > 0) {
            isShielded = equippedShields.some(shield => { return !!(shield.system.effectiveLocations || shield.system.protectedLocations || {})[k]; });
        }

        context.reignHealth.push({ key: k, label: labelMap[k], boxes: boxes, armor: effArmor?.[k] || 0, isShielded: isShielded });
    }

    const autoStatuses = new Set(["dead", "unconscious", "dazed", "maimed", "prone", "bleeding"]);
    context.autoEffects = [];
    context.manualEffects = [];
    
    for (let e of this.document.effects) {
      if (Array.from(e.statuses).some(s => autoStatuses.has(s))) context.autoEffects.push(e);
      else context.manualEffects.push(e);
    }
    context.effects = Array.from(this.document.effects);

    return context;
  }
}