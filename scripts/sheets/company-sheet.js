// scripts/sheets/company-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { ReignRoller } from "../helpers/reign-roller.js";

export class ReignCompanySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["reign", "sheet", "actor", "company"], position: { width: 700, height: 800 }, form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      // NEW: Image editing action for ApplicationV2
      editImage: async function(event, target) {
        const fp = new FilePicker({
          type: "image",
          current: this.document.img,
          callback: path => this.document.update({ img: path })
        });
        return fp.browse();
      },
      rollCompanyStat: async function(event, target) {
        // Redirecting to the central engine (All Action Catalog and Cost logic is safely in there!)
        await ReignRoller.rollCompany(this.document, target.dataset);
      },
      itemCreate: async function(event, target) { await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); },
      itemEdit: async function(event, target) { this.document.items.get(target.dataset.itemId)?.sheet.render(true); },
      itemDelete: async function(event, target) { await this.document.items.get(target.dataset.itemId)?.delete(); },
      itemToChat: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const safeName = foundry.utils.escapeHTML(item.name);
        const safeDesc = foundry.utils.escapeHTML(item.system.notes || item.system.effect || "");
        let content = `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><p>${safeDesc}</p></div>`;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/company-sheet.hbs" } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;
    
    const qs = context.system.qualities || {};
    context.qualities = ["might", "treasure", "influence", "territory", "sovereignty"].map(k => ({ 
        key: k, 
        label: k.toUpperCase(), 
        ...qs[k] 
    }));

    // PRESERVED: Mapping Advantages to Assets so the Handlebars template doesn't break
    const items = this.document.items;
    context.assets = items.filter(i => i.type === "advantage");
    context.problems = items.filter(i => i.type === "problem");

    return context;
  }
}