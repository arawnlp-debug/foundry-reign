// scripts/apps/faction-dashboard.js
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";

export class FactionDashboard extends ScrollPreserveMixin(HandlebarsApplicationMixin(ApplicationV2)) {

  static DEFAULT_OPTIONS = {
    id: "reign-faction-dashboard",
    classes: ["reign", "faction-dashboard", "app-v2"],
    tag: "div",
    window: {
      title: "Sovereign Faction Dashboard",
      icon: "fas fa-chess-rook",
      resizable: true,
      width: 900,
      height: 700,
    },
    
    // V14 ARCHITECTURE FIX: All actions strictly bound to the prototype
    actions: {
      openSheet: this.prototype._onOpenSheet,
      advanceMonth: this.prototype._onAdvanceMonth
    }
  };

  static PARTS = {
    main: { template: "systems/reign/templates/apps/faction-dashboard.hbs" }
  };

  /**
   * Sync all open FactionDashboard instances via ui.windows (no leak risk).
   */
  static syncAll() {
    Object.values(ui.windows)
      .filter(app => app instanceof FactionDashboard)
      .forEach(app => app.render(true));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const companies = game.actors.filter(a => a.type === "company");

    context.companies = companies.map(c => {
      const q = c.system.qualities || {};
      const formatQuality = (key) => {
        const val = parseInt(q[key]?.value) || 0;
        const dmg = parseInt(q[key]?.damage) || 0;
        const uses = parseInt(q[key]?.uses) || 0;
        // Subtract both damage AND uses to get current effective
        const current = Math.max(0, val - dmg - uses);
        return { value: val, damage: dmg, uses: uses, current: current, isDamaged: dmg > 0, isFatigued: uses > 0 };
      };

      return {
        id: c.id,
        name: c.name,
        might: formatQuality("might"),
        treasure: formatQuality("treasure"),
        influence: formatQuality("influence"),
        territory: formatQuality("territory"),
        sovereignty: formatQuality("sovereignty"),
        isCollapsed: formatQuality("sovereignty").current <= 0
      };
    });

    context.companies.sort((a, b) => a.name.localeCompare(b.name));
    context.isGM = game.user.isGM;
    return context;
  }

  // ==========================================
  // ACTION HANDLERS (V14 Standard)
  // ==========================================

  async _onOpenSheet(event, target) {
    event.preventDefault(); 
    const actorId = target.dataset.id;
    const actor = game.actors.get(actorId);
    if (actor) actor.sheet.render(true);
  }

  async _onAdvanceMonth(event, target) {
    event.preventDefault(); 
    if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("REIGN.Errors.GMOnly") || "Only the GM can advance the world clock.");

    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("REIGN.Apps.AdvanceMonthTitle") || "Advance Month?" },
      content: `
        <div style="font-family: 'Georgia', serif; color: #222;">
            <p>This will advance the world clock by one month.</p>
            <p>All Companies will <strong>heal 1 point of temporary damage</strong> and <strong>reset their Action Economy (Uses) to 0</strong>.</p>
            <p>Proceed?</p>
        </div>`,
      rejectClose: false
    });

    if (!confirm) return;

    const companies = game.actors.filter(a => a.type === "company");
    let healCount = 0;
    let refreshCount = 0;

    for (const c of companies) {
      const updates = {};
      const qualities = ["might", "treasure", "influence", "territory", "sovereignty"];
      let healed = false;
      let refreshed = false;

      for (const q of qualities) {
        const currentDmg = parseInt(c.system.qualities[q]?.damage) || 0;
        const currentUses = parseInt(c.system.qualities[q]?.uses) || 0;
        
        if (currentDmg > 0) {
          updates[`system.qualities.${q}.damage`] = currentDmg - 1;
          healed = true;
        }
        if (currentUses > 0) {
          updates[`system.qualities.${q}.uses`] = 0;
          refreshed = true;
        }
      }

      if (Object.keys(updates).length > 0) {
        await c.update(updates);
        if (healed) healCount++;
        if (refreshed) refreshCount++;
      }
    }

    ui.notifications.success(`World clock advanced! ${healCount} companies healed, ${refreshCount} companies refreshed their actions.`);
    
    await ChatMessage.create({
      speaker: { alias: "The World Clock" },
      content: `
        <div class="reign-chat-card" style="border: 2px solid #2e7d32; border-radius: 4px; padding: 10px; background: rgba(46, 125, 50, 0.05); text-align: center; font-family: 'Georgia', serif;">
            <h3 style="color: #2e7d32; margin-top: 0; font-family: 'Cinzel', serif; border-bottom: 1px solid #2e7d32; padding-bottom: 5px;">
                <i class="fas fa-hourglass-half"></i> A Month Passes...
            </h3>
            <p style="margin-bottom: 0; color: #333;">Factions consolidate their power, wounds heal, and armies prepare for new campaigns.</p>
        </div>`
    });
  }
}

// Ensure Dashboards stay synced when actors change
const syncFactionDashboards = (actor) => {
    if (actor && actor.type === "company") {
        FactionDashboard.syncAll();
    }
};

Hooks.on("updateActor", syncFactionDashboards);
Hooks.on("createActor", syncFactionDashboards);
Hooks.on("deleteActor", syncFactionDashboards);