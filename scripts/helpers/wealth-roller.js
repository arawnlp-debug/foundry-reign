// scripts/helpers/wealth-roller.js
const { renderTemplate } = foundry.applications.handlebars;
import { parseORE } from "./ore-engine.js";
import { postOREChat } from "./chat.js";
import { reignDialog, reignAlert, reignClose } from "./dialog-util.js";

// AUDIT FIX B12: Import the standalone pool calculator correctly
import { calculateOREPool } from "./character-roller.js";

export class WealthRoller {
  static async rollWealthPurchase(actor) {
    const system = actor.system;
    const currentWealth = system.wealth?.value || 0;

    const content = await renderTemplate("systems/reign/templates/dialogs/roll-wealth.hbs", { currentWealth });

    const cost = await reignDialog(
      game.i18n.localize("REIGN.PurchaseHelper") || "Purchase Helper",
      content,
      (e, b, d) => parseInt(d.element.querySelector('[name="cost"]').value) || 0,
      { defaultLabel: "Check Affordability" }
    );

    if (cost === undefined || cost === null) return;
    
    // AUDIT FIX P3: Removed 250ms "Breather" timeouts for snappier UI

    if (cost < currentWealth) {
      await ChatMessage.create({ 
        speaker: ChatMessage.getSpeaker({actor: actor}), 
        content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Trivial Purchase</h3><p>Item Cost (${cost}) is below Wealth (${currentWealth}). The purchase is trivial and succeeds automatically.</p></div>` 
      });
      
      await reignAlert(
        "Purchase Trivial",
        `<p style="font-size: 1.1em; text-align: center;">Cost ${cost} is below your Wealth ${currentWealth}.<br><br><strong>The purchase is trivial and costs nothing!</strong></p>`
      );
      
    } else if (cost > currentWealth) {
      await ChatMessage.create({ 
        speaker: ChatMessage.getSpeaker({actor: actor}), 
        content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Purchase Impossible</h3><p>Item Cost (${cost}) exceeds Wealth (${currentWealth}). The character cannot afford this item.</p></div>` 
      });
      
      await reignAlert(
        "Purchase Impossible",
        `<p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Cost ${cost} exceeds your Wealth ${currentWealth}.<br><br><strong>You cannot afford this item.</strong></p>`
      );
      
    } else {
      const confirmContent = `
          <div class="reign-dialog-form">
            <p>This item's Cost (${cost}) equals your current Wealth.</p>
            <p>You can outright buy it and <strong>lose 1 Wealth</strong>, or attempt to save your wealth by rolling <strong>Wealth</strong> or <strong>Command + Haggle</strong>.</p>
            <p><em>(On a success, you keep your Wealth. On a failure, it drops by 1.)</em></p>
          </div>
      `;
      
      const action = await reignDialog(
        "Significant Purchase",
        confirmContent,
        null, 
        {
          buttons: [
            { action: "buy", label: "Pay 1 Wealth", callback: (e, b, d) => { reignClose(d); return "buy"; } },
            { action: "roll_wealth", label: "Roll Wealth", callback: (e, b, d) => { reignClose(d); return "roll_wealth"; } },
            { action: "haggle", label: "Roll Haggle", callback: (e, b, d) => { reignClose(d); return "haggle"; } }
          ]
        }
      );

      if (!action) return;

      if (action === "buy") {
        const newWealth = Math.max(0, currentWealth - 1);
        await actor.update({ "system.wealth.value": newWealth });
        
        await ChatMessage.create({ 
          speaker: ChatMessage.getSpeaker({actor: actor}), 
          content: `<div class="reign-chat-card"><h3 style="color: #d97706;">Significant Purchase</h3><p>Item Cost (${cost}) equals Wealth. Paid outright. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
        });

        await reignAlert(
          "Purchase Complete",
          `<p style="font-size: 1.1em; text-align: center;">Purchased!<br><br>Your Wealth drops to <strong>${newWealth}</strong>.</p>`
        );
        
      } else if (action === "roll_wealth") {
        if (currentWealth < 2) {
          const newWealth = Math.max(0, currentWealth - 1);
          await actor.update({ "system.wealth.value": newWealth });
          
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: actor}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Wealth Roll Failed</h3><p>Wealth pool is too small to attempt a roll. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
          });
          
          await reignAlert(
            "Wealth Roll Failed",
            `<p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Wealth pool is too small to attempt a roll (Requires at least 2 dice).<br><br>Wealth drops to <strong>${newWealth}</strong>.</p>`
          );
          return;
        }

        let diceToRoll = Math.min(currentWealth, 10);
        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        
        const parsed = parseORE(results);
        if (parsed.sets.length > 0) {
            await postOREChat(actor, "Wealth Roll (Purchase)", currentWealth, results, 0, 0);
            
            await reignAlert(
              "Purchase Succeeded",
              `<p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Roll succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p>`
            );
        } else {
            const newWealth = Math.max(0, currentWealth - 1);
            await actor.update({ "system.wealth.value": newWealth });
            await postOREChat(actor, "Wealth Roll (Purchase)", currentWealth, results, 0, 0);
            
            await reignAlert(
              "Purchase Failed",
              `<p style="font-size: 1.1em; text-align: center; color: #d97706;">Roll failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p>`
            );
        }
      } else if (action === "haggle") {
        
        // Setup base values for Haggle
        const commandVal = parseInt(system.attributes.command?.value) || 0;
        const haggleVal = parseInt(system.skills.haggle?.value) || 0;
        let hasEdInput = system.skills.haggle?.expert ? 10 : 0; // Temp dummy value for ED
        let hasMdInput = system.skills.haggle?.master ? true : false;
        
        let rawTotal = commandVal + haggleVal;

        if (rawTotal < 2) {
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: actor}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Haggle Failed</h3><p>Command + Haggle pool is too small to attempt haggling.</p></div>` 
          });
          
          await reignAlert(
            "Haggle Failed",
            `<p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Command + Haggle pool is too small to attempt haggling (Requires at least 2 dice).</p>`
          );
          return;
        }

        // If they have an Expert die, prompt for the face value first
        if (hasEdInput > 0) {
            const edChoice = await reignDialog(
              "Set Expert Die (Haggle)",
              `<form class="reign-dialog-form"><div class="form-group"><label>Expert Die Face:</label><input type="number" name="edFace" value="10" min="1" max="10"/></div></form>`,
              (e, b, d) => parseInt(d.element.querySelector('[name="edFace"]').value) || 10,
              { defaultLabel: "Roll Haggle" }
            );
            
            if (!edChoice) return;
            hasEdInput = edChoice;
        }

        // AUDIT FIX B12: Standardize Haggle pool using calculateOREPool
        // Passing: rawTotal, edFaceInput, hasMdInput, calledShotInput, basePenalty, multiActions
        const poolMath = calculateOREPool(rawTotal, hasEdInput, hasMdInput, 0, 0, 1);

        if (poolMath.diceToRoll < 1) {
             return ui.notifications.warn("Penalties reduced your dice pool below 1. Haggle fails.");
        }

        let results = [];
        if (poolMath.normalDiceCount > 0) {
          const roll = new Roll(`${poolMath.normalDiceCount}d10`);
          await roll.evaluate();
          results = roll.dice[0]?.results.map(r => r.result) || [];
        }

        if (poolMath.actualEd > 0) results.push(poolMath.finalEdFace);
        if (poolMath.actualCs > 0) results.push(poolMath.finalCalledShot);
        
        const finalizeHaggle = async (finalResults, mdCount, edCount, edVal) => {
            const parsed = parseORE(finalResults);
            
            // Haggle success requires a set with Height >= Cost
            const successSet = parsed.sets.find(s => s.height >= cost);
            
            if (successSet) {
              await postOREChat(actor, "Haggle (Purchase)", rawTotal, finalResults, edCount > 0 ? edVal : 0, mdCount);
              
              await reignAlert(
                "Haggle Succeeded",
                `<p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Haggle succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p>`
              );
            } else {
              const newWealth = Math.max(0, currentWealth - 1);
              await actor.update({ "system.wealth.value": newWealth });
              await postOREChat(actor, "Haggle (Purchase)", rawTotal, finalResults, edCount > 0 ? edVal : 0, mdCount);
              
              await reignAlert(
                "Haggle Failed",
                `<p style="font-size: 1.1em; text-align: center; color: #d97706;">Haggle failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p>`
              );
            }
        };

        if (poolMath.actualMd > 0) {
          results.sort((a, b) => b - a); 
          let mdHtml = `<form class="reign-dialog-form">
            <p style="margin-top: 0; font-size: 1.1em;"><strong>Your Roll so far:</strong> ${results.length > 0 ? results.join(", ") : "None"}</p>
            <p style="font-size: 0.9em; color: #555; margin-bottom: 15px;">Assign a face value to your Master Die to complete your Haggle set.</p>
            <div class="dialog-grid dialog-grid-2">`;
          
          for(let i=0; i<poolMath.actualMd; i++) {
              mdHtml += `<div class="form-group"><label>MD ${i+1} Face:</label><input type="number" id="mdFace${i}" value="10" min="1" max="10"/></div>`;
          }
          mdHtml += `</div></form>`;

          const mdResult = await reignDialog(
            "Assign Master Die (Haggle)",
            mdHtml,
            (e, b, d) => {
                const faces = [];
                for(let i=0; i<poolMath.actualMd; i++) faces.push(parseInt(d.element.querySelector(`#mdFace${i}`).value) || 10);
                return faces;
            },
            { defaultLabel: "Finalize Haggle" }
          );

          if (!mdResult) return;
          results.push(...mdResult);
          await finalizeHaggle(results, poolMath.actualMd, poolMath.actualEd, poolMath.finalEdFace);
        } else {
          await finalizeHaggle(results, 0, poolMath.actualEd, poolMath.finalEdFace);
        }
      }
    }
  }
}