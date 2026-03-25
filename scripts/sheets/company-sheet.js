// scripts/sheets/company-sheet.js
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
import { postOREChat } from "../helpers/chat.js";

export class ReignCompanySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor", "company"], position: { width: 700, height: 800 }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollCompanyStat: async function(event, target) {
        const key1 = target.dataset.key || "might";
        const system = this.document.system;
        
        // ACTION CATALOG WITH RAW COSTS
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

        const qualityOptions = `
          <option value="none">None</option>
          <option value="might">Might</option>
          <option value="treasure">Treasure</option>
          <option value="influence">Influence</option>
          <option value="territory">Territory</option>
          <option value="sovereignty">Sovereignty</option>
        `;

        let content = `<form class="reign-dialog-form">
          <div class="form-group" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed #ccc;">
            <label style="color: #8b1f1f; font-weight: bold;">Action Catalog (Auto-fills pools & difficulty):</label>
            <select name="preset" id="reign-action-preset">
                ${presetOptions}
            </select>
          </div>
          <div class="dialog-grid dialog-grid-2">
            <div class="form-group">
                <label>Primary Quality:</label>
                <select name="q1" id="reign-q1">
                    <option value="might" ${key1 === "might" ? "selected" : ""}>Might</option>
                    <option value="treasure" ${key1 === "treasure" ? "selected" : ""}>Treasure</option>
                    <option value="influence" ${key1 === "influence" ? "selected" : ""}>Influence</option>
                    <option value="territory" ${key1 === "territory" ? "selected" : ""}>Territory</option>
                    <option value="sovereignty" ${key1 === "sovereignty" ? "selected" : ""}>Sovereignty</option>
                </select>
            </div>
            <div class="form-group">
                <label>Secondary Quality:</label>
                <select name="q2" id="reign-q2">${qualityOptions}</select>
            </div>
          </div>
          <div class="dialog-grid dialog-grid-2" style="margin-top: 10px;">
            <div class="form-group"><label>Difficulty (Min Height):</label><input type="number" name="difficulty" id="reign-diff" value="0" min="0" max="10"/></div>
            <div class="form-group"><label>Mod Dice (+d):</label><input type="number" name="mod" value="0"/></div>
          </div>
          
          <div class="dialog-grid dialog-grid-2" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ccc;">
            <div class="form-group">
              <label style="color: #d97706; font-weight: bold;">Action Cost (Pay 1 Temp):</label>
              <select name="cost" id="reign-cost">
                  ${qualityOptions.replace('value="none"', 'value="none" selected').replace('None', 'None (Free)')}
              </select>
            </div>
            <div class="form-group">
              <label>Target Quality (If Attacking):</label>
              <select name="targetQuality" id="reign-target">
                  ${qualityOptions}
              </select>
            </div>
          </div>
        </form>`;
        
        const rollData = await DialogV2.wait({ 
          classes: ["reign-dialog-window"], 
          window: { title: `Company Action` }, 
          content: content,
          render: (event, html) => {
            const element = event?.target?.element ?? (event instanceof HTMLElement ? event : null);
            if (!element) return;
            
            const presetSelect = element.querySelector('#reign-action-preset');
            const q1Select = element.querySelector('#reign-q1');
            const q2Select = element.querySelector('#reign-q2');
            const diffInput = element.querySelector('#reign-diff');
            const targetSelect = element.querySelector('#reign-target');
            const costSelect = element.querySelector('#reign-cost');

            // Listen for preset action selections and auto-populate
            presetSelect.addEventListener('change', (ev) => {
              const val = ev.target.value;
              if (val !== "none" && companyActions[val]) {
                const action = companyActions[val];
                q1Select.value = action.q1;
                q2Select.value = action.q2;
                diffInput.value = action.diff;
                targetSelect.value = action.target;
                costSelect.value = action.cost;
              }
            });
          },
          buttons: [{ action: "roll", label: "Roll ORE", default: true, callback: (e, b, d) => { 
            const f = d.element.querySelector("form"); 
            const presetKey = f.querySelector('[name="preset"]').value;
            const presetLabel = presetKey !== "none" ? companyActions[presetKey].label : null;

            return { 
                q1: f.querySelector('[name="q1"]').value,
                q2: f.querySelector('[name="q2"]').value,
                difficulty: parseInt(f.querySelector('[name="difficulty"]').value) || 0,
                mod: parseInt(f.querySelector('[name="mod"]').value) || 0,
                targetQuality: f.querySelector('[name="targetQuality"]').value,
                cost: f.querySelector('[name="cost"]').value,
                presetLabel: presetLabel
            }; 
          } }] 
        });
        
        if (!rollData) return;
        
        let val1 = system.qualities[rollData.q1]?.current || 0;
        let val2 = rollData.q2 !== "none" ? (system.qualities[rollData.q2]?.current || 0) : 0;
        
        let intendedPool = val1 + val2 + rollData.mod;
        let diceToRoll = Math.min(intendedPool, 10);
        let wasCapped = intendedPool > 10;
        
        if (diceToRoll < 1) return ui.notifications.warn("Company dice pool reduced below 1. Action fails.");

        // NEW: Handle Action Cost Deduction Automatically (Fixed HTML escaping)
        let costPaidNotice = "";
        if (rollData.cost !== "none") {
            let currentTemp = system.qualities[rollData.cost]?.current || 0;
            if (currentTemp > 0) {
                await this.document.update({ [`system.qualities.${rollData.cost}.current`]: currentTemp - 1 });
                costPaidNotice = ` [Paid 1 Temp ${rollData.cost.toUpperCase()}]`;
            } else {
                ui.notifications.warn(`${this.document.name} has 0 Temporary ${rollData.cost.toUpperCase()} and cannot pay the cost! Proceeding as a desperate measure...`);
                costPaidNotice = ` [Desperate! 0 Temp ${rollData.cost.toUpperCase()}]`;
            }
        }

        const roll = new Roll(`${diceToRoll}d10`); 
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];

        let actionLabel = rollData.presetLabel ? `Company Action: ${rollData.presetLabel}` : `Company Action`;
        actionLabel += costPaidNotice;

        await postOREChat(this.document, actionLabel, diceToRoll, results, 0, 0, null, { 
            targetQuality: rollData.targetQuality, 
            wasCapped: wasCapped,
            difficulty: rollData.difficulty 
        });
      },
      itemCreate: async function(event, target) { await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); },
      itemEdit: async function(event, target) { this.document.items.get(target.dataset.itemId)?.sheet.render(true); },
      itemDelete: async function(event, target) { await this.document.items.get(target.dataset.itemId)?.delete(); },
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

  static PARTS = { sheet: { template: "systems/reign/templates/actor/company-sheet.hbs" } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    
    const qs = context.system.qualities || {};
    context.qualities = ["might", "treasure", "influence", "territory", "sovereignty"].map(k => ({ 
        key: k, 
        label: k.toUpperCase(), 
        ...qs[k] 
    }));

    // NEW: Pull Assets and Liabilities into the context
    const items = this.document.items;
    context.assets = items.filter(i => i.type === "advantage");
    context.problems = items.filter(i => i.type === "problem");
    
    return context;
  }
}