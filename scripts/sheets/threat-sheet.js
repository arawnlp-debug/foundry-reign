// scripts/sheets/threat-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { parseORE } from "../helpers/ore-engine.js";
import { ThreatRoller } from "../helpers/threat-roller.js";

export class ReignThreatSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
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
      rollThreat: async function(event, target) {
        try {
          await ThreatRoller.rollThreat(this.document, target.dataset);
        } catch (err) {
          ui.notifications.error(`Action failed: ${err.message}`);
          console.error(err);
        }
      },

      rollMorale: async function(event, target) {
        try {
          const system = this.document.system;
          const pool = system.morale?.value ?? system.threatLevel ?? 0;

          if (pool < 1) {
            return ui.notifications.warn(game.i18n.localize("REIGN.ThreatMoraleZero"));
          }

          const roll = new Roll(`${pool}d10`);
          await roll.evaluate();
          const results = roll.dice[0]?.results.map(r => r.result) || [];
          const parsed = parseORE(results);

          let content = `<div class="reign-chat-card"><header><h3>${game.i18n.localize("REIGN.Morale")}</h3></header>`;
          content += `<div class="pool-details">${game.i18n.localize("REIGN.Pool")}: ${pool}d10</div><hr>`;

          if (parsed.sets.length > 0) {
            content += `<div class="sets-result"><span style="color: #2d5a27; font-weight: bold;">${game.i18n.localize("REIGN.Success")}</span> ${game.i18n.localize("REIGN.ThreatMoraleHold")}</div>`;
          } else {
            content += `<div class="sets-result"><span style="color: #8b1f1f; font-weight: bold;">${game.i18n.localize("REIGN.Failure")}</span> ${game.i18n.localize("REIGN.ThreatMoraleBreaks")}</div>`;

            const currentMorale = system.morale?.value || 0;
            const newMorale = Math.max(0, currentMorale - 1);
            await this.document.update({ "system.morale.value": newMorale });

            content += `<div class="waste-result">${game.i18n.localize("REIGN.Morale")} ${game.i18n.localize("REIGN.Total")}: ${newMorale}.</div>`;

            if (newMorale === 0) {
              content += `<div class="waste-result" style="color: #8b1f1f; font-weight: bold; font-size: 1.2em; text-align: center; margin-top: 10px;">${game.i18n.localize("REIGN.ThreatRoutes")}</div>`;
            }
          }

          content += `</div>`;

          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            content
          });
        } catch (err) {
          ui.notifications.error(`Action failed: ${err.message}`);
          console.error(err);
        }
      }
    }
  };

  static PARTS = {
    sheet: { template: "systems/reign/templates/actor/threat-sheet.hbs" }
  };

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