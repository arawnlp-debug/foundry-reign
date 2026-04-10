// scripts/generators/one-roll.js
const { DialogV2 } = foundry.applications.api;

export class OneRollGenerator {
  
  static async start(actor) {
    let tables;
    
    const customPath = game.settings.get("reign", "oneRollTablePath");
    
    // TASK 1.4: Security Validation - Reject external URLs
    if (customPath && (customPath.startsWith("http://") || customPath.startsWith("https://"))) {
        return ui.notifications.error("Security Risk: One-Roll Table path cannot be an external URL. Please use a local relative path.");
    }

    const defaultPath = `systems/${game.system.id}/data/one-roll-tables.json`; 
    const path = customPath || defaultPath;
    
    try {
      const response = await fetch(path);
      if (!response.ok) {
          const errorMsg = customPath 
            ? `Custom One-Roll file not found at: ${path}. Check your world settings.`
            : `Default One-Roll file not found at: ${path}. System installation may be corrupt.`;
          return ui.notifications.error(errorMsg);
      }
      tables = await response.json();
    } catch (e) {
      console.error(e);
      return ui.notifications.error(`Failed to parse character tables at ${path}. Ensure the file is valid JSON.`);
    }

    const chartOptions = Object.keys(tables.wasteCharts || {}).map(c => `<option value="${c}">${c}</option>`).join("");
    const selectedChart = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "One-Roll Generator", resizable: true },
        position: { width: 400, height: "auto" },
        content: `<form class="reign-dialog-form"><div class="form-group"><label>Select Waste Dice Chart:</label><select name="chart">${chartOptions}</select></div></form>`,
        rejectClose: false,
        render: (event, html) => {
            const element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event?.[0] || null));
            if (!element) return;
            
            const closeBtn = element.querySelector('.header-control[data-action="close"]');
            if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });

            const f = element.querySelector("form");
            if (f) f.addEventListener("submit", e => e.preventDefault());
        },
        buttons: [{ 
            action: "roll", 
            label: "Roll 11d10", 
            default: true, 
            callback: (e, b, d) => {
                const val = d.element.querySelector('[name="chart"]').value;
                if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                d.close({ animate: false });
                return val;
            }
        }]
    });

    if (!selectedChart) return;

    let results = [];
    let diceToRoll = 11;
    let maxIterations = 100;

    while (diceToRoll > 0) {
        if (--maxIterations <= 0) {
            ui.notifications.error("One-Roll generator hit maximum reroll limit. Please try again.");
            return;
        }

        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const newRolls = roll.dice[0]?.results.map(r => r.result) || [];
        
        const tempCounts = {};
        results.forEach(r => tempCounts[r] = (tempCounts[r] || 0) + 1);
        
        diceToRoll = 0;
        
        for (const r of newRolls) {
            if ((tempCounts[r] || 0) < 5) {
                results.push(r);
                tempCounts[r] = (tempCounts[r] || 0) + 1;
            } else {
                diceToRoll++;
            }
        }
    }

    results.sort((a, b) => b - a);

    const counts = {};
    results.forEach(r => counts[r] = (counts[r] || 0) + 1);

    const sets = [];
    const waste = [];

    for (const [height, width] of Object.entries(counts)) {
      const parsedWidth = parseInt(width, 10);
      const parsedHeight = parseInt(height, 10);
      if (parsedWidth > 1) {
        sets.push({ width: parsedWidth, height: parsedHeight });
      } else {
        waste.push(parsedHeight);
      }
    }

    sets.sort((a, b) => b.width - a.width || b.height - a.height);
    waste.sort((a, b) => b - a);

    let summaryHTML = `<div class="reign-generator-results">
        <h2 style="text-align: center; border-bottom: 2px solid #8b1f1f; color: #8b1f1f; margin-top: 0;">11d10 Roll Results</h2>
        <div style="text-align: center; font-size: 1.4em; letter-spacing: 3px; margin-bottom: 15px; font-weight: bold; background: #f5f5f5; padding: 10px; border-radius: 5px;">
            ${results.join(", ")}
        </div>`;

    const generatedData = {
        attributes: {},
        skills: {},
        customSkills: [],
        advantages: [],
        expertDice: [],
        masterDice: []
    };

    if (sets.length > 0) {
        summaryHTML += `<h3 style="background: #e0e0e0; padding: 5px 10px; border-left: 4px solid #8b1f1f;">Professions (Sets)</h3>`;
        for (const set of sets) {
            const prof = tables.professions?.[set.height];
            if (prof) {
                summaryHTML += `<div style="margin-top: 10px;"><strong>${set.width}x${set.height} - ${prof.name}</strong></div><ul style="margin-top: 5px; margin-bottom: 15px;">`;
                for (let w = 2; w <= set.width; w++) {
                    const levelData = prof.levels?.[w];
                    if (levelData) {
                        summaryHTML += `<li><em>${levelData.description}</em></li>`;
                        this._mergeData(generatedData, levelData);
                    }
                }
                summaryHTML += `</ul>`;
            } else {
                summaryHTML += `<p><strong>${set.width}x${set.height}</strong>: <em>(No profession mapped)</em></p>`;
            }
        }
    } else {
        summaryHTML += `<h3 style="background: #e0e0e0; padding: 5px 10px; border-left: 4px solid #8b1f1f;">Professions (Sets)</h3><p>No sets rolled! A true peasant.</p>`;
    }

    if (waste.length > 0) {
        summaryHTML += `<h3 style="background: #e0e0e0; padding: 5px 10px; border-left: 4px solid #2d5a27;">Life Events (${selectedChart})</h3><ul style="margin-top: 5px;">`;
        for (const face of waste) {
            const eventData = tables.wasteCharts?.[selectedChart]?.[face];
            if (eventData) {
                summaryHTML += `<li><strong>Die ${face}:</strong> ${eventData.event}</li>`;
                this._mergeData(generatedData, eventData);
            } else {
                 summaryHTML += `<li><strong>Die ${face}:</strong> <em>(No event mapped)</em></li>`;
            }
        }
        summaryHTML += `</ul>`;
    }

    summaryHTML += `</div>`;

    const action = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        position: { width: 500, height: "auto" },
        window: { title: "Character Blueprint", resizable: true },
        content: summaryHTML,
        rejectClose: false,
        render: (event, html) => {
            const element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event?.[0] || null));
            if (!element) return;
            
            const closeBtn = element.querySelector('.header-control[data-action="close"]');
            if (closeBtn) closeBtn.addEventListener("pointerdown", () => { element.classList.remove("reign-dialog-window"); element.style.display = "none"; });
        },
        buttons: [
            { 
              action: "apply", 
              label: "Apply to Sheet (Overwrites Stats)", 
              default: true,
              callback: (e, b, d) => {
                  if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                  d.close({ animate: false });
                  return "apply";
              }
            },
            { 
              action: "reroll", 
              label: "Re-Roll 11d10",
              callback: (e, b, d) => {
                  if (d.element) { d.element.classList.remove("reign-dialog-window"); d.element.style.display = "none"; }
                  d.close({ animate: false });
                  return "reroll";
              }
            }
        ]
    });

    if (action === "apply") {
        await this._applyToActor(actor, generatedData);
    } else if (action === "reroll") {
        return this.start(actor);
    }
  }

  static _normalizeCustomSkillName(name) {
      return String(name || "").trim().toLowerCase();
  }

  static _mergeData(target, source) {
      if (source.attributes) {
          for (const [k, v] of Object.entries(source.attributes)) {
              target.attributes[k] = (target.attributes[k] || 0) + (parseInt(v, 10) || 0);
          }
      }

      if (source.skills) {
          for (const [k, v] of Object.entries(source.skills)) {
              target.skills[k] = (target.skills[k] || 0) + (parseInt(v, 10) || 0);
          }
      }

      if (source.customSkills && Array.isArray(source.customSkills)) {
          for (const incoming of source.customSkills) {
              if (!incoming || !incoming.name || !incoming.attribute) continue;

              const normalized = this._normalizeCustomSkillName(incoming.name);
              const existing = target.customSkills.find(c => this._normalizeCustomSkillName(c.name) === normalized);

              if (existing) {
                  existing.value = (existing.value || 0) + (parseInt(incoming.value, 10) || 0);
                  existing.expert = Boolean(existing.expert || incoming.expert);
                  existing.master = Boolean(existing.master || incoming.master);
                  existing.isCombat = Boolean(existing.isCombat || incoming.isCombat);
              } else {
                  target.customSkills.push({
                      name: String(incoming.name).trim(),
                      attribute: incoming.attribute,
                      value: parseInt(incoming.value, 10) || 1,
                      expert: Boolean(incoming.expert),
                      master: Boolean(incoming.master),
                      isCombat: Boolean(incoming.isCombat)
                  });
              }
          }
      }

      if (source.advantages && Array.isArray(source.advantages)) {
          for (const adv of source.advantages) {
              const safeAdv = String(adv || "").trim();
              if (safeAdv && !target.advantages.includes(safeAdv)) target.advantages.push(safeAdv);
          }
      }

      if (source.expertDice && Array.isArray(source.expertDice)) {
          for (const die of source.expertDice) {
              const safeDie = String(die || "").trim();
              if (safeDie && !target.expertDice.includes(safeDie)) target.expertDice.push(safeDie);
          }
      }

      if (source.masterDice && Array.isArray(source.masterDice)) {
          for (const die of source.masterDice) {
              const safeDie = String(die || "").trim();
              if (safeDie && !target.masterDice.includes(safeDie)) target.masterDice.push(safeDie);
          }
      }
  }

  static async _applyToActor(actor, data) {
      const updates = {};
      const system = actor.system;

      const attrs = ["body", "coordination", "sense", "knowledge", "command", "charm"];
      for (const a of attrs) {
          updates[`system.attributes.${a}.value`] = 2 + (data.attributes[a] || 0);
      }

      for (const s of Object.keys(system.skills || {})) {
          updates[`system.skills.${s}.value`] = data.skills[s] || 0;
          updates[`system.skills.${s}.expert`] = false;
          updates[`system.skills.${s}.master`] = false;
      }

      updates[`system.esoterica.sorcery`] = data.skills["esoterica_sorcery"] || 0;
      updates[`system.esoterica.expert`] = false;
      updates[`system.esoterica.master`] = false;

      if (data.expertDice) {
          data.expertDice.forEach(s => {
              if (s === "esoterica_sorcery") updates[`system.esoterica.expert`] = true;
              else if (system.skills?.[s]) updates[`system.skills.${s}.expert`] = true;
          });
      }

      if (data.masterDice) {
          data.masterDice.forEach(s => {
              if (s === "esoterica_sorcery") {
                  updates[`system.esoterica.master`] = true;
                  updates[`system.esoterica.expert`] = false;
              } else if (system.skills?.[s]) {
                  updates[`system.skills.${s}.master`] = true;
                  updates[`system.skills.${s}.expert`] = false;
              }
          });
      }

      updates[`system.skills.languageNative.master`] = true;
      updates[`system.skills.languageNative.expert`] = false;

      const customSkillUpdates = {};
      if (system.customSkills) {
          for (const key of Object.keys(system.customSkills)) {
              customSkillUpdates[`-=${key}`] = null; 
          }
      }
      
      if (data.customSkills && data.customSkills.length > 0) {
          data.customSkills.forEach(cSk => {
              const id = foundry.utils.randomID();
              customSkillUpdates[id] = {
                  customLabel: cSk.name,
                  attribute: cSk.attribute,
                  value: cSk.value || 1,
                  expert: cSk.master ? false : (cSk.expert || false),
                  master: cSk.master || false,
                  isCombat: cSk.isCombat || false
              };
          });
      }
      updates["system.customSkills"] = customSkillUpdates;

      updates["system.customMoves"] = {};

      await actor.update(updates);

      const existingGeneratedAdvantages = actor.items.filter(i =>
          i.type === "advantage" && i.getFlag("reign", "generatedByOneRoll")
      );

      if (existingGeneratedAdvantages.length > 0) {
          await actor.deleteEmbeddedDocuments("Item", existingGeneratedAdvantages.map(i => i.id));
      }

      if (data.advantages && data.advantages.length > 0) {
          const advantageDocs = data.advantages.map(name => ({
              name: String(name || "Generated Advantage").trim(),
              type: "advantage",
              system: {
                  cost: 0,
                  effect: "Generated by One-Roll character creation.",
                  hook: ""
              },
              flags: {
                  reign: {
                      generatedByOneRoll: true
                  }
              }
          }));

          await actor.createEmbeddedDocuments("Item", advantageDocs);
      }

      ui.notifications.success(`${actor.name} has been successfully generated!`);
  }
}