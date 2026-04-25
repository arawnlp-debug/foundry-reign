// scripts/sheets/threat-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { ThreatRoller } from "../helpers/threat-roller.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";
import { reignDialog } from "../helpers/dialog-util.js";

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
    actions: {
      rollThreat: this.prototype._onRollThreat,
      rollMorale: this.prototype._onRollMorale,
      receiveMoraleAttack: this.prototype._onReceiveMoraleAttack,
      eliminateMinions: this.prototype._onEliminateMinions
    }
  };

  static PARTS = {
    sheet: { template: "systems/reign/templates/actor/threat-sheet.hbs" }
  };

  // ==========================================
  // ACTION HANDLERS
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
      await ThreatRoller.rollMorale(this.document);
    } catch (err) {
      ui.notifications.error(`Action failed: ${err.message}`);
      console.error(err);
    }
  }

  /**
   * PACKAGE A: GM action to apply an incoming Morale Attack against this threat group.
   * Prompts for the Morale Attack value and source description, then resolves.
   */
  async _onReceiveMoraleAttack(event, target) {
    event.preventDefault();
    try {
      const actor = this.document;
      const threatRating = actor.system.threatLevel || 1;
      const currentGroup = actor.system.magnitude?.value || 0;

      if (currentGroup <= 0) {
        return ui.notifications.warn(`${actor.name} has no active fighters remaining.`);
      }

      const content = `
        <form class="reign-dialog-form">
          <p class="reign-text-center reign-text-large">Apply Morale Attack</p>
          <p class="reign-text-small reign-text-muted reign-text-center reign-mb-medium">
            RAW: Fighters flee equal to the MA value, unless Threat (${threatRating}) ≥ the MA value.<br>
            Group has <strong>${currentGroup}</strong> active fighters at Threat <strong>${threatRating}</strong>.
          </p>
          <div class="form-group">
            <label>Morale Attack Value (1-10):</label>
            <input type="number" name="maValue" value="5" min="1" max="10" />
          </div>
          <div class="form-group">
            <label>Source (optional):</label>
            <input type="text" name="maSource" value="Morale Attack" placeholder="e.g. Display Kill, Threaten, Spell" />
          </div>
        </form>
      `;

      const result = await reignDialog(
        "Receive Morale Attack",
        content,
        (e, b, d) => {
          const f = d.element.querySelector("form") || d.element;
          return {
            maValue: parseInt(f.querySelector('[name="maValue"]')?.value) || 0,
            maSource: f.querySelector('[name="maSource"]')?.value || "Morale Attack"
          };
        },
        { defaultLabel: "Apply Morale Attack" }
      );

      if (!result || result.maValue < 1) return;

      await ThreatRoller.receiveMoraleAttack(actor, result.maValue, result.maSource);
    } catch (err) {
      ui.notifications.error(`Morale Attack failed: ${err.message}`);
      console.error(err);
    }
  }

  /**
   * PACKAGE A: GM action to manually eliminate fighters from the group.
   * Useful for narrative events, environmental hazards, or effects outside normal combat.
   */
  async _onEliminateMinions(event, target) {
    event.preventDefault();
    try {
      const actor = this.document;
      const currentGroup = actor.system.magnitude?.value || 0;

      if (currentGroup <= 0) {
        return ui.notifications.warn(`${actor.name} has no active fighters remaining.`);
      }

      const content = `
        <form class="reign-dialog-form">
          <p class="reign-text-center reign-text-large">Remove Fighters</p>
          <p class="reign-text-small reign-text-muted reign-text-center reign-mb-medium">
            Directly remove fighters from the group.<br>
            Currently <strong>${currentGroup}</strong> / ${actor.system.magnitude?.max || currentGroup} active.
          </p>
          <div class="form-group">
            <label>Fighters to Remove:</label>
            <input type="number" name="removeCount" value="1" min="1" max="${currentGroup}" />
          </div>
          <div class="form-group">
            <label>Reason (optional):</label>
            <input type="text" name="reason" value="Manual Removal" placeholder="e.g. Desertion, Ambush, Trap" />
          </div>
        </form>
      `;

      const result = await reignDialog(
        "Eliminate Fighters",
        content,
        (e, b, d) => {
          const f = d.element.querySelector("form") || d.element;
          return {
            count: parseInt(f.querySelector('[name="removeCount"]')?.value) || 0,
            reason: f.querySelector('[name="reason"]')?.value || "Manual Removal"
          };
        },
        { defaultLabel: "Remove Fighters" }
      );

      if (!result || result.count < 1) return;

      await ThreatRoller.eliminateMinions(actor, result.count, result.reason);
    } catch (err) {
      ui.notifications.error(`Elimination failed: ${err.message}`);
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

    // PACKAGE A: Computed threat display data
    const mag = this.document.system.magnitude;
    const threatRating = this.document.system.threatLevel || 1;
    context.groupSize = mag?.value || 0;
    context.maxGroup = mag?.max || 0;
    context.threatRating = threatRating;
    context.isDestroyed = context.groupSize <= 0;

    // Pool preview: what the GM will roll (capped at 15)
    const maxDice = 15;
    context.effectivePool = Math.min(context.groupSize, maxDice);
    context.poolCapped = context.groupSize > maxDice;

    // Group health percentage for visual indicators
    context.groupPercent = context.maxGroup > 0 ? Math.round((context.groupSize / context.maxGroup) * 100) : 0;

    return context;
  }
}