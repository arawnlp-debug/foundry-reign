// scripts/apps/faction-dashboard.js
// ════════════════════════════════════════════════════════════════════════════
//  SOVEREIGN FACTION DASHBOARD — Geopolitical Command Centre
//  Reign: Realities of Lords and Leaders (Foundry VTT V14)
// ════════════════════════════════════════════════════════════════════════════

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";
import { postOREChat } from "../helpers/chat.js";
import { reignDialog } from "../helpers/dialog-util.js";
import { REIGN } from "../helpers/config.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const QUALITY_KEYS  = ["might", "treasure", "influence", "territory", "sovereignty"];
const QUALITY_ICONS = {
  might: "fas fa-fist-raised", treasure: "fas fa-coins", influence: "fas fa-eye",
  territory: "fas fa-chess-rook", sovereignty: "fas fa-crown"
};
const QUALITY_LABELS = {
  might: "Might", treasure: "Treasure", influence: "Influence",
  territory: "Territory", sovereignty: "Sovereignty"
};

/** RAW Chapter 5: Maps offensive actions to their defensive counter-actions. */
const ACTION_OPPOSITIONS = {
  attack:            { counter: "defend",            label: "Defend" },
  espionage:         { counter: "counter_espionage", label: "Counter-Espionage" },
  unconventional:    { counter: "policing",          label: "Policing" }
};

/** Chronicle entry type definitions with icons and semantic colors. */
const CHRONICLE_TYPES = {
  advance:   { icon: "fas fa-hourglass-half", label: "Month Advance",   css: "fd-chron-advance" },
  event:     { icon: "fas fa-scroll",         label: "Event",           css: "fd-chron-event" },
  damage:    { icon: "fas fa-skull-crossbones",label: "Damage / Attack", css: "fd-chron-damage" },
  conquest:  { icon: "fas fa-flag",           label: "Conquest",        css: "fd-chron-conquest" },
  alliance:  { icon: "fas fa-handshake",      label: "Alliance",        css: "fd-chron-alliance" },
  diplomacy: { icon: "fas fa-balance-scale",  label: "Diplomacy",       css: "fd-chron-diplomacy" },
  loss:      { icon: "fas fa-heart-broken",   label: "Loss / Setback",  css: "fd-chron-loss" }
};

// ─── Utility: Read a quality into a standardized object ──────────────────────

function formatQuality(q, key) {
  const val     = parseInt(q?.value)  || 0;
  const dmg     = parseInt(q?.damage) || 0;
  const uses    = parseInt(q?.uses)   || 0;
  const current = Math.max(0, val - dmg - uses);
  return {
    key, value: val, damage: dmg, uses, current,
    isDamaged: dmg > 0, isFatigued: uses > 0,
    icon: QUALITY_ICONS[key], label: QUALITY_LABELS[key]
  };
}

// ═════════════════════════════════════════════════════════════════════════════

export class FactionDashboard extends ScrollPreserveMixin(HandlebarsApplicationMixin(ApplicationV2)) {

  // ─── Persistent UI State (survives re-renders) ───────────────────────────

  expandedCompanies = new Set();
  sortKey   = "name";
  sortDir   = "asc";
  filterText = "";

  static DEFAULT_OPTIONS = {
    id: "reign-faction-dashboard",
    classes: ["reign", "faction-dashboard", "app-v2"],
    tag: "div",
    window: {
      title: "Sovereign Faction Dashboard",
      icon: "fas fa-chess-rook",
      resizable: true,
      width: 940,
      height: 720,
    },
    actions: {
      openSheet:          FactionDashboard.prototype._onOpenSheet,
      advanceMonth:       FactionDashboard.prototype._onAdvanceMonth,
      rollQuality:        FactionDashboard.prototype._onRollQuality,
      companyAction:      FactionDashboard.prototype._onCompanyAction,
      applyDamage:        FactionDashboard.prototype._onApplyDamage,
      viewChronicle:      FactionDashboard.prototype._onViewChronicle,
      addChronicleEntry:  FactionDashboard.prototype._onAddChronicleEntry,
      exportChronicle:    FactionDashboard.prototype._onExportChronicle,
      toggleDrawer:       FactionDashboard.prototype._onToggleDrawer,
      sortColumn:         FactionDashboard.prototype._onSortColumn,
    }
  };

  static PARTS = {
    main: { template: "systems/reign/templates/apps/faction-dashboard.hbs" }
  };

  /** Refresh every open dashboard instance when company actors change. */
  static syncAll() {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof FactionDashboard) app.render(true);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════════════════════

  async _prepareContext(options) {
    const context   = await super._prepareContext(options);
    const companies = game.actors.filter(a => a.type === "company");

    // Derive the current world month from the highest chronicle entry
    let worldMonth = 0;
    for (const c of companies) {
      for (const entry of (c.system.chronicle || [])) {
        if (entry.month > worldMonth) worldMonth = entry.month;
      }
    }
    context.worldMonth = worldMonth || 1;

    context.companies = companies.map(c => {
      const q = c.system.qualities || {};
      const qualities = {};
      let totalSize = 0;
      let totalUses = 0;

      for (const key of QUALITY_KEYS) {
        qualities[key] = formatQuality(q[key], key);
        totalSize += qualities[key].value;
        totalUses += qualities[key].uses;
      }

      // Items for the asset drawer
      const items    = c.items?.contents || [];
      const assets   = items.filter(i => i.type === "asset").sort((a,b) => a.name.localeCompare(b.name));
      const problems = items.filter(i => i.type === "problem").sort((a,b) => a.name.localeCompare(b.name));

      // Chronicle
      const chronicle = c.system.chronicle || [];

      // Ownership: players who own this company can roll for it
      const canAct = game.user.isGM || c.isOwner;

      // Pre-built array for DRY template iteration (might through territory)
      const qualityCells = ["might", "treasure", "influence", "territory"].map(k => qualities[k]);

      return {
        id: c.id, name: c.name, img: c.img,
        ...qualities,
        qualityCells,
        totalSize, totalUses,
        isCollapsed:  qualities.sovereignty.current <= 0,
        isWarning:    qualities.sovereignty.current === 1,
        assets, problems,
        hasItems:     assets.length > 0 || problems.length > 0,
        isExpanded:   this.expandedCompanies.has(c.id),
        chronicleCount: chronicle.length,
        canAct
      };
    });

    // ── Filtering ──
    if (this.filterText) {
      const needle = this.filterText.toLowerCase();
      context.companies = context.companies.filter(c => c.name.toLowerCase().includes(needle));
    }

    // ── Sorting ──
    const dir = this.sortDir === "asc" ? 1 : -1;
    const key = this.sortKey;
    context.companies.sort((a, b) => {
      if (key === "name") return dir * a.name.localeCompare(b.name);
      // For quality keys, sort by current effective value
      const valA = QUALITY_KEYS.includes(key) ? a[key].current : (a[key] ?? 0);
      const valB = QUALITY_KEYS.includes(key) ? b[key].current : (b[key] ?? 0);
      return dir * (valA - valB);
    });

    context.isGM       = game.user.isGM;
    context.sortKey     = this.sortKey;
    context.sortDir     = this.sortDir;
    context.filterText  = this.filterText;
    context.totalCount  = companies.length;
    return context;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  POST-RENDER: Wire up non-action events (filter input)
  // ═══════════════════════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender(context, options);
    const filterInput = this.element?.querySelector(".fd-filter-input");
    if (filterInput) {
      filterInput.value = this.filterText;
      filterInput.addEventListener("input", (ev) => {
        this.filterText = ev.target.value;
        this.render(false);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SORTING
  // ═══════════════════════════════════════════════════════════════════════════

  _onSortColumn(event, target) {
    event.preventDefault();
    const key = target.dataset.sortKey;
    if (!key) return;
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortKey = key;
      this.sortDir = key === "name" ? "asc" : "desc"; // default: names ascending, numbers descending
    }
    this.render(false);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INLINE QUALITY ROLLS (available to owners + GM)
  // ═══════════════════════════════════════════════════════════════════════════

  async _onRollQuality(event, target) {
    event.preventDefault();
    const actorId    = target.closest("[data-company-id]")?.dataset.companyId;
    const qualityKey = target.dataset.quality;
    const actor      = game.actors.get(actorId);
    if (!actor || !qualityKey) return;

    // Permission check: owner or GM
    if (!game.user.isGM && !actor.isOwner) {
      return ui.notifications.warn("You do not have permission to roll for this company.");
    }

    const q    = actor.system.qualities?.[qualityKey];
    const pool = Math.max(0, (q?.value || 0) - (q?.damage || 0) - (q?.uses || 0));
    const qLabel = QUALITY_LABELS[qualityKey];

    if (pool < 1) return ui.notifications.warn(`${actor.name}'s ${qLabel} has no effective dice.`);

    const roll    = new Roll(`${pool}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];

    const breakdown = [{ label: qLabel, value: `${q.value}`, isPenalty: false }];
    if (q.damage > 0) breakdown.push({ label: "Damage",       value: `−${q.damage}`, isPenalty: true });
    if (q.uses   > 0) breakdown.push({ label: "Actions Used", value: `−${q.uses}`,   isPenalty: true });

    await postOREChat(actor, `${qLabel} (${actor.name})`, pool, results, 0, 0, null, {
      poolBreakdown: breakdown
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  STRUCTURED COMPANY ACTIONS (with optional opposed prompt)
  // ═══════════════════════════════════════════════════════════════════════════

  async _onCompanyAction(event, target) {
    event.preventDefault();
    const actorId = target.closest("[data-company-id]")?.dataset.companyId;
    const actor   = game.actors.get(actorId);
    if (!actor) return;

    // Permission check
    if (!game.user.isGM && !actor.isOwner) {
      return ui.notifications.warn("You do not have permission to act for this company.");
    }

    const q = actor.system.qualities || {};

    // ── War Chest (PC pledges) ──
    const pledges = actor.system.pledges || { bonus: 0, ed: 0, md: 0 };
    const hasPledges = (pledges.bonus || 0) > 0 || (pledges.ed || 0) > 0 || (pledges.md || 0) > 0;

    let warChestHtml = "";
    if (hasPledges) {
      const parts = [];
      if (pledges.bonus > 0) parts.push(`<strong>+${pledges.bonus}d</strong>`);
      if (pledges.ed > 0)    parts.push(`<strong>+${pledges.ed} ED</strong>`);
      if (pledges.md > 0)    parts.push(`<strong>+${pledges.md} MD</strong>`);
      warChestHtml = `
        <div class="reign-dialog-warchest" style="margin-bottom:8px;">
          <i class="fas fa-handshake"></i> War Chest Active: ${parts.join(" ")}
          <br><span class="reign-text-muted reign-text-sm">(These will be consumed upon rolling)</span>
        </div>`;
    }

    // ── Build the action catalog ──
    const actionOptions = Object.entries(REIGN.companyActions).map(([key, def]) => {
      const label = game.i18n.localize(def.label) || def.label;
      const eff1 = formatQuality(q[def.q1], def.q1).current;
      const eff2 = formatQuality(q[def.q2], def.q2).current;
      return `<option value="${key}">${label} (${QUALITY_LABELS[def.q1]} ${eff1}d + ${QUALITY_LABELS[def.q2]} ${eff2}d)</option>`;
    }).join("");

    // ── Build target company list ──
    const targetCompanies = game.actors
      .filter(a => a.type === "company" && a.id !== actor.id)
      .sort((a,b) => a.name.localeCompare(b.name));
    const targetOptions = targetCompanies.map(c =>
      `<option value="${c.id}">${foundry.utils.escapeHTML(c.name)}</option>`
    ).join("");

    const content = `
      <form class="reign-dialog-form fd-action-dialog">
        <p class="reign-dialog-callout fd-action-banner">
          <i class="fas fa-chess-queen"></i>
          <strong>${foundry.utils.escapeHTML(actor.name)}</strong> — Company Action
        </p>

        <div class="form-group">
          <label class="fd-dialog-label"><i class="fas fa-scroll"></i> Action Catalog</label>
          <select name="actionKey" class="fd-dialog-select">${actionOptions}</select>
        </div>

        <div class="fd-dialog-pool-preview">
          <span class="fd-dialog-pool-label">Dice Pool:</span>
          <span id="fd-pool-value" class="fd-dialog-pool-value">—</span>
        </div>

        ${warChestHtml}

        <div class="reign-grid-2col reign-gap-small">
          <div class="form-group">
            <label>Bonus Dice (+)</label>
            <input type="number" name="bonus" value="0" min="0" max="10"/>
          </div>
          <div class="form-group">
            <label>Penalty Dice (−)</label>
            <input type="number" name="penalty" value="0" min="0" max="10"/>
          </div>
        </div>

        <div class="form-group">
          <label class="fd-dialog-label"><i class="fas fa-crosshairs"></i> Opposed By</label>
          <select name="targetId" class="fd-dialog-select">
            <option value="">— No Opposition —</option>
            ${targetOptions}
          </select>
        </div>

        <div class="form-group">
          <label>Action Description <span class="reign-text-muted">(optional)</span></label>
          <input type="text" name="actionDesc" value="" placeholder="e.g. Raiding the Iron Crown's treasure caravans"/>
        </div>
      </form>`;

    const opts = await reignDialog(`${actor.name} — Company Action`, content, (e, b, d) => {
      const f = d.element.querySelector("form");
      return {
        actionKey: f.querySelector('[name="actionKey"]').value,
        bonus:     parseInt(f.querySelector('[name="bonus"]').value)   || 0,
        penalty:   parseInt(f.querySelector('[name="penalty"]').value) || 0,
        targetId:  f.querySelector('[name="targetId"]').value,
        desc:      f.querySelector('[name="actionDesc"]').value || ""
      };
    }, {
      defaultLabel: "Execute Action",
      width: 440,
      render: (event, html) => {
        const el = event?.target?.element ?? (event instanceof HTMLElement ? event : null);
        if (!el) return;
        const f = el.querySelector("form");
        const poolSpan = el.querySelector("#fd-pool-value");
        if (!f || !poolSpan) return;

        const updatePreview = () => {
          const actionKey = f.querySelector('[name="actionKey"]').value;
          const bonus   = parseInt(f.querySelector('[name="bonus"]').value)   || 0;
          const penalty = parseInt(f.querySelector('[name="penalty"]').value) || 0;
          const def = REIGN.companyActions[actionKey];
          if (!def) return;

          const eff1 = formatQuality(q[def.q1], def.q1).current;
          const eff2 = formatQuality(q[def.q2], def.q2).current;
          const totalSpecial = (pledges.ed || 0) + (pledges.md || 0);
          const intendedPool = eff1 + eff2 + bonus - penalty + (pledges.bonus || 0);
          const diceToRoll = Math.max(0, Math.min(intendedPool, 10 - totalSpecial));

          let displayStr = `${diceToRoll}d10`;
          if (pledges.ed > 0) displayStr += ` + ${pledges.ed} ED`;
          if (pledges.md > 0) displayStr += ` + ${pledges.md} MD`;
          if (intendedPool + totalSpecial > 10) displayStr += ` (capped)`;

          poolSpan.textContent = displayStr;
          poolSpan.className = (diceToRoll < 1 && totalSpecial === 0)
            ? "fd-dialog-pool-value fd-dialog-pool-fail"
            : "fd-dialog-pool-value";
        };

        f.querySelectorAll("input, select").forEach(el => {
          el.addEventListener("input", updatePreview);
          el.addEventListener("change", updatePreview);
        });
        updatePreview();
      }
    });
    if (!opts) return;

    // ── Resolve the roll ──
    const actionDef = REIGN.companyActions[opts.actionKey];
    if (!actionDef) return;

    const eff1 = formatQuality(q[actionDef.q1], actionDef.q1).current;
    const eff2 = formatQuality(q[actionDef.q2], actionDef.q2).current;

    // War Chest: apply pledge bonus dice and cap at 10 (accounting for ED/MD slots)
    const totalSpecial = (pledges.ed || 0) + (pledges.md || 0);
    const intendedPool = eff1 + eff2 + opts.bonus - opts.penalty + (pledges.bonus || 0);
    const pool = Math.max(0, Math.min(intendedPool, 10 - totalSpecial));

    if (pool < 1 && totalSpecial === 0) return ui.notifications.warn(`${actor.name} has no effective dice for this action.`);

    const roll    = new Roll(`${pool}d10`);
    await roll.evaluate();
    const results = roll.dice[0]?.results.map(r => r.result) || [];

    const actionLabel = game.i18n.localize(actionDef.label) || actionDef.label;
    const label = opts.desc
      ? `${opts.desc} (${actionLabel})`
      : `${actionLabel} (${actor.name})`;

    const breakdown = [
      { label: QUALITY_LABELS[actionDef.q1], value: `+${eff1}`, isPenalty: false },
      { label: QUALITY_LABELS[actionDef.q2], value: `+${eff2}`, isPenalty: false }
    ];
    if (pledges.bonus > 0) breakdown.push({ label: "War Chest", value: `+${pledges.bonus}`, isPenalty: false });
    if (opts.bonus > 0)    breakdown.push({ label: "Bonus",     value: `+${opts.bonus}`,     isPenalty: false });
    if (opts.penalty > 0)  breakdown.push({ label: "Penalty",   value: `−${opts.penalty}`,   isPenalty: true  });

    await postOREChat(actor, label, pool, results, pledges.ed || 0, pledges.md || 0, null, {
      poolBreakdown: breakdown, isAttack: false, isDefense: false
    });

    // ── Reset War Chest ──
    if (hasPledges) {
      await actor.update({
        "system.pledges.bonus": 0,
        "system.pledges.ed": 0,
        "system.pledges.md": 0
      });
      ui.notifications.info("War Chest pledges have been consumed for this roll.");
    }

    // ── Action Economy Erosion ──
    const usesUpdate = {};
    const eroded = [];
    for (const qKey of [actionDef.q1, actionDef.q2]) {
      if (!usesUpdate[`system.qualities.${qKey}.uses`]) {
        const currentUses = parseInt(q[qKey]?.uses) || 0;
        usesUpdate[`system.qualities.${qKey}.uses`] = currentUses + 1;
        eroded.push(QUALITY_LABELS[qKey]);
      }
    }
    if (Object.keys(usesUpdate).length) {
      await actor.update(usesUpdate);
    }

    // ── Post erosion summary ──
    if (eroded.length) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="reign-chat-card reign-callout">
            <span class="reign-text-warning reign-text-bold reign-font-display">
              <i class="fas fa-hourglass-half"></i> Action Economy Fatigue
            </span><br>
            <span class="reign-text-sm">
              <strong>${eroded.join(" & ")}</strong> degraded by 1 for the rest of the month.
            </span>
          </div>`
      });
    }

    // ── Opposed Action Prompt ──
    if (opts.targetId) {
      const target = game.actors.get(opts.targetId);
      if (target) {
        const opposition = ACTION_OPPOSITIONS[opts.actionKey];
        if (opposition) {
          const counterDef = REIGN.companyActions[opposition.counter];
          if (counterDef) {
            const cEff1 = formatQuality(target.system.qualities?.[counterDef.q1], counterDef.q1).current;
            const cEff2 = formatQuality(target.system.qualities?.[counterDef.q2], counterDef.q2).current;
            const counterLabel = game.i18n.localize(counterDef.label) || counterDef.label;

            await ChatMessage.create({
              speaker: { alias: "⚔ Faction Conflict" },
              content: `
                <div class="reign-chat-card reign-callout-info fd-opposed-prompt">
                  <h3 class="reign-font-display fd-opposed-title">
                    <i class="fas fa-shield-alt"></i> ${foundry.utils.escapeHTML(target.name)} Must Respond!
                  </h3>
                  <p class="reign-text-sm">
                    <strong>${foundry.utils.escapeHTML(actor.name)}</strong> has launched
                    <strong>${actionLabel}</strong> against <strong>${foundry.utils.escapeHTML(target.name)}</strong>.
                  </p>
                  <p class="fd-opposed-instruction">
                    <i class="fas fa-dice-d10"></i>
                    Roll <strong>${counterLabel}</strong>
                    (${QUALITY_LABELS[counterDef.q1]} ${cEff1}d + ${QUALITY_LABELS[counterDef.q2]} ${cEff2}d)
                    from the <strong>Faction Dashboard</strong> or the Company Sheet.
                  </p>
                  <p class="reign-text-muted reign-text-small">
                    Successful sets become Gobble Dice against the attacker's results.
                  </p>
                </div>`
            });
          }
        } else {
          // Non-opposed action against a target — just note it
          await ChatMessage.create({
            speaker: { alias: "⚔ Faction Conflict" },
            content: `
              <div class="reign-chat-card reign-callout">
                <p class="reign-text-sm">
                  <strong>${foundry.utils.escapeHTML(actor.name)}</strong> targets
                  <strong>${foundry.utils.escapeHTML(target.name)}</strong> with <strong>${actionLabel}</strong>.
                  The GM determines the appropriate response.
                </p>
              </div>`
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INLINE DAMAGE APPLICATION (GM only)
  // ═══════════════════════════════════════════════════════════════════════════

  async _onApplyDamage(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;

    const actorId    = target.closest("[data-company-id]")?.dataset.companyId;
    const qualityKey = target.dataset.quality;
    const actor      = game.actors.get(actorId);
    if (!actor || !qualityKey) return;

    const q = actor.system.qualities?.[qualityKey];
    if (!q) return;

    const qLabel  = QUALITY_LABELS[qualityKey];
    const current = formatQuality(q, qualityKey);

    const content = `
      <form class="reign-dialog-form">
        <p class="reign-dialog-callout">
          <strong>${foundry.utils.escapeHTML(actor.name)}</strong> — ${qLabel}
          <br><span class="reign-text-sm reign-text-muted">
            Permanent: ${current.value} · Damage: ${current.damage} · Effective: ${current.current}
          </span>
        </p>
        <div class="reign-grid-2col reign-gap-small">
          <div class="form-group">
            <label>Damage to Apply</label>
            <input type="number" name="amount" value="1" min="1" max="10"/>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="dmgType">
              <option value="temporary">Temporary</option>
              <option value="permanent">Permanent</option>
              <option value="heal">Heal (reduce damage)</option>
            </select>
          </div>
        </div>
      </form>`;

    const result = await reignDialog(`Apply Damage — ${qLabel}`, content, (e, b, d) => {
      const f = d.element.querySelector("form");
      return {
        amount:  parseInt(f.querySelector('[name="amount"]').value) || 1,
        dmgType: f.querySelector('[name="dmgType"]').value
      };
    }, { defaultLabel: "Apply", width: 360 });
    if (!result) return;

    const updates = {};
    if (result.dmgType === "temporary") {
      const newDmg = (q.damage || 0) + result.amount;
      // Check for overflow into permanent
      if (newDmg > q.value) {
        const overflow = newDmg - q.value;
        updates[`system.qualities.${qualityKey}.value`]  = Math.max(0, q.value - overflow);
        updates[`system.qualities.${qualityKey}.damage`] = Math.max(0, q.value - overflow);
        ui.notifications.warn(`${qLabel} defenses broke! Permanent value reduced by ${overflow}.`);
      } else {
        updates[`system.qualities.${qualityKey}.damage`] = newDmg;
      }
    } else if (result.dmgType === "permanent") {
      updates[`system.qualities.${qualityKey}.value`] = Math.max(0, (q.value || 0) - result.amount);
    } else if (result.dmgType === "heal") {
      updates[`system.qualities.${qualityKey}.damage`] = Math.max(0, (q.damage || 0) - result.amount);
    }

    await actor.update(updates);
    ui.notifications.info(`${actor.name}: ${qLabel} updated.`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHRONICLE LEDGER
  // ═══════════════════════════════════════════════════════════════════════════

  async _onViewChronicle(event, target) {
    event.preventDefault();
    const actorId = target.closest("[data-company-id]")?.dataset.companyId;
    const actor   = game.actors.get(actorId);
    if (!actor) return;

    const chronicle = (actor.system.chronicle || []).slice().sort((a,b) => (b.month - a.month) || (b.timestamp - a.timestamp));

    // Group by month for timeline display
    const months = new Map();
    for (const entry of chronicle) {
      const mKey = entry.month || 0;
      if (!months.has(mKey)) months.set(mKey, []);
      months.get(mKey).push(entry);
    }

    let rows = "";
    if (chronicle.length === 0) {
      rows = `<p class="reign-text-muted reign-text-center fd-chron-empty">
        <i class="fas fa-feather-alt"></i> No chronicle entries yet.
        History begins when the world clock first advances.
      </p>`;
    } else {
      for (const [month, entries] of months) {
        rows += `<div class="fd-chron-month-header"><i class="fas fa-calendar-alt"></i> Month ${month}</div>`;
        for (const entry of entries) {
          const typeDef = CHRONICLE_TYPES[entry.type] || CHRONICLE_TYPES.event;
          rows += `
            <div class="fd-chron-row ${typeDef.css}">
              <i class="${typeDef.icon} fd-chron-icon"></i>
              <span class="fd-chron-text">${foundry.utils.escapeHTML(entry.text)}</span>
            </div>`;
        }
      }
    }

    const content = `
      <div class="fd-chron-dialog">
        <div class="fd-chron-header">
          <h3><i class="fas fa-book-open"></i> ${foundry.utils.escapeHTML(actor.name)} — Chronicle</h3>
          <span class="reign-text-small reign-text-muted">${chronicle.length} entries</span>
        </div>
        <div class="fd-chron-list">${rows}</div>
      </div>`;

    await reignDialog(`${actor.name} — Chronicle`, content, () => null, {
      defaultLabel: "Close", width: 500
    });
  }

  async _onAddChronicleEntry(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const actorId = target.closest("[data-company-id]")?.dataset.companyId;
    const actor   = game.actors.get(actorId);
    if (!actor) return;

    // Auto-populate current world month
    const currentMonth = this._getCurrentWorldMonth();

    const typeOptions = Object.entries(CHRONICLE_TYPES)
      .filter(([k]) => k !== "advance") // advance is auto-generated
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join("");

    const content = `
      <form class="reign-dialog-form">
        <div class="reign-grid-2col reign-gap-small">
          <div class="form-group">
            <label>Month Number</label>
            <input type="number" name="month" value="${currentMonth}" min="1"/>
          </div>
          <div class="form-group">
            <label>Event Type</label>
            <select name="type">${typeOptions}</select>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="text" rows="3" placeholder="e.g. Declared war on the Sunken Throne"></textarea>
        </div>
      </form>`;

    const opts = await reignDialog("Add Chronicle Entry", content, (e, b, d) => {
      const f = d.element.querySelector("form");
      return {
        month: parseInt(f.querySelector('[name="month"]')?.value) || currentMonth,
        type:  f.querySelector('[name="type"]')?.value || "event",
        text:  f.querySelector('[name="text"]')?.value || ""
      };
    }, { defaultLabel: "Add Entry", width: 420 });

    if (!opts || !opts.text.trim()) return;

    const chronicle = foundry.utils.deepClone(actor.system.chronicle || []);
    chronicle.push({ month: opts.month, type: opts.type, text: opts.text.trim(), timestamp: Date.now() });
    await actor.update({ "system.chronicle": chronicle });
    ui.notifications.info(`Chronicle entry added to ${actor.name}.`);

    // Auto-export to Journal
    await this._exportChronicleToJournal(actor);
  }

  // ── Chronicle → Journal Export ─────────────────────────────────────────────

  async _onExportChronicle(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const actorId = target.closest("[data-company-id]")?.dataset.companyId;
    const actor   = game.actors.get(actorId);
    if (!actor) return;
    await this._exportChronicleToJournal(actor);
    ui.notifications.info(`Chronicle exported to Journals for ${actor.name}.`);
  }

  async _exportChronicleToJournal(actor) {
    if (!game.user.isGM) return;

    // Ensure a "Chronicles" folder exists
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === "Chronicles");
    if (!folder) {
      folder = await Folder.create({ name: "Chronicles", type: "JournalEntry", color: "#8b1f1f" });
    }

    const journalName = `${actor.name} — Chronicle`;
    let journal = game.journal.find(j => j.name === journalName && j.folder?.id === folder.id);

    // Build chronicle content as rich HTML
    const chronicle = (actor.system.chronicle || []).slice()
      .sort((a,b) => (a.month - b.month) || (a.timestamp - b.timestamp));

    const months = new Map();
    for (const entry of chronicle) {
      const mKey = entry.month || 0;
      if (!months.has(mKey)) months.set(mKey, []);
      months.get(mKey).push(entry);
    }

    let html = `<h1>${foundry.utils.escapeHTML(actor.name)}</h1>`;
    html += `<p><em>Chronicle of the rise and fall of ${foundry.utils.escapeHTML(actor.name)}. ${chronicle.length} entries recorded.</em></p><hr>`;

    for (const [month, entries] of months) {
      html += `<h2>Month ${month}</h2>`;
      for (const entry of entries) {
        const typeDef = CHRONICLE_TYPES[entry.type] || CHRONICLE_TYPES.event;
        html += `<p><strong>${typeDef.label}:</strong> ${foundry.utils.escapeHTML(entry.text)}</p>`;
      }
    }

    if (!journal) {
      // Create new journal with a single page
      journal = await JournalEntry.create({
        name: journalName,
        folder: folder.id,
        pages: [{ name: "Chronicle", type: "text", text: { content: html, format: 1 } }]
      });
    } else {
      // Update existing page
      const page = journal.pages.contents[0];
      if (page) {
        await page.update({ "text.content": html });
      } else {
        await journal.createEmbeddedDocuments("JournalEntryPage", [
          { name: "Chronicle", type: "text", text: { content: html, format: 1 } }
        ]);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ASSET DRAWERS
  // ═══════════════════════════════════════════════════════════════════════════

  _onToggleDrawer(event, target) {
    event.preventDefault();
    const actorId = target.closest("[data-company-id]")?.dataset.companyId;
    if (!actorId) return;
    if (this.expandedCompanies.has(actorId)) this.expandedCompanies.delete(actorId);
    else this.expandedCompanies.add(actorId);
    this.render(false);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════

  _onOpenSheet(event, target) {
    event.preventDefault();
    const actor = game.actors.get(target.dataset.id);
    if (actor) actor.sheet.render(true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ADVANCE MONTH (GM only)
  // ═══════════════════════════════════════════════════════════════════════════

  _getCurrentWorldMonth() {
    let worldMonth = 0;
    for (const c of game.actors.filter(a => a.type === "company")) {
      for (const entry of (c.system.chronicle || [])) {
        if (entry.month > worldMonth) worldMonth = entry.month;
      }
    }
    return worldMonth || 1;
  }

  async _onAdvanceMonth(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.error("Only the GM can advance the world clock.");

    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Advance Month?" },
      content: `
        <div class="reign-dialog-form">
          <p>This will advance the world clock by one month.</p>
          <p>All Companies will <strong>heal 1 point of temporary damage</strong> per Quality
             and <strong>reset their Action Economy</strong>.</p>
          <p>A chronicle entry will be recorded and exported to Journals for each affected Company.</p>
          <p>Proceed?</p>
        </div>`,
      rejectClose: false
    });
    if (!confirm) return;

    const companies = game.actors.filter(a => a.type === "company");
    if (!companies.length) return ui.notifications.info("No companies exist.");

    const bulkUpdates = [];
    const deltas      = [];

    // Next month: highest existing + 1
    let worldMonth = 1;
    for (const c of companies) {
      for (const entry of (c.system.chronicle || [])) {
        if (entry.month >= worldMonth) worldMonth = entry.month + 1;
      }
    }

    for (const c of companies) {
      const update = { _id: c.id };
      const delta  = { name: c.name, id: c.id, healed: [], refreshed: [] };
      let hasChanges = false;

      for (const key of QUALITY_KEYS) {
        const val  = parseInt(c.system.qualities[key]?.value)  || 0;
        const dmg  = parseInt(c.system.qualities[key]?.damage) || 0;
        const uses = parseInt(c.system.qualities[key]?.uses)   || 0;

        if (dmg > 0) {
          const newDmg = dmg - 1;
          update[`system.qualities.${key}.damage`] = newDmg;
          delta.healed.push({
            quality: QUALITY_LABELS[key], icon: QUALITY_ICONS[key],
            dmgFrom: dmg, dmgTo: newDmg,
            effFrom: Math.max(0, val - dmg - uses),
            effTo:   Math.max(0, val - newDmg)
          });
          hasChanges = true;
        }
        if (uses > 0) {
          update[`system.qualities.${key}.uses`] = 0;
          delta.refreshed.push(QUALITY_LABELS[key]);
          hasChanges = true;
        }
      }

      // Chronicle entry for this month
      if (hasChanges) {
        const healText    = delta.healed.map(h => `${h.quality} healed (${h.dmgFrom}→${h.dmgTo} dmg)`).join("; ");
        const refreshText = delta.refreshed.length ? `Actions reset: ${delta.refreshed.join(", ")}` : "";
        const entryText   = [healText, refreshText].filter(Boolean).join(". ");
        const chronicle   = foundry.utils.deepClone(c.system.chronicle || []);
        chronicle.push({ month: worldMonth, type: "advance", text: entryText, timestamp: Date.now() });
        update["system.chronicle"] = chronicle;
      }

      if (hasChanges) {
        bulkUpdates.push(update);
        deltas.push(delta);
      }
    }

    // Bulk write
    if (bulkUpdates.length > 0) {
      await Actor.updateDocuments(bulkUpdates);
    }

    // Delta report chat card
    const healCount    = deltas.filter(d => d.healed.length > 0).length;
    const refreshCount = deltas.filter(d => d.refreshed.length > 0).length;

    let reportRows = "";
    for (const d of deltas) {
      const healLines = d.healed.map(h =>
        `<div class="fd-delta-entry">
          <i class="${h.icon} fd-delta-icon"></i>
          <span class="fd-delta-quality">${h.quality}</span>
          <span class="fd-delta-change">damage ${h.dmgFrom} → ${h.dmgTo}</span>
          <span class="fd-delta-eff">(eff. ${h.effFrom} → ${h.effTo})</span>
        </div>`
      ).join("");
      const refreshLine = d.refreshed.length > 0
        ? `<div class="fd-delta-entry fd-delta-refresh">
            <i class="fas fa-sync-alt fd-delta-icon"></i>
            <span class="fd-delta-quality">Actions reset</span>
            <span class="fd-delta-change">${d.refreshed.join(", ")}</span>
          </div>` : "";

      reportRows += `
        <div class="fd-delta-row">
          <div class="fd-delta-name"><i class="fas fa-users"></i> ${foundry.utils.escapeHTML(d.name)}</div>
          ${healLines}${refreshLine}
        </div>`;
    }

    if (!deltas.length) {
      reportRows = `<p class="reign-text-muted reign-text-center">All factions at full strength.</p>`;
    }

    const unchangedCount = companies.length - deltas.length;
    const unchangedNote = unchangedCount > 0
      ? `<p class="reign-text-small reign-text-muted reign-text-center">${unchangedCount} faction(s) unchanged.</p>` : "";

    await ChatMessage.create({
      speaker: { alias: "The World Clock" },
      content: `
        <div class="reign-chat-card reign-card-success">
          <h3 class="reign-msg-success reign-font-display">
            <i class="fas fa-hourglass-half"></i> Month ${worldMonth} Begins
          </h3>
          <p class="reign-text-small reign-text-muted">
            ${healCount} faction(s) healed, ${refreshCount} refreshed actions.
          </p>
          <div class="fd-delta-report">${reportRows}</div>
          ${unchangedNote}
        </div>`
    });

    ui.notifications.success(`Month ${worldMonth}. ${bulkUpdates.length} faction(s) updated.`);

    // Auto-export all affected chronicles to Journals
    for (const d of deltas) {
      const actor = game.actors.get(d.id);
      if (actor) await this._exportChronicleToJournal(actor);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOKS: Sync dashboards when company actors change
// ═══════════════════════════════════════════════════════════════════════════

Hooks.on("updateActor", (actor) => { if (actor?.type === "company") FactionDashboard.syncAll(); });
Hooks.on("createActor", (actor) => { if (actor?.type === "company") FactionDashboard.syncAll(); });
Hooks.on("deleteActor", (actor) => { if (actor?.type === "company") FactionDashboard.syncAll(); });