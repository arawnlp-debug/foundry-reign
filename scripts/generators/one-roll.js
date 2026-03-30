// scripts/generators/one-roll.js
const { DialogV2 } = foundry.applications.api;

export class OneRollGenerator {
  
  static async start(actor) {
    // 1. Fetch the JSON tables dynamically
    let tables;
    
    // AUDIT FIX 1.5: Use world setting for custom path, fallback to corrected root path
    const customPath = game.settings.get("reign", "oneRollTablePath");
    const defaultPath = `systems/${game.system.id}/one-roll-tables.json`;
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

    // 2. Prompt for Waste Chart Selection
    const chartOptions = Object.keys(tables.wasteCharts || {}).map(c => `<option value="${c}">${c}</option>`).join("");
    const selectedChart = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "One-Roll Generator", resizable: true },
        content: `<form class="reign-dialog-form"><div class="form-group"><label>Select Waste Dice Chart:</label><select name="chart">${chartOptions}</select></div></form>`,
        render: (event, html) => {
            const element = event?.target?.element ?? (event instanceof HTMLElement ? event : (event?.[0] || null));
            if (!element) return;
            const f = element.querySelector("form");
            // FIX: Prevent Ghosting on 'Enter'
            if (f) f.addEventListener("submit", e => e.preventDefault());
        },
        buttons: [{ 
            action: "roll", 
            label: "Roll 11d10", 
            default: true, 
            callback: (e, b, d) => {
                const val = d.element.querySelector('[name="chart"]').value;
                // THE FIX: Safe kill ApplicationV2 Dialog without Ghosting
                d.close({ animate: false });
                return val;
            }
        }]
    });

    if (!selectedChart) return;

    // 3. Roll 11d10 (With RAW 6+ Reroll Logic)
    let results = [];
    let diceToRoll = 11;
    let maxIterations = 100; // Circuit breaker to prevent infinite loops

    // Loop the roll to catch any dice that need to be rerolled due to >5 matches
    while (diceToRoll > 0) {
        if (--maxIterations <= 0) {
            ui.notifications.error("One-Roll generator hit maximum reroll limit. Please try again.");
            return;
        }

        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        const newRolls = roll.dice[0]?.results.map(r => r.result) || [];
        
        // Count current totals to see if adding these new rolls pushes anything over 5
        const tempCounts = {};
        results.forEach(r => tempCounts[r] = (tempCounts[r] || 0) + 1);
        
        diceToRoll = 0; // Reset for the next loop
        
        for (const r of newRolls) {
            if ((tempCounts[r] || 0) < 5) {
                results.push(r);
                tempCounts[r] = (tempCounts[r] || 0) + 1;
            } else {
                // If this die pushes the set to 6+, it must be rerolled
                diceToRoll++;
            }
        }
    }

    results.sort((a, b) => b - a);

    // 4. Parse Sets and Waste Dice
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

    // 5. Evaluate Results against JSON
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

    // Process Professions (Sets)
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

    // Process Life Events (Waste Dice)
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

    // 6. Display the Window
    const action = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        position: { width: 500 },
        window: { title: "Character Blueprint", resizable: true },
        content: summaryHTML,
        buttons: [
            { 
              action: "apply", 
              label: "Apply to Sheet (Overwrites Stats)", 
              default: true,
              callback: (e, b, d) => {
                  d.close({ animate: false });
                  return "apply";
              }
            },
            { 
              action: "reroll", 
              label: "Re-Roll 11d10",
              callback: (e, b, d) => {
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

  // Safely merge JSON bonuses
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

  // 7. Write Data to the Character Sheet
  static async _applyToActor(actor, data) {
      const updates = {};
      const system = actor.system;

      // Base Stats: RAW says One-Roll characters start with 2 in all attributes
      const attrs = ["body", "coordination", "sense", "knowledge", "command", "charm"];
      for (const a of attrs) {
          updates[`system.attributes.${a}.value`] = 2 + (data.attributes[a] || 0);
      }

      // Base Skills: Zero them out, then apply generated points
      for (const s of Object.keys(system.skills || {})) {
          updates[`system.skills.${s}.value`] = data.skills[s] || 0;
          updates[`system.skills.${s}.expert`] = false;
          updates[`system.skills.${s}.master`] = false;
      }

      // Handle Sorcery explicitly so it maps to the correct Esoterica data path
      updates[`system.esoterica.sorcery`] = data.skills["esoterica_sorcery"] || 0;
      updates[`system.esoterica.expert`] = false;
      updates[`system.esoterica.master`] = false;

      // Apply ED/MD to base skills and Sorcery
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

      // RAW: Auto-grant a Master Die in Native Language
      updates[`system.skills.languageNative.master`] = true;
      updates[`system.skills.languageNative.expert`] = false;

      // Custom Skills: Wipe existing ones, then create new randomized IDs for generated ones
      const customSkillUpdates = {};
      if (system.customSkills) {
          for (const key of Object.keys(system.customSkills)) {
              customSkillUpdates[`-=${key}`] = null; // Foundry's way of deleting object keys
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

      // Clear custom moves so stale links from previous builds do not survive regeneration
      updates["system.customMoves"] = {};

      // Apply all sheet data first
      await actor.update(updates);

      // Remove existing generated advantage items before recreating them
      const existingGeneratedAdvantages = actor.items.filter(i =>
          i.type === "advantage" && i.getFlag("reign", "generatedByOneRoll")
      );

      if (existingGeneratedAdvantages.length > 0) {
          await actor.deleteEmbeddedDocuments("Item", existingGeneratedAdvantages.map(i => i.id));
      }

      // Create generated advantages as embedded Items so they appear in the sheet list
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