// scripts/sheets/threat-sheet.js
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
import { parseORE } from "../helpers/ore-engine.js";
import { postOREChat } from "../helpers/chat.js";

export class ReignThreatSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor", "threat"], position: { width: 500, height: "auto" }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollThreat: async function(event, target) {
        const system = this.document.system;
        const basePool = system.threatLevel || 0;
        
        let content = `<form class="reign-dialog-form">
          <div class="form-group"><label>Base Threat Level:</label><input type="number" disabled value="${basePool}"/></div>
          <div class="dialog-grid dialog-grid-2">
            <div class="form-group"><label>Ganging Up / Bonus Dice (+d):</label><input type="number" name="bonus" value="0"/></div>
            <div class="form-group"><label>Penalty Dice (-d):</label><input type="number" name="penalty" value="0"/></div>
          </div>
        </form>`;
        
        const rollData = await DialogV2.wait({
          classes: ["reign-dialog-window"],
          window: { title: `Roll Threat Action` },
          content: content,
          buttons: [{
            action: "roll", label: "Roll Horde", default: true,
            callback: (e, b, d) => {
              const f = d.element.querySelector("form");
              return {
                bonus: parseInt(f.querySelector('[name="bonus"]').value) || 0,
                penalty: parseInt(f.querySelector('[name="penalty"]').value) || 0
              };
            }
          }]
        });
        
        if (!rollData) return;
        
        let intendedPool = basePool + rollData.bonus - rollData.penalty;
        let diceToRoll = Math.min(intendedPool, 15);
        let wasCapped = intendedPool > 15;
        
        if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced the horde's dice pool below 1. They hesitate or miss entirely!");
        
        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        
        // FIXED: Changed system.damageFormula to system.damage so the chat card can read it!
        const pseudoWeapon = { type: "weapon", system: { damage: system.damageFormula || "Width Shock" } };
        await postOREChat(this.document, "Horde Attack", diceToRoll, results, 0, 0, pseudoWeapon, { wasCapped, isAttack: true, isMinion: true });
      },
      rollMorale: async function(event, target) {
        const system = this.document.system;
        const pool = system.threatLevel || 0;
        if (pool < 1) return ui.notifications.warn("Threat Level is 0! The horde cannot roll Morale.");

        const roll = new Roll(`${pool}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        const parsed = parseORE(results);

        let content = `<div class="reign-chat-card"><header><h3>Morale Check</h3></header>`;
        content += `<div class="pool-details">Pool: ${pool}d10</div><hr>`;

        if (parsed.sets.length > 0) {
            content += `<div class="sets-result"><span style="color: #2d5a27; font-weight: bold;">SUCCESS!</span> The horde holds its ground.</div>`;
        } else {
            content += `<div class="sets-result"><span style="color: #8b1f1f; font-weight: bold;">FAILURE!</span> Morale breaks.</div>`;
            let currentMorale = system.morale?.value || 0;
            let newMorale = Math.max(0, currentMorale - 1);
            await this.document.update({ "system.morale.value": newMorale });
            content += `<div class="waste-result">Morale drops to ${newMorale}.</div>`;
            
            if (newMorale === 0) {
                content += `<div class="waste-result" style="color: #8b1f1f; font-weight: bold; font-size: 1.2em; text-align: center; margin-top: 10px;">THE HORDE ROUTS!</div>`;
            }
        }
        content += `</div>`;
        
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
      }
    }
  };
  
  static PARTS = { sheet: { template: "systems/reign/templates/actor/threat-sheet.hbs" } };
  
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    
    const companyList = {};
    game.actors.filter(a => a.type === "company").forEach(c => {
      companyList[c.id] = c.name;
    });
    context.companies = companyList;
    
    return context;
  }
}