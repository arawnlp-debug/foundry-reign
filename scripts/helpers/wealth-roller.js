// scripts/helpers/wealth-roller.js
const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;
import { parseORE } from "./ore-engine.js";
import { postOREChat } from "./chat.js";

export class WealthRoller {
  static async rollWealthPurchase(actor) {
    const system = actor.system;
    const currentWealth = system.wealth?.value || 0;

    const content = await renderTemplate("systems/reign/templates/dialogs/roll-wealth.hbs", { currentWealth });

    const result = await DialogV2.wait({
      classes: ["reign-dialog-window"],
      window: { title: game.i18n.localize("REIGN.PurchaseHelper"), resizable: true },
      content: content,
      rejectClose: false,
      render: (event, html) => {
        let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
        if (!element) return;

        const closeBtn = element.querySelector('.header-control[data-action="close"]');
        if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });

        const f = element.querySelector("form");
        if (f) f.addEventListener("submit", e => e.preventDefault());
      },
      buttons: [{
        action: "check",
        label: "Check Affordability",
        default: true,
        callback: (e, b, d) => {
          const val = parseInt(d.element.querySelector('[name="cost"]').value) || 0;
          if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
          d.close({ animate: false });
          return val;
        }
      }]
    });

    if (result === undefined || result === null) return;
    await new Promise(resolve => setTimeout(resolve, 250)); // Breather
    const cost = result;

    if (cost < currentWealth) {
      await ChatMessage.create({ 
        speaker: ChatMessage.getSpeaker({actor: actor}), 
        content: `<div class="reign-chat-card"><h3 style="color: #2d5a27;">Trivial Purchase</h3><p>Item Cost (${cost}) is below Wealth (${currentWealth}). The purchase is trivial and succeeds automatically.</p></div>` 
      });
      await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "Purchase Trivial", resizable: true },
        content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Cost ${cost} is below your Wealth ${currentWealth}.<br><br><strong>The purchase is trivial and costs nothing!</strong></p></div>`,
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
        buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
          if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
          d.close({ animate: false }); 
        }}]
      });
    } else if (cost > currentWealth) {
      await ChatMessage.create({ 
        speaker: ChatMessage.getSpeaker({actor: actor}), 
        content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Purchase Impossible</h3><p>Item Cost (${cost}) exceeds Wealth (${currentWealth}). The character cannot afford this item.</p></div>` 
      });
      await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "Purchase Impossible", resizable: true },
        content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Cost ${cost} exceeds your Wealth ${currentWealth}.<br><br><strong>You cannot afford this item.</strong></p></div>`,
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
        buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
          if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
          d.close({ animate: false }); 
        }}]
      });
    } else {
      const confirmContent = `
          <div class="reign-dialog-form">
            <p>This item's Cost (${cost}) equals your current Wealth.</p>
            <p>You can outright buy it and <strong>lose 1 Wealth</strong>, or attempt to save your wealth by rolling <strong>Wealth</strong> or <strong>Command + Haggle</strong>.</p>
            <p><em>(On a success, you keep your Wealth. On a failure, it drops by 1.)</em></p>
          </div>
      `;
      const action = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "Significant Purchase", resizable: true },
        content: confirmContent,
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
        buttons: [
          { action: "buy", label: "Pay 1 Wealth", callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } d.close({ animate: false }); return "buy"; } },
          { action: "roll_wealth", label: "Roll Wealth", callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } d.close({ animate: false }); return "roll_wealth"; } },
          { action: "haggle", label: "Roll Haggle", callback: (e, b, d) => { if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; } d.close({ animate: false }); return "haggle"; } }
        ]
      });

      if (!action) return;
      await new Promise(resolve => setTimeout(resolve, 250)); // Breather

      if (action === "buy") {
        const newWealth = Math.max(0, currentWealth - 1);
        await actor.update({ "system.wealth.value": newWealth });
        
        await ChatMessage.create({ 
          speaker: ChatMessage.getSpeaker({actor: actor}), 
          content: `<div class="reign-chat-card"><h3 style="color: #d97706;">Significant Purchase</h3><p>Item Cost (${cost}) equals Wealth. Paid outright. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
        });

        await DialogV2.wait({
          classes: ["reign-dialog-window"],
          window: { title: "Purchase Complete", resizable: true },
          content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center;">Purchased!<br><br>Your Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
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
          buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
            if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
            d.close({ animate: false }); 
          }}]
        });
      } else if (action === "roll_wealth") {
        if (currentWealth < 2) {
          const newWealth = Math.max(0, currentWealth - 1);
          await actor.update({ "system.wealth.value": newWealth });
          await ChatMessage.create({ 
            speaker: ChatMessage.getSpeaker({actor: actor}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Wealth Roll Failed</h3><p>Wealth pool is too small to attempt a roll. Wealth drops to <strong>${newWealth}</strong>.</p></div>` 
          });
          await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Wealth Roll Failed", resizable: true },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Wealth pool is too small to attempt a roll (Requires at least 2 dice).<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
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
            buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
              if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
              d.close({ animate: false }); 
            }}]
          });
          return;
        }

        let diceToRoll = Math.min(currentWealth, 10);
        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const results = roll.dice[0]?.results.map(r => r.result) || [];
        
        const parsed = parseORE(results);
        if (parsed.sets.length > 0) {
            await postOREChat(actor, "Wealth Roll (Purchase)", currentWealth, results, 0, 0);
            await DialogV2.wait({
              classes: ["reign-dialog-window"],
              window: { title: "Purchase Succeeded", resizable: true },
              content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Roll succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p></div>`,
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
              buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
                if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                d.close({ animate: false }); 
              }}]
            });
        } else {
            const newWealth = Math.max(0, currentWealth - 1);
            await actor.update({ "system.wealth.value": newWealth });
            await postOREChat(actor, "Wealth Roll (Purchase)", currentWealth, results, 0, 0);
            await DialogV2.wait({
              classes: ["reign-dialog-window"],
              window: { title: "Purchase Failed", resizable: true },
              content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #d97706;">Roll failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
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
              buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
                if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                d.close({ animate: false }); 
              }}]
            });
        }
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
            speaker: ChatMessage.getSpeaker({actor: actor}), 
            content: `<div class="reign-chat-card"><h3 style="color: #8b1f1f;">Haggle Failed</h3><p>Command + Haggle pool is too small to attempt haggling.</p></div>` 
          });
          await DialogV2.wait({
            classes: ["reign-dialog-window"],
            window: { title: "Haggle Failed", resizable: true },
            content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #8b1f1f;">Your Command + Haggle pool is too small to attempt haggling (Requires at least 2 dice).</p></div>`,
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
            buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
              if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
              d.close({ animate: false }); 
            }}]
          });
          return;
        }

        let edFace = 10;
        if (hasEd) {
            const edChoice = await DialogV2.wait({
                classes: ["reign-dialog-window"],
                window: { title: "Set Expert Die (Haggle)", resizable: true },
                content: `<form class="reign-dialog-form"><div class="form-group"><label>Expert Die Face:</label><input type="number" name="edFace" value="10" min="1" max="10"/></div></form>`,
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
                  action: "set", label: "Roll Haggle", default: true,
                  callback: (event, button, dialog) => {
                    const val = parseInt(dialog.element.querySelector('[name="edFace"]').value) || 10;
                    if (dialog.element) { dialog.element.classList.remove("reign-dialog-window"); dialog.element.style.display = "none"; }
                    dialog.close({ animate: false });
                    return val;
                  }
                }]
            });
            
            if (!edChoice) return;
            await new Promise(resolve => setTimeout(resolve, 250)); // Breather
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
              await postOREChat(actor, "Haggle (Purchase)", pool, finalResults, edCount > 0 ? edVal : 0, mdCount);
              await DialogV2.wait({
                classes: ["reign-dialog-window"],
                window: { title: "Haggle Succeeded", resizable: true },
                content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #2d5a27;">Haggle succeeded!<br><br>You keep your Wealth at <strong>${currentWealth}</strong>.</p></div>`,
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
                buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
                  if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                  d.close({ animate: false }); 
                }}]
              });
            } else {
              const newWealth = Math.max(0, currentWealth - 1);
              await actor.update({ "system.wealth.value": newWealth });
              await postOREChat(actor, "Haggle (Purchase)", pool, finalResults, edCount > 0 ? edVal : 0, mdCount);
              await DialogV2.wait({
                classes: ["reign-dialog-window"],
                window: { title: "Haggle Failed", resizable: true },
                content: `<div class="reign-dialog-form"><p style="font-size: 1.1em; text-align: center; color: #d97706;">Haggle failed.<br><br>Wealth drops to <strong>${newWealth}</strong>.</p></div>`,
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
                buttons: [{ action: "ok", label: "OK", default: true, callback: (e, b, d) => { 
                  if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                  d.close({ animate: false }); 
                }}]
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
            window: { title: "Assign Master Die (Haggle)", resizable: true },
            content: mdHtml,
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
              action: "assign", label: "Finalize Haggle", default: true,
              callback: (event, button, dialog) => {
                const val = parseInt(dialog.element.querySelector('[name="mdFace"]').value) || 10;
                if (dialog.element) { dialog.element.classList.remove("reign-dialog-window"); dialog.element.style.display = "none"; }
                dialog.close({ animate: false });
                return val;
              }
            }]
          });

          if (!mdResult) return;
          await new Promise(resolve => setTimeout(resolve, 250)); // Breather
          
          results.push(mdResult);
          await finalizeHaggle(results, 1, hasEd ? 1 : 0, edFace);
        } else {
          await finalizeHaggle(results, 0, hasEd ? 1 : 0, edFace);
        }
      }
    }
  }
}