// scripts/sheets/company-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { ReignRoller } from "../helpers/reign-roller.js";

export class ReignCompanySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", 
    classes: ["reign", "sheet", "actor", "company"], 
    position: { width: 700, height: 800 }, 
    
    // RESPONSIVENESS FIX: Enable resizable window and minimizability
    window: {
      resizable: true,
      minimizable: true
    },
    
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      // PHASE 1: Error Boundaries applied to Company actions
      editImage: async function(event, target) {
        try {
          const fp = new FilePicker({
            type: "image",
            current: this.document.img,
            callback: path => this.document.update({ img: path })
          });
          return fp.browse();
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      rollCompanyStat: async function(event, target) {
        try {
          await ReignRoller.rollCompany(this.document, target.dataset);
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemCreate: async function(event, target) { 
        try {
          await this.document.createEmbeddedDocuments("Item", [{name: `New ${target.dataset.type}`, type: target.dataset.type}]); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemEdit: async function(event, target) { 
        try {
          this.document.items.get(target.dataset.itemId)?.sheet.render(true); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
      },
      itemDelete: async function(event, target) { 
        try {
          await this.document.items.get(target.dataset.itemId)?.delete(); 
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
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
            
          // TASK 4: Standardize TextEditor Enrichment
          const safeDesc = await TextEditor.enrichHTML(rawDesc, {
            async: true,
            secrets: this.document.isOwner,
            relativeTo: this.document
          });
          
          let content = `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><div>${safeDesc}</div></div>`;
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
        } catch(err) { ui.notifications.error(`Action failed: ${err.message}`); console.error(err); }
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

    const items = this.document.items;
    context.assets = items.filter(i => i.type === "advantage");
    context.problems = items.filter(i => i.type === "problem");

    return context;
  }
}