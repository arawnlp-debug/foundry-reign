// scripts/sheets/company-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { CompanyRoller } from "../helpers/company-roller.js";
import { REIGN } from "../helpers/config.js";
import { reignConfirm } from "../helpers/dialog-util.js";

export class ReignCompanySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", 
    classes: ["reign", "sheet", "actor", "company"], 
    position: { width: 700, height: 800 }, 
    
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
      
      // PHASE 3.2 FIX: Enforce 30-day (1 in-game month) limit on Improvement Rolls
      rollImprovement: async function(event, target) {
        try {
          const lastRollTime = this.document.getFlag("reign", "lastImprovementRollTime") || 0;
          const currentTime = game.time.worldTime;
          const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
          
          if (lastRollTime > 0 && (currentTime - lastRollTime) < thirtyDaysInSeconds) {
              const daysLeft = Math.ceil((thirtyDaysInSeconds - (currentTime - lastRollTime)) / (24 * 60 * 60));
              return ui.notifications.warn(`Company Improvement rolls can only be made once per month. You must wait ${daysLeft} more in-game days.`);
          }

          const confirmed = await reignConfirm(
              game.i18n.localize("REIGN.ImprovementRoll"), 
              `<p style="text-align: center;">Make an Improvement Roll? This will lock further improvement rolls for 1 in-game month.</p>`
          );
          
          if (confirmed) {
              await this.document.setFlag("reign", "lastImprovementRollTime", currentTime);
              await CompanyRoller.rollCompany(this.document, { type: "improvement", label: "Improvement Roll" });
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

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    
    // Localize the hardcoded Company Qualities and inject Temp vs Perm logic
    const qs = context.system.qualities || {};
    context.qualities = ["might", "treasure", "influence", "territory", "sovereignty"].map(k => {
        let labelKey = `REIGN.Quality${k.charAt(0).toUpperCase() + k.slice(1)}`;
        return { 
            key: k, 
            label: game.i18n.has(labelKey) ? game.i18n.localize(labelKey) : k.toUpperCase(), 
            ...qs[k] 
        };
    });

    const items = this.document.items;
    context.assets = items.filter(i => i.type === "advantage");
    context.problems = items.filter(i => i.type === "problem");
    
    // Inject extracted actions into context for the template to render
    context.companyActions = Object.entries(REIGN.companyActions).map(([key, data]) => ({
        key: key,
        label: game.i18n.has(data.label) ? game.i18n.localize(data.label) : data.label.replace("REIGN.", ""),
        poolStr: data.pool.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" + ")
    }));

    return context;
  }
}