// scripts/sheets/threat-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { ThreatRoller } from "../helpers/threat-roller.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";

export class ReignThreatSheet extends ScrollPreserveMixin(HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["reign", "sheet", "actor", "threat"],
    position: { width: 500, height: "auto" },

    window: {
      resizable: true,
      minimizable: true
    },

    form: { submitOnChange: true, closeOnSubmit: false },
    // V14 ARCHITECTURE FIX: All actions strictly bound to the prototype
    actions: {
      rollThreat: this.prototype._onRollThreat,
      rollMorale: this.prototype._onRollMorale
    }
  };

  static PARTS = {
    sheet: { template: "systems/reign/templates/actor/threat-sheet.hbs" }
  };

  // ==========================================
  // ACTION HANDLERS (V14 Standard)
  // ==========================================

  async _onRollThreat(event, target) {
    event.preventDefault(); 
    try {
      await ThreatRoller.rollThreat(this.document, target.dataset);
    } catch (err) {
      ui.notifications.error(`Action failed: ${err.message}`);
      console.error(err);
    }
  }

  async _onRollMorale(event, target) {
    event.preventDefault(); 
    try {
      // Delegate to the central roller to avoid duplicate code
      await ThreatRoller.rollMorale(this.document);
    } catch (err) {
      ui.notifications.error(`Action failed: ${err.message}`);
      console.error(err);
    }
  }

  // ==========================================
  // DATA PREPARATION
  // ==========================================

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.document;
    context.system = this.document.system;

    const companyList = {};
    game.actors
      .filter(a => a.type === "company")
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => {
        companyList[c.id] = c.name;
      });

    context.companies = companyList;

    return context;
  }
}