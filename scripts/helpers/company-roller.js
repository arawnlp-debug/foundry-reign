// scripts/helpers/company-roller.js
const { renderTemplate } = foundry.applications.handlebars;
import { postOREChat } from "./chat.js";
import { parseORE } from "./ore-engine.js";
import { REIGN } from "./config.js";
import { reignDialog } from "./dialog-util.js";

export class CompanyRoller {
  static async rollCompany(actor, dataset) {
    try {
        console.log("Reign Company Roller | Execution Started.", dataset);

        const key1 = dataset.key || "might";
        const system = actor.system;
        
        const pledges = system.pledges || { bonus: 0, ed: 0, md: 0 };
        const hasPledges = pledges.bonus > 0 || pledges.ed > 0 || pledges.md > 0;
        
        const companyActions = {
          none: { label: "-- Custom Action --", q1: "none", q2: "none", target: "none", diff: 0 },
          ...REIGN.companyActions
        };

        const presetOptions = {};
        for (const [k, v] of Object.entries(companyActions)) {
          presetOptions[k] = k === "none" ? v.label : (game.i18n.localize(v.label) || v.label);
        }
        
        const qualityOptions = { "might": "Might", "treasure": "Treasure", "influence": "Influence", "territory": "Territory", "sovereignty": "Sovereignty" };
        const qualityOptionsWithNone = { "none": "None", ...qualityOptions };

        const targetCompanies = game.actors
            .filter(a => a.type === "company" && a.id !== actor.id)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const templateData = { presetOptions, qualityOptions, qualityOptionsWithNone, key1, pledges, hasPledges, targetCompanies };
        
        // V14 FIX: Using the exact namespaced renderTemplate to avoid global deprecation warnings
        const content = await renderTemplate("systems/reign/templates/dialogs/roll-company.hbs", templateData);
        
        const rollData = await reignDialog(
          "Company Action",
          content,
          (e, b, d) => {
            const f = d.element.querySelector("form");
            const presetKey = f.querySelector('[name="preset"]').value;
            const q1LimitStr = f.querySelector('[name="q1Limit"]').value;
            const q2LimitStr = f.querySelector('[name="q2Limit"]').value;

            return {
                q1: f.querySelector('[name="q1"]').value,
                q2: f.querySelector('[name="q2"]').value,
                q1Limit: q1LimitStr !== "" && !isNaN(parseInt(q1LimitStr)) ? parseInt(q1LimitStr) : null,
                q2Limit: q2LimitStr !== "" && !isNaN(parseInt(q2LimitStr)) ? parseInt(q2LimitStr) : null,
                difficulty: parseInt(f.querySelector('[name="difficulty"]').value) || 0,
                mod: parseInt(f.querySelector('[name="mod"]').value) || 0,
                targetCompany: f.querySelector('[name="targetCompany"]').value,
                targetQuality: f.querySelector('[name="targetQuality"]')?.value || "none",
                erodeQ1: f.querySelector('[name="erodeQ1"]')?.checked ?? true,
                erodeQ2: f.querySelector('[name="erodeQ2"]')?.checked ?? true,
                presetLabel: presetKey !== "none" ? (game.i18n.localize(companyActions[presetKey].label) || companyActions[presetKey].label) : null
            };
          },
          {
            defaultLabel: "Roll Faction ORE",
            render: (event, html) => {
                // V14 Element Selection Pattern matching character-roller.js
                let element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event[0] || null));
                if (!element) return;

                const f = element.querySelector("form");
                const poolPreviewSpan = element.querySelector("#pool-value");
                if (!f || !poolPreviewSpan) return;

                const updatePool = () => {
                  const q1 = f.querySelector('[name="q1"]').value;
                  const q2 = f.querySelector('[name="q2"]').value;
                  const mod = parseInt(f.querySelector('[name="mod"]').value) || 0;
                  const q1LimitStr = f.querySelector('[name="q1Limit"]').value;
                  const q2LimitStr = f.querySelector('[name="q2Limit"]').value;
                  
                  // Apply Allocation Limits
                  let val1 = system.qualities[q1]?.effective || 0;
                  if (q1LimitStr !== "" && !isNaN(parseInt(q1LimitStr))) {
                      val1 = Math.min(val1, parseInt(q1LimitStr));
                  }

                  let val2 = q2 !== "none" ? (system.qualities[q2]?.effective || 0) : 0;
                  if (q2 !== "none" && q2LimitStr !== "" && !isNaN(parseInt(q2LimitStr))) {
                      val2 = Math.min(val2, parseInt(q2LimitStr));
                  }
                  
                  let intendedPool = val1 + val2 + mod + (pledges.bonus || 0);
                  let totalSpecial = (pledges.ed || 0) + (pledges.md || 0);
                  let diceToRoll = Math.min(intendedPool, 10 - totalSpecial);
                  
                  let displayStr = `${diceToRoll}d10`;
                  if (pledges.ed > 0) displayStr += ` + ${pledges.ed} ED`;
                  if (pledges.md > 0) displayStr += ` + ${pledges.md} MD`;

                  if (diceToRoll < 1 && totalSpecial === 0) {
                      poolPreviewSpan.innerHTML = `<span style="color:#ff5252;">Action Fails (Pool < 1)</span>`;
                  } else {
                      if (intendedPool + totalSpecial > 10) displayStr += ` <span style="font-size:0.8em; color:#aaa; font-weight: normal;">(Capped at 10)</span>`;
                      poolPreviewSpan.innerHTML = displayStr;
                  }

                  // Update Checkbox Labels dynamically
                  const labelQ1 = element.querySelector("#label-erode-q1");
                  const labelQ2 = element.querySelector("#label-erode-q2");
                  const erodeQ1Chk = element.querySelector('[name="erodeQ1"]');
                  const erodeQ2Chk = element.querySelector('[name="erodeQ2"]');

                  if (labelQ1 && erodeQ1Chk) {
                      if (q1 === "none") {
                          erodeQ1Chk.disabled = true;
                          erodeQ1Chk.checked = false;
                          labelQ1.innerText = "Erode: None";
                      } else {
                          erodeQ1Chk.disabled = false;
                          labelQ1.innerText = `Erode: ${qualityOptions[q1] || q1}`;
                      }
                  }

                  if (labelQ2 && erodeQ2Chk) {
                      if (q2 === "none") {
                          erodeQ2Chk.disabled = true;
                          erodeQ2Chk.checked = false;
                          labelQ2.innerText = "Erode: None";
                      } else {
                          erodeQ2Chk.disabled = false;
                          labelQ2.innerText = `Erode: ${qualityOptions[q2] || q2}`;
                      }
                  }
                };

                const presetSelect = element.querySelector("#reign-action-preset");
                presetSelect.addEventListener("change", (ev) => {
                  const val = ev.target.value;
                  if (val !== "none" && companyActions[val]) {
                    const action = companyActions[val];
                    element.querySelector("#reign-q1").value = action.q1;
                    element.querySelector("#reign-q2").value = action.q2;
                    element.querySelector("#reign-diff").value = action.diff || 0;
                    
                    const targetEl = element.querySelector("#reign-target");
                    if(targetEl && action.target) targetEl.value = action.target;
                    
                    // Ensure checkboxes reset to true for a standard action
                    const erodeQ1Chk = element.querySelector('[name="erodeQ1"]');
                    const erodeQ2Chk = element.querySelector('[name="erodeQ2"]');
                    if (erodeQ1Chk) erodeQ1Chk.checked = true;
                    if (erodeQ2Chk) erodeQ2Chk.checked = true;

                    updatePool();
                  }
                });

                f.querySelectorAll("input, select").forEach(input => {
                    input.addEventListener("input", updatePool);
                    input.addEventListener("change", updatePool);
                });

                updatePool();
            }
          }
        );
        
        if (!rollData) return;
        
        // --- EVALUATE THE ROLL ---
        let val1 = system.qualities[rollData.q1]?.effective || 0;
        if (rollData.q1Limit !== null) val1 = Math.min(val1, rollData.q1Limit);

        let val2 = rollData.q2 !== "none" ? (system.qualities[rollData.q2]?.effective || 0) : 0;
        if (rollData.q2 !== "none" && rollData.q2Limit !== null) val2 = Math.min(val2, rollData.q2Limit);
        
        let intendedPool = val1 + val2 + rollData.mod + (pledges.bonus || 0);
        let totalSpecial = (pledges.ed || 0) + (pledges.md || 0);
        
        let diceToRoll = Math.min(intendedPool, 10 - totalSpecial);
        let wasCapped = (intendedPool + totalSpecial) > 10;
        
        if (diceToRoll < 1 && totalSpecial === 0) return ui.notifications.warn("Company dice pool reduced below 1. Action fails.");

        const roll = new Roll(`${diceToRoll}d10`); 
        await roll.evaluate();
        let results = roll.dice[0]?.results.map(r => r.result) || [];

        const parsed = parseORE(results, pledges.ed, pledges.md);
        const difficulty = rollData.difficulty || 0;
        const successSet = parsed.sets.find(s => s.height >= difficulty);

        // --- COMPOSE MAIN LABEL ---
        let actionLabel = rollData.presetLabel ? rollData.presetLabel : "Company Action";

        // --- OUTPUT MAIN ORE CHAT CARD ---
        await postOREChat(actor, actionLabel, diceToRoll, results, pledges.ed, pledges.md, null, { 
            targetQuality: rollData.targetQuality, 
            wasCapped: wasCapped, 
            difficulty: rollData.difficulty 
        });

        // ==========================================
        // SECONDARY RESOLUTION CARD (HTML SAFE)
        // ==========================================
        let resolutionHtml = "";

        // 1. Target Damage Resolution (Delegated to combat/company-damage.js for unified RAW math)
        if (rollData.targetCompany !== "none" && rollData.targetQuality !== "none") {
            if (successSet) {
                // Execute the verified Steal and Collapse logic
                const { applyCompanyDamageToTarget } = await import("../combat/company-damage.js");
                await applyCompanyDamageToTarget(successSet.width, rollData.targetQuality, actor);
            } else {
                resolutionHtml += `<div style="margin-bottom: 5px; color:#8b1f1f; font-size: 0.95em;"><i class="fas fa-shield-alt"></i> Attack failed to meet difficulty.</div>`;
            }
        }

        // 2. Quality Degradation (Action Economy)
        let qUpdates = {};
        let degradedQualities = [];
        
        if (rollData.q1 !== "none" && rollData.erodeQ1) {
            let currentUses = actor.system.qualities[rollData.q1]?.uses || 0;
            qUpdates[`system.qualities.${rollData.q1}.uses`] = currentUses + 1;
            degradedQualities.push(rollData.q1.toUpperCase());
        }
        // Only erode q2 if it's not "none", not the same as q1, and the box was checked.
        if (rollData.q2 !== "none" && rollData.q2 !== rollData.q1 && rollData.erodeQ2) {
            let currentUses = actor.system.qualities[rollData.q2]?.uses || 0;
            qUpdates[`system.qualities.${rollData.q2}.uses`] = currentUses + 1;
            degradedQualities.push(rollData.q2.toUpperCase());
        }
        
        if (Object.keys(qUpdates).length > 0) {
            await actor.update(qUpdates);
            
            let borderStyle = resolutionHtml !== "" ? "border-top: 1px dashed #d97706; padding-top: 5px; margin-top: 5px;" : "";
            
            resolutionHtml += `
                <div style="${borderStyle}">
                    <span style="color:#d97706; font-size: 1em; font-weight: bold; font-family: 'Cinzel', serif;">
                        <i class="fas fa-hourglass-half"></i> Action Economy Fatigue
                    </span><br>
                    <span style="color: #444; font-size: 0.9em;">
                        <strong>${degradedQualities.join(" & ")}</strong> degraded by 1 for the rest of the month.
                    </span>
                </div>
            `;
        }

        // Print the Secondary Resolution Card if there are effects to display
        if (resolutionHtml !== "") {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: actor }),
                content: `
                    <div class="reign-chat-card" style="background: rgba(0, 0, 0, 0.03); border: 1px solid #999; padding: 8px; border-radius: 4px; margin-top: 2px;">
                        ${resolutionHtml}
                    </div>
                `
            });
        }

        // --- RESET WAR CHEST ---
        if (hasPledges) {
            await actor.update({
                "system.pledges.bonus": 0,
                "system.pledges.ed": 0,
                "system.pledges.md": 0
            });
            ui.notifications.info("War Chest pledges have been consumed for this roll.");
        }

    } catch (err) {
        console.error("Reign Company Roller | CRITICAL EXCEPTION:", err);
        ui.notifications.error("Company roller crashed. Check F12 Console for details.");
    }
  }
}