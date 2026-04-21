// scripts/helpers/threat-roller.js
import { postOREChat } from "./chat.js";
import { parseORE } from "./ore-engine.js";
import { reignDialog } from "./dialog-util.js";
import { REIGN } from "./config.js";

const { renderTemplate } = foundry.applications.handlebars;

export class ThreatRoller {
  static async rollThreat(actor, dataset) {
    try {
        console.log("Reign Threat Roller | Execution Started.", dataset);
        const system = actor.system;

        if (system.morale?.value === 0) return ui.notifications.warn(game.i18n.localize("REIGN.ThreatMoraleZero"));

        const basePool = system.threatLevel || 0;
        
        const content = await renderTemplate("systems/reign/templates/dialogs/roll-threat.hbs", { basePool });
        
        // Using the verified reignDialog wrapper
        const rollData = await reignDialog(
          game.i18n.localize("REIGN.RollThreatAction") || "Roll Threat",
          content,
          (e, b, d) => {
              // SAFE FALLBACK: If no <form> exists, use the root dialog element
              const f = d.element.querySelector("form") || d.element;
              return {
                  bonus: parseInt(f.querySelector('[name="bonus"]')?.value) || 0,
                  penalty: parseInt(f.querySelector('[name="penalty"]')?.value) || 0
              };
          },
          {
            defaultLabel: game.i18n.localize("REIGN.RollThreatAction") || "Roll Threat",
            render: (event, html) => {
                let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                if (!element) return;

                // SAFE FALLBACK: Protect against missing HTML elements in roll-threat.hbs
                const f = element.querySelector("form") || element;
                const poolPreviewSpan = element.querySelector("#pool-value");
                
                if (!poolPreviewSpan) {
                    console.warn("Reign Threat Roller | Missing #pool-value span in roll-threat.hbs. Dynamic preview disabled.");
                }

                const updatePool = () => {
                    let bonus = parseInt(f.querySelector('[name="bonus"]')?.value) || 0;
                    let penalty = parseInt(f.querySelector('[name="penalty"]')?.value) || 0;
                    let current = basePool + bonus - penalty;

                    const maxDice = REIGN.MAX_DICE || 15;

                    if (poolPreviewSpan) {
                        if (current > maxDice) {
                            poolPreviewSpan.textContent = `${maxDice} (Capped)`;
                            poolPreviewSpan.style.color = "var(--reign-orange, #d97706)";
                        } else if (current < 1) {
                            poolPreviewSpan.textContent = `${current} (Fails)`;
                            poolPreviewSpan.style.color = "var(--reign-red, #8b1f1f)";
                        } else {
                            poolPreviewSpan.textContent = current;
                            poolPreviewSpan.style.color = "var(--reign-green, #2d5a27)";
                        }
                    }
                };

                f.querySelectorAll("input").forEach(input => {
                    input.addEventListener("input", updatePool);
                    input.addEventListener("change", updatePool);
                });

                updatePool();
            }
          }
        );
        
        if (!rollData) return;
        
        let intendedPool = basePool + rollData.bonus - rollData.penalty;
        const maxDice = REIGN.MAX_DICE || 15;
        let diceToRoll = Math.min(intendedPool, maxDice);
        let wasCapped = intendedPool > maxDice;
        
        if (diceToRoll < 1) return ui.notifications.warn("Penalties reduced the horde's pool below 1. They hesitate!");
        
        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        
        // SAFE ITEM: Construct a complete dummy item so the Chat Card Engine doesn't crash reading missing properties
        const pseudoWeapon = { 
            id: "threat-weapon",
            _id: "threat-weapon",
            type: "weapon", 
            name: actor.name, 
            img: actor.img || "icons/svg/sword.svg",
            system: { 
                damage: system.damageFormula || "Width Shock",
                qualities: {},
                range: "melee"
            }
        };
        
        await postOREChat(actor, game.i18n.localize("REIGN.RollThreatAction") || "Threat Action", diceToRoll, results, 0, 0, pseudoWeapon, { isMinion: true, wasCapped, isAttack: true });
        
    } catch (err) {
        console.error("Reign Threat Roller | CRITICAL EXCEPTION:", err);
        ui.notifications.error("Threat roller crashed. Please press F12 and check the console for details.");
    }
  }

  // Threat Morale Automation
  static async rollMorale(actor) {
    try {
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
            ? `<span style="color: var(--reign-critical, #c62828); font-weight: bold; font-size: 1.1em; display: block; margin-top: 5px;">${game.i18n.localize("REIGN.ThreatRoutes") || "THE HORDE ROUTS!"}</span>`
            : `<span style="color: var(--reign-green, #2d5a27); font-weight: bold; display: block; margin-top: 5px;">${game.i18n.localize("REIGN.ThreatMoraleHold") || "Morale Holds!"}</span>`;

        let actionLabel = (game.i18n.localize("REIGN.RollMorale") || "Morale Check") + outcomeText;

        await postOREChat(actor, actionLabel, diceToRoll, results, 0, 0, null, { isMinion: true, wasCapped });

        if (routed) {
            // Apply the core 'dead' / defeated status effect to visually mark the token as routed
            await actor.toggleStatusEffect("dead", { active: true });
            
            // Mechanically zero out their morale so they can no longer act
            await actor.update({ "system.morale.value": 0 });
        }
    } catch (err) {
        console.error("Reign Threat Roller | Morale Roll Failed:", err);
        ui.notifications.error("Morale roller crashed. Check F12 Console.");
    }
  }
}