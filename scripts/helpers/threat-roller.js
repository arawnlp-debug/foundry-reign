// scripts/helpers/threat-roller.js
const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;
import { postOREChat } from "./chat.js";
import { parseORE } from "./ore-engine.js";

// AUDIT FIX P3: Import standard reignRender and reignClose
import { reignRender, reignClose } from "./dialog-util.js";

// AUDIT FIX B16: Import REIGN constants to unhardcode pool caps
import { REIGN } from "./config.js";

export class ThreatRoller {
  static async rollThreat(actor, dataset) {
    const system = actor.system;

    if (system.morale?.value === 0) return ui.notifications.warn(game.i18n.localize("REIGN.ThreatMoraleZero"));

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
            let bonus = parseInt(f.querySelector('[name="bonus"]').value) || 0;
            let penalty = parseInt(f.querySelector('[name="penalty"]').value) || 0;
            let current = basePool + bonus - penalty;

            // AUDIT FIX B16: Unhardcoded pool caps using config constant for preview
            const maxDice = REIGN.MAX_DICE || 15;

            if (current > maxDice) {
                poolPreviewSpan.textContent = `${maxDice} (Capped)`;
                poolPreviewSpan.style.color = "#d97706";
            } else if (current < 1) {
                poolPreviewSpan.textContent = `${current} (Fails)`;
                poolPreviewSpan.style.color = "#ef5350";
            } else {
                poolPreviewSpan.textContent = current;
                poolPreviewSpan.style.color = "#4ade80";
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
    
    // AUDIT FIX B16: Centralized max dice constant applied to roll execution
    const maxDice = REIGN.MAX_DICE || 15;
    let diceToRoll = Math.min(intendedPool, maxDice);
    let wasCapped = intendedPool > maxDice;
    
    if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced the horde's pool below 1. They hesitate!");
    
    const roll = new Roll(`${diceToRoll}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];
    
    const pseudoWeapon = { 
        type: "weapon", 
        name: actor.name, 
        system: { 
            damage: system.damageFormula || game.i18n.localize("REIGN.DamagePlaceholder") || "Width Shock"
        }
    };
    
    await postOREChat(actor, game.i18n.localize("REIGN.RollThreatAction"), diceToRoll, results, 0, 0, pseudoWeapon, { isMinion: true });
    
    if (wasCapped) {
        ui.notifications.info(`Pool capped at ${maxDice} dice due to system limits.`);
    }
  }

  // AUDIT FIX P2: Threat Morale Automation
  static async rollMorale(actor) {
    const system = actor.system;
    const moraleVal = system.morale?.value || 0;

    if (moraleVal < 1) {
        return ui.notifications.warn(game.i18n.localize("REIGN.ThreatMoraleZero"));
    }

    const maxDice = REIGN.MAX_DICE || 15;
    let diceToRoll = Math.min(moraleVal, maxDice);
    let wasCapped = moraleVal > maxDice;

    const roll = new Roll(`${diceToRoll}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];

    const parsed = parseORE(results);
    let routed = parsed.sets.length === 0;

    let outcomeText = routed 
        ? `<span style="color: #b71c1c; font-weight: bold; font-size: 1.1em; display: block; margin-top: 5px;">${game.i18n.localize("REIGN.ThreatRoutes")}</span>`
        : `<span style="color: #2e7d32; font-weight: bold; display: block; margin-top: 5px;">${game.i18n.localize("REIGN.ThreatMoraleHold")}</span>`;

    let actionLabel = game.i18n.localize("REIGN.RollMorale") + outcomeText;

    await postOREChat(actor, actionLabel, diceToRoll, results, 0, 0, null, { isMinion: true, wasCapped });

    if (routed) {
        // Apply the core 'dead' / defeated status effect to visually mark the token as routed
        await actor.toggleStatusEffect("dead", { active: true });
        
        // Mechanically zero out their morale so they can no longer act
        await actor.update({ "system.morale.value": 0 });
    }
  }
}