// scripts/helpers/threat-roller.js
const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;
import { postOREChat } from "./chat.js";

// AUDIT FIX P3: Import standard reignRender and reignClose
import { reignRender, reignClose } from "./dialog-util.js";

export class ThreatRoller {
  static async rollThreat(actor, dataset) {
    const system = actor.system;

    if (system.morale?.value === 0) return ui.notifications.warn("Morale is broken. Horde routes and cannot act.");

    const basePool = system.threatLevel || 0;
    
    const content = await renderTemplate("systems/reign/templates/dialogs/roll-threat.hbs", { basePool });
    
    const rollData = await DialogV2.wait({
      classes: ["reign-dialog-window"], 
      window: { title: game.i18n.localize("REIGN.RollThreatAction"), resizable: true }, 
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
          reignClose(d);
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
}