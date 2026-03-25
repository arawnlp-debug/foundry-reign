// scripts/generators/one-roll.js
const { DialogV2 } = foundry.applications.api;

export class OneRollGenerator {
  
  static async start(actor) {
    // 1. Fetch the JSON tables dynamically
    let tables;
    const path = `systems/${game.system.id}/data/one-roll-tables.json`;
    
    try {
      const response = await fetch(path);
      if (!response.ok) {
          return ui.notifications.error(`File not found at: ${path}. Did you put it in the right folder?`);
      }
      tables = await response.json();
    } catch (e) {
      console.error(e);
      return ui.notifications.error(`Found the file, but the JSON is broken! Check your commas and brackets in one-roll-tables.json.`);
    }

    // 2. Prompt for Waste Chart Selection
    const chartOptions = Object.keys(tables.wasteCharts).map(c => `<option value="${c}">${c}</option>`).join("");
    const selectedChart = await DialogV2.wait({
        classes: ["reign-dialog-window"],
        window: { title: "One-Roll Generator" },
        content: `<form class="reign-dialog-form"><div class="form-group"><label>Select Waste Dice Chart:</label><select name="chart">${chartOptions}</select></div></form>`,
        buttons: [{ action: "roll", label: "Roll 11d10", default: true, callback: (e, b, d) => d.element.querySelector('[name="chart"]').value }]
    });

    if (!selectedChart) return;

    // 3. Roll 11d10 (With RAW 6+ Reroll Logic)
    let results = [];
    let diceToRoll = 11;
    let maxIterations = 100; // FIXED: Added circuit breaker to prevent infinite loops

    // We loop the roll to catch any dice that need to be rerolled due to >5 matches
    while (diceToRoll > 0) {
        if (--maxIterations <= 0) {
            ui.notifications.error("One-Roll generator hit maximum reroll limit. Please try again.");
            return;
        }

        const roll = new Roll(`${diceToRoll}d10`);
        await roll.evaluate();
        let newRolls = roll.dice[0].results.map(r => r.result);
        
        // Count current totals to see if adding these new rolls pushes anything over 5
        let tempCounts = {};
        results.forEach(r => tempCounts[r] = (tempCounts[r] || 0) + 1);
        
        diceToRoll = 0; // Reset for the next loop
        
        for (let r of newRolls) {
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
      if (width > 1) {
        sets.push({ width: parseInt(width), height: parseInt(height) });
      } else {
        waste.push(parseInt(height));
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

    let generatedData = { attributes: {}, skills: {}, customSkills: [], advantages: [], expertDice: [], masterDice: [] };

    // Process Professions (Sets)
    if (sets.length > 0) {
        summaryHTML += `<h3 style="background: #e0e0e0; padding: 5px 10px; border-left: 4px solid #8b1f1f;">Professions (Sets)</h3>`;
        for (const set of sets) {
            const prof = tables.professions[set.height];
            if (prof) {
                summaryHTML += `<div style="margin-top: 10px;"><strong>${set.width}x${set.height} - ${prof.name}</strong></div><ul style="margin-top: 5px; margin-bottom: 15px;">`;
                for (let w = 2; w <= set.width; w++) {
                    const levelData = prof.levels[w];
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
            const eventData = tables.wasteCharts[selectedChart]?.[face];
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
        window: { title: "Character Blueprint" },
        content: summaryHTML,
        buttons: [
            { action: "apply", label: "Apply to Sheet (Overwrites Stats)", default: true },
            { action: "reroll", label: "Re-Roll 11d10" }
        ]
    });

    if (action === "apply") {
        await this._applyToActor(actor, generatedData);
    } else if (action === "reroll") {
        return this.start(actor);
    }
  }

  // Safely merge JSON bonuses
  static _mergeData(target, source) {
      if (source.attributes) {
          for (const [k, v] of Object.entries(source.attributes)) {
              target.attributes[k] = (target.attributes[k] || 0) + v;
          }
      }
      if (source.skills) {
          for (const [k, v] of Object.entries(source.skills)) {
              target.skills[k] = (target.skills[k] || 0) + v;
          }
      }
      if (source.customSkills) target.customSkills.push(...source.customSkills);
      if (source.advantages) target.advantages.push(...source.advantages);
      if (source.expertDice) target.expertDice.push(...source.expertDice);
      if (source.masterDice) target.masterDice.push(...source.masterDice);
  }

  // 7. Write Data to the Character Sheet
  static async _applyToActor(actor, data) {
      const updates = {};
      const system = actor.system;

      // Base Stats: RAW says One-Roll characters start with 2 in all attributes
      const attrs = ["body", "coordination", "sense", "knowledge", "command", "charm"];
      for (let a of attrs) {
          updates[`system.attributes.${a}.value`] = 2 + (data.attributes[a] || 0);
      }

      // Base Skills: Zero them out, then apply generated points
      for (let s of Object.keys(system.skills || {})) {
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
              else updates[`system.skills.${s}.expert`] = true;
          });
      }
      if (data.masterDice) {
          data.masterDice.forEach(s => {
              if (s === "esoterica_sorcery") updates[`system.esoterica.master`] = true;
              else updates[`system.skills.${s}.master`] = true;
          });
      }

      // RAW: Auto-grant a Master Die in Native Language
      updates[`system.skills.languageNative.master`] = true;

      // Custom Skills: Wipe existing ones, then create new randomized IDs for generated ones
      let customSkillUpdates = {};
      if (system.customSkills) {
          for (let key of Object.keys(system.customSkills)) {
              customSkillUpdates[`-=${key}`] = null; // Foundry's way of deleting object keys
          }
      }
      
      if (data.customSkills && data.customSkills.length > 0) {
          data.customSkills.forEach(cSk => {
              let id = foundry.utils.randomID();
              customSkillUpdates[id] = {
                  customLabel: cSk.name,
                  attribute: cSk.attribute,
                  value: cSk.value || 1,
                  expert: cSk.expert || false,
                  master: cSk.master || false,
                  isCombat: cSk.isCombat || false
              };
          });
      }
      updates["system.customSkills"] = customSkillUpdates;

      // Advantages: Append to the Biography text box
      if (data.advantages && data.advantages.length > 0) {
          let existingAdv = system.biography?.advantages || "";
          let newAdv = data.advantages.join("\n");
          updates["system.biography.advantages"] = existingAdv ? existingAdv + "\n\n--- Generated Advantages ---\n" + newAdv : newAdv;
      }

      // Push all updates to the database!
      await actor.update(updates);
      ui.notifications.success(`${actor.name} has been successfully generated!`);
  }
}