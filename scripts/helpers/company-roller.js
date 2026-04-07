// scripts/helpers/company-roller.js
const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;
import { postOREChat } from "./chat.js";

// AUDIT FIX P3: Import standard reignRender and reignClose
import { reignRender, reignClose } from "./dialog-util.js";

export class CompanyRoller {
  static async rollCompany(actor, dataset) {
    const key1 = dataset.key || "might";
    const system = actor.system;
    
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

    const presetOptions = {};
    for (const [k, v] of Object.entries(companyActions)) { presetOptions[k] = v.label; }
    
    const qualityOptions = { "might": "Might", "treasure": "Treasure", "influence": "Influence", "territory": "Territory", "sovereignty": "Sovereignty" };
    const qualityOptionsWithNone = { "none": "None", ...qualityOptions };
    const costOptions = { "none": "None (Free)", ...qualityOptions };

    const templateData = { presetOptions, qualityOptions, qualityOptionsWithNone, costOptions, key1 };
    const content = await renderTemplate("systems/reign/templates/dialogs/roll-company.hbs", templateData);
    
    const rollData = await DialogV2.wait({ 
      classes: ["reign-dialog-window"], 
      window: { title: "Company Action", resizable: true }, 
      position: { width: 400, height: "auto" },
      content: content,
      rejectClose: false,
      render: (event, html) => {
        // Use standard renderer for safe cleanup
        const element = reignRender(event, html);
        if (!element) return;

        const f = element.querySelector("form");
        const poolPreviewSpan = element.querySelector("#pool-value");
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
        reignClose(d);
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
}