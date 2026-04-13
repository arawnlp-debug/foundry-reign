// scripts/sheets/company-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { CompanyRoller } from "../helpers/company-roller.js";
import { REIGN } from "../helpers/config.js";
import { reignConfirm, reignDialog } from "../helpers/dialog-util.js";
import { parseORE } from "../helpers/ore-engine.js";

export class ReignCompanySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", 
    classes: ["reign", "sheet", "actor", "company"], 
    position: { width: 850, height: 800 }, // <-- Increased width to give the 5 columns breathing room
    
    window: {
      resizable: true,
      minimizable: true
    },
    
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollCompanyStat: async function(event, target) {
        try {
          await CompanyRoller.rollCompany(this.document, target.dataset);
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      },
      rollQuality: async function(event, target) {
        try {
          await CompanyRoller.rollCompany(this.document, target.dataset.key);
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      },
      adjustQualityDamage: async function(event, target) {
        event.preventDefault();
        const key = target.dataset.key;
        const isIncrease = target.dataset.dir === "up";
        
        let currentDmg = this.document.system.qualities[key].damage || 0;
        let maxVal = this.document.system.qualities[key].value; 

        if (isIncrease && currentDmg < maxVal) {
          await this.document.update({ [`system.qualities.${key}.damage`]: currentDmg + 1 });
        } else if (!isIncrease && currentDmg > 0) {
          await this.document.update({ [`system.qualities.${key}.damage`]: currentDmg - 1 });
        }
      },
      
      /**
       * Company Quality Improvement
       * Self-contained roll that enforces:
       * 1. Permanent quality cannot exceed 5
       * 2. Difficulty = current permanent rating
       * 3. Only one improvement attempt per quality per in-game month
       * 4. Failing a permanent improvement does NOT grant a temporary increase
       */
      rollImprovement: async function(event, target) {
        try {
          const qualityKey = target.dataset.key;
          if (!qualityKey) return ui.notifications.warn("No quality specified for improvement.");

          const system = this.document.system;
          const currentPerm = system.qualities[qualityKey]?.value || 0;
          const qualityLabel = qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1);

          // RAW RESTRICTION 1: Hard cap at 5
          if (currentPerm >= 5) {
            return ui.notifications.error(`${qualityLabel} is already at 5. It cannot be improved further (RAW Ch10).`);
          }

          // RAW RESTRICTION 3: Monthly frequency limit (per quality)
          const lastRollKey = `lastImprove_${qualityKey}`;
          const lastRollTime = this.document.getFlag("reign", lastRollKey) || 0;
          const currentTime = game.time.worldTime;
          const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
          
          if (lastRollTime > 0 && (currentTime - lastRollTime) < thirtyDaysInSeconds) {
            const daysLeft = Math.ceil((thirtyDaysInSeconds - (currentTime - lastRollTime)) / (24 * 60 * 60));
            return ui.notifications.warn(`Cannot improve ${qualityLabel} again this month. Wait ${daysLeft} more in-game days.`);
          }

          // Build quality options for pool selection
          const qualityNames = { might: "Might", treasure: "Treasure", influence: "Influence", territory: "Territory", sovereignty: "Sovereignty" };
          const qualityOptionHtml = Object.entries(qualityNames)
            .map(([k, v]) => `<option value="${k}">${v} (${system.qualities[k]?.effective || 0})</option>`)
            .join("");

          // RAW RESTRICTION 2: Difficulty = current permanent rating
          const dialogContent = `
            <div class="reign-dialog-form">
              <p style="text-align: center; font-weight: bold; font-size: 1.1em;">Improve ${qualityLabel}</p>
              <p style="text-align: center; font-size: 0.9em; color: #555;">
                Difficulty: <strong>${currentPerm}</strong> (current permanent rating)<br>
                <em>Failing does NOT grant a temporary increase.</em>
              </p>
              <div class="form-group">
                <label>First Quality:</label>
                <select name="q1">${qualityOptionHtml}</select>
              </div>
              <div class="form-group">
                <label>Second Quality:</label>
                <select name="q2">${qualityOptionHtml}</select>
              </div>
              <div class="form-group">
                <label>Modifier:</label>
                <input type="number" name="mod" value="0"/>
              </div>
            </div>
          `;

          const rollData = await reignDialog(
            `Improve ${qualityLabel}`,
            dialogContent,
            (e, b, d) => {
              const f = d.element.querySelector("form") || d.element;
              return {
                q1: f.querySelector('[name="q1"]').value,
                q2: f.querySelector('[name="q2"]').value,
                mod: parseInt(f.querySelector('[name="mod"]').value) || 0
              };
            },
            { defaultLabel: "Roll Improvement" }
          );

          if (!rollData) return;

          // Calculate and roll the pool
          const val1 = system.qualities[rollData.q1]?.effective || 0; 
          const val2 = system.qualities[rollData.q2]?.effective || 0; 
          const totalPool = Math.min(val1 + val2 + rollData.mod, 10);

          if (totalPool < 1) return ui.notifications.warn("Pool too low. Improvement attempt fails automatically.");

          const roll = new Roll(`${totalPool}d10`);
          await roll.evaluate();
          const results = roll.dice[0]?.results.map(r => r.result) || [];
          const parsed = parseORE(results);

          // Check if any set meets the difficulty
          const successSet = parsed.sets.find(s => s.height >= currentPerm);
          const safeName = foundry.utils.escapeHTML(this.document.name);
          const poolLabel = `${qualityNames[rollData.q1]} + ${qualityNames[rollData.q2]}`;

          // Lock the monthly timer regardless of success or failure
          await this.document.setFlag("reign", lastRollKey, currentTime);

          if (successSet) {
            const newPerm = currentPerm + 1;
            await this.document.update({ [`system.qualities.${qualityKey}.value`]: newPerm }); 

            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.document }),
              content: `<div class="reign-chat-card">
                <h3 style="color: #2d5a27;"><i class="fas fa-arrow-up"></i> ${qualityLabel} Improved!</h3>
                <p><strong>${safeName}</strong> rolled <strong>${poolLabel}</strong> (${totalPool}d10): ${results.join(", ")}</p>
                <p>Set <strong>${successSet.text}</strong> meets Difficulty ${currentPerm}.</p>
                <hr>
                <p style="font-size: 1.1em; font-weight: bold;">${qualityLabel} permanently increases to ${newPerm}!</p>
              </div>`
            });
            ui.notifications.info(`${qualityLabel} permanently improved to ${newPerm}!`);
          } else {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this.document }),
              content: `<div class="reign-chat-card">
                <h3 style="color: #8b1f1f;"><i class="fas fa-times"></i> Improvement Failed</h3>
                <p><strong>${safeName}</strong> rolled <strong>${poolLabel}</strong> (${totalPool}d10): ${results.join(", ")}</p>
                <p>${parsed.sets.length === 0 
                    ? "No matched sets." 
                    : `Best set ${parsed.sets[0].text} did not meet Difficulty ${currentPerm}.`}</p>
                <hr>
                <p style="font-size: 0.9em; color: #555;"><em>${qualityLabel} remains unchanged. No temporary increase is granted.</em></p>
              </div>`
            });
            ui.notifications.warn(`Improvement failed. ${qualityLabel} remains at ${currentPerm}.`);
          }
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      },

      itemCreate: async function(event, target) {
        try {
          const type = target.dataset.type;
          const itemData = { name: `${game.i18n.localize("REIGN.New")} ${type.capitalize()}`, type: type };
          await this.document.createEmbeddedDocuments("Item", [itemData]);
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      },
      itemEdit: async function(event, target) {
        try {
          const itemId = target.closest("[data-item-id]").dataset.itemId;
          const item = this.document.items.get(itemId);
          if (item) item.sheet.render(true);
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      },
      itemDelete: async function(event, target) {
        try {
          const itemId = target.closest("[data-item-id]").dataset.itemId;
          const item = this.document.items.get(itemId);
          if (item) await item.delete();
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      },
      itemToChat: async function(event, target) {
        try {
          const item = this.document.items.get(target.dataset.itemId);
          if (!item) return;
          const safeName = foundry.utils.escapeHTML(item.name);
          let rawDesc = String(item.system.notes || item.system.effect || "");
          rawDesc = rawDesc
            .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
            .replace(/<img[\s\S]*?>/gi, "")
            .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
            .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
            .replace(/<embed[\s\S]*?>/gi, "");
            
          const safeDesc = await TextEditor.enrichHTML(rawDesc, {
            async: true,
            secrets: this.document.isOwner,
            relativeTo: this.document
          });
          
          let content = `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><div>${safeDesc}</div></div>`;
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
        } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/company-sheet.hbs" } };

  _prepareSubmitData(event, form, formData) {
    let data = super._prepareSubmitData(event, form, formData);
    let flatData = foundry.utils.flattenObject(data);
    let changed = false;

    for (const key in flatData) {
        if (key.endsWith(".value") || key.endsWith(".damage")) {
            if (flatData[key] === "" || flatData[key] === null) { flatData[key] = 0; changed = true; } 
            else if (typeof flatData[key] === "string" && !isNaN(parseInt(flatData[key]))) { flatData[key] = parseInt(flatData[key]) || 0; changed = true; }
        }
    }
    return changed ? foundry.utils.expandObject(flatData) : data;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    
    const qs = context.system.qualities || {};
    context.qualities = ["might", "treasure", "influence", "territory", "sovereignty"].map(k => {
        let labelKey = `REIGN.Quality${k.charAt(0).toUpperCase() + k.slice(1)}`;
        return { 
            key: k, 
            label: game.i18n.has(labelKey) ? game.i18n.localize(labelKey) : k.toUpperCase(), 
            value: qs[k]?.value || 0,
            damage: qs[k]?.damage || 0,
            effective: qs[k]?.effective || 0
        };
    });

    const items = this.document.items;
    context.assets = items.filter(i => i.type === "advantage");
    context.problems = items.filter(i => i.type === "problem");
    
    context.companyActions = Object.entries(REIGN.companyActions).map(([key, data]) => ({
        key: key,
        label: game.i18n.has(data.label) ? game.i18n.localize(data.label) : data.label.replace("REIGN.", ""),
        poolStr: [data.q1, data.q2]
            .filter(q => q && q !== "none" && q !== "custom")
            .map(q => q.charAt(0).toUpperCase() + q.slice(1))
            .join(" + ")
            || "Custom"
    }));

    return context;
  }
}