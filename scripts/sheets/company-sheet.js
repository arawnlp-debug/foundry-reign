// scripts/sheets/company-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { CompanyRoller } from "../helpers/company-roller.js";
import { REIGN } from "../helpers/config.js";
import { reignConfirm, reignDialog } from "../helpers/dialog-util.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";
import { parseORE } from "../helpers/ore-engine.js";

export class ReignCompanySheet extends ScrollPreserveMixin(HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)) {
  static DEFAULT_OPTIONS = {
    tag: "form", 
    classes: ["reign", "sheet", "actor", "company"], 
    position: { width: 850, height: 800 },
    
    window: {
      resizable: true,
      minimizable: true
    },
    
    form: { submitOnChange: true, closeOnSubmit: false },
    // V14 ARCHITECTURE FIX: All actions strictly bound to the prototype
    actions: {
      changeTab: this.prototype._onChangeTab,
      rollCompanyStat: this.prototype._onRollCompanyStat,
      rollQuality: this.prototype._onRollQuality,
      adjustQualityDamage: this.prototype._onAdjustQualityDamage,
      adjustPledge: this.prototype._onAdjustPledge,
      upgradeQualityXP: this.prototype._onUpgradeQualityXP,
      rollImprovement: this.prototype._onRollImprovement,
      itemCreate: this.prototype._onItemCreate,
      itemEdit: this.prototype._onItemEdit,
      itemDelete: this.prototype._onItemDelete,
      itemToChat: this.prototype._onItemToChat,
      editImage: this.prototype._onEditImage,
      createEffect: this.prototype._onCreateEffect,
      editEffect: this.prototype._onEditEffect,
      deleteEffect: this.prototype._onDeleteEffect,
      toggleEffect: this.prototype._onToggleEffect,
      advancedEditEffect: this.prototype._onAdvancedEditEffect
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/actor/company-sheet.hbs" } };

  // ==========================================
  // ACTION HANDLERS (V14 Standard)
  // ==========================================

  async _onChangeTab(event, target) {
    event.preventDefault();
    this._activeTab = target.dataset.tab;
    this.render();
  }

  async _onRollCompanyStat(event, target) {
    event.preventDefault();
    try {
      await CompanyRoller.rollCompany(this.document, target.dataset);
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onRollQuality(event, target) {
    event.preventDefault();
    try {
      await CompanyRoller.rollCompany(this.document, target.dataset);
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onAdjustQualityDamage(event, target) {
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
  }

  async _onAdjustPledge(event, target) {
    event.preventDefault();
    const type = target.dataset.type; // "bonus", "ed", or "md"
    const isIncrease = target.dataset.dir === "up";
    
    let currentPledge = this.document.system.pledges?.[type] || 0;

    if (isIncrease) {
        await this.document.update({ [`system.pledges.${type}`]: currentPledge + 1 });
    } else if (!isIncrease && currentPledge > 0) {
        await this.document.update({ [`system.pledges.${type}`]: currentPledge - 1 });
    }
  }

  async _onUpgradeQualityXP(event, target) {
    event.preventDefault();
    try {
        const qualityKey = target.dataset.key;
        const system = this.document.system;
        const currentPerm = system.qualities[qualityKey]?.value || 0;
        const qualityLabel = qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1);

        if (currentPerm >= 6) {
            return ui.notifications.error(`${qualityLabel} is already at its maximum (6).`);
        }

        const newLevel = currentPerm + 1;
        const cost = newLevel * 10;
        const unspent = system.xp?.value || 0;

        if (unspent < cost) {
            return ui.notifications.error(`Insufficient XP. Upgrading ${qualityLabel} to ${newLevel} requires ${cost} XP, but the Faction only has ${unspent}.`);
        }

        const content = `<p style="text-align: center; font-size: 1.1em;">Spend <strong>${cost} XP</strong> to permanently upgrade <strong>${qualityLabel}</strong> to <strong>${newLevel}</strong>?</p>`;
        const confirm = await reignConfirm("Confirm XP Upgrade", content);
        
        if (!confirm) return;

        const updates = {
            "system.xp.value": unspent - cost,
            "system.xp.spent": (system.xp?.spent || 0) + cost,
            [`system.qualities.${qualityKey}.value`]: newLevel
        };

        await this.document.update(updates);
        
        const safeName = foundry.utils.escapeHTML(this.document.name);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            content: `<div class="reign-chat-card" style="border-color: #2e7d32;">
                <h3 style="color: #2e7d32;"><i class="fas fa-level-up-alt"></i> Quality Upgraded!</h3>
                <p><strong>${safeName}</strong> has invested <strong>${cost} Experience Points</strong> to grow its power.</p>
                <hr>
                <p style="text-align: center; font-size: 1.2em; font-weight: bold; margin: 5px 0;">
                    ${qualityLabel} increases to ${newLevel}!
                </p>
            </div>`
        });

    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onRollImprovement(event, target) {
    event.preventDefault();
    try {
      const qualityKey = target.dataset.key;
      if (!qualityKey) return ui.notifications.warn("No quality specified for improvement.");

      const system = this.document.system;
      const currentPerm = system.qualities[qualityKey]?.value || 0;
      const qualityLabel = qualityKey.charAt(0).toUpperCase() + qualityKey.slice(1);

      if (currentPerm >= 5) {
        return ui.notifications.error(`${qualityLabel} is already at 5. It cannot be improved further via rolling (RAW Ch10).`);
      }
      
      if (qualityKey === "treasure" || qualityKey === "territory") {
        return ui.notifications.warn(`${qualityLabel} cannot be improved through internal action rolls. You must engage in Raiding, Conquest, or Merging to increase this Quality (RAW Ch10).`);
      }

      let q1Req = "none";
      let q2Req = "none";
      if (qualityKey === "sovereignty") { q1Req = "territory"; q2Req = "treasure"; }
      if (qualityKey === "influence") { q1Req = "sovereignty"; q2Req = "treasure"; }
      if (qualityKey === "might") { q1Req = "sovereignty"; q2Req = "territory"; }

      const q1Label = q1Req.charAt(0).toUpperCase() + q1Req.slice(1);
      const q2Label = q2Req.charAt(0).toUpperCase() + q2Req.slice(1);
      const val1 = system.qualities[q1Req]?.effective || 0; 
      const val2 = system.qualities[q2Req]?.effective || 0; 

      const lastRollKey = `lastImprove_${qualityKey}`;
      const lastRollTime = this.document.getFlag("reign", lastRollKey) || 0;
      const currentTime = game.time.worldTime;
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      
      if (lastRollTime > 0 && (currentTime - lastRollTime) < thirtyDaysInSeconds) {
        const daysLeft = Math.ceil((thirtyDaysInSeconds - (currentTime - lastRollTime)) / (24 * 60 * 60));
        return ui.notifications.warn(`Cannot attempt to improve ${qualityLabel} again this month. Wait ${daysLeft} more in-game days.`);
      }

      const dialogContent = `
        <div class="reign-dialog-form">
          <p style="text-align: center; font-weight: bold; font-size: 1.1em;">Improve ${qualityLabel}</p>
          <p style="text-align: center; font-size: 0.9em; color: #555;">
            Target Difficulty: <strong>${currentPerm}</strong> (current permanent rating)<br>
            <em>Failing does NOT grant a temporary increase.</em>
          </p>
          <div class="dialog-grid dialog-grid-2" style="margin-bottom: 10px; border-top: 1px dashed #ccc; padding-top: 10px;">
              <div style="text-align: center;">
                  <label style="display:block;">Required Q1</label>
                  <strong style="color: #2d5a27;">${q1Label} (${val1})</strong>
              </div>
              <div style="text-align: center;">
                  <label style="display:block;">Required Q2</label>
                  <strong style="color: #2d5a27;">${q2Label} (${val2})</strong>
              </div>
          </div>
          <div class="form-group">
            <label>Modifier Dice (+d):</label>
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
            mod: parseInt(f.querySelector('[name="mod"]').value) || 0
          };
        },
        { defaultLabel: "Roll Improvement" }
      );

      if (!rollData) return;

      const totalPool = Math.min(val1 + val2 + rollData.mod, 10);

      if (totalPool < 1) return ui.notifications.warn("Pool too low. Improvement attempt fails automatically.");

      const roll = new Roll(`${totalPool}d10`);
      await roll.evaluate();
      const results = roll.dice[0]?.results.map(r => r.result) || [];
      const parsed = parseORE(results);

      const successSet = parsed.sets.find(s => s.height >= currentPerm);
      const safeName = foundry.utils.escapeHTML(this.document.name);
      const poolLabel = `${q1Label} + ${q2Label}`;

      await this.document.setFlag("reign", lastRollKey, currentTime);
      
      let currentQ1Uses = system.qualities[q1Req]?.uses || 0;
      let currentQ2Uses = system.qualities[q2Req]?.uses || 0;
      await this.document.update({
          [`system.qualities.${q1Req}.uses`]: currentQ1Uses + 1,
          [`system.qualities.${q2Req}.uses`]: currentQ2Uses + 1
      });

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
            <p style="font-size: 0.9em; color: #555;"><em>${qualityLabel} remains unchanged. ${q1Label} & ${q2Label} eroded.</em></p>
          </div>`
        });
        ui.notifications.warn(`Improvement failed. ${qualityLabel} remains at ${currentPerm}.`);
      }
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onItemCreate(event, target) {
    event.preventDefault();
    try {
      const type = target.dataset.type;
      const itemData = { name: `${game.i18n.localize("REIGN.New")} ${type.capitalize()}`, type: type };
      await this.document.createEmbeddedDocuments("Item", [itemData]);
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onItemEdit(event, target) {
    event.preventDefault();
    try {
      const itemId = target.closest("[data-item-id]").dataset.itemId;
      const item = this.document.items.get(itemId);
      if (item) item.sheet.render(true);
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onItemDelete(event, target) {
    event.preventDefault();
    try {
      const itemId = target.closest("[data-item-id]").dataset.itemId;
      const item = this.document.items.get(itemId);
      if (item) await item.delete();
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onItemToChat(event, target) {
    event.preventDefault();
    try {
      const item = this.document.items.get(target.dataset.itemId);
      if (!item) return;
      const safeName = foundry.utils.escapeHTML(item.name);
      let rawDesc = String(item.system.notes || item.system.effect || item.system.description || "");
      rawDesc = rawDesc
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/<img[\s\S]*?>/gi, "")
        .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
        .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
        .replace(/<embed[\s\S]*?>/gi, "");
        
      const safeDesc = await foundry.applications.ux.TextEditor.implementation.enrichHTML(rawDesc, {
        async: true,
        secrets: this.document.isOwner,
        relativeTo: this.document
      });
      
      let content = `<div class="reign-chat-card"><h3>${safeName}</h3><p>${item.type.toUpperCase()}</p><hr><div>${safeDesc}</div></div>`;
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({actor: this.document}), content: content });
    } catch(err) { ui.notifications.error(`${game.i18n.localize("REIGN.ErrorActionFailed")}: ${err.message}`); console.error(err); }
  }

  async _onEditImage(event, target) {
    event.preventDefault();
    const current = this.document.img;
    const fp = new FilePicker({
        type: "image",
        current: current,
        callback: path => {
            this.document.update({ img: path });
        }
    });
    return fp.browse();
  }

  async _onCreateEffect(event, target) {
      event.preventDefault();
      await this._handleEffectBuilder(null);
  }
  async _onEditEffect(event, target) {
      event.preventDefault();
      const effectId = target.closest(".effect-item")?.dataset?.effectId;
      await this._handleEffectBuilder(effectId);
  }
  async _onDeleteEffect(event, target) {
      event.preventDefault();
      const effectId = target.closest(".effect-item")?.dataset?.effectId;
      const effect = this.document.effects.get(effectId);
      if (effect) await effect.delete();
  }
  async _onToggleEffect(event, target) {
      event.preventDefault();
      const effectId = target.closest(".effect-item")?.dataset?.effectId;
      const effect = this.document.effects.get(effectId);
      if (effect) await effect.update({ disabled: !effect.disabled });
  }
  async _onAdvancedEditEffect(event, target) {
      event.preventDefault();
      const effectId = target.closest(".effect-item")?.dataset?.effectId;
      const effect = this.document.effects.get(effectId);
      if (effect) effect.sheet.render(true);
  }

  // ==========================================
  // CORE LOGIC & AE BUILDER
  // ==========================================

  _getEffectDictionary() {
      const dict = [];
      const qualities = { might: "Might", treasure: "Treasure", influence: "Influence", territory: "Territory", sovereignty: "Sovereignty" };

      for (const [k, v] of Object.entries(qualities)) {
          dict.push({ group: "Company Qualities", value: `system.qualities.${k}.value`, label: `Bonus ${v}`, mode: 2 });
      }
      return dict;
  }

  async _handleEffectBuilder(effectId = null) {
      const effect = effectId ? this.document.effects.get(effectId) : null;
      
      if (effect && effect.changes.length > 1) {
          ui.notifications.warn(game.i18n.localize("REIGN.EffectMultiWarning") || "This effect has multiple modifiers. Opening Advanced Editor.");
          return effect.sheet.render(true);
      }

      const change = effect && effect.changes.length > 0 ? effect.changes[0] : { key: "system.qualities.might.value", value: "1", mode: 2 };
      const effectName = effect ? effect.name : `${this.document.name} Asset/Problem`;

      const dict = this._getEffectDictionary();
      const grouped = {};
      dict.forEach(item => {
          if (!grouped[item.group]) grouped[item.group] = [];
          grouped[item.group].push(item);
      });

      let optionsHtml = "";
      for (const [group, items] of Object.entries(grouped)) {
          optionsHtml += `<optgroup label="${group}">`;
          for (const item of items) {
              const selected = item.value === change.key ? "selected" : "";
              optionsHtml += `<option value="${item.value}" ${selected}>${item.label}</option>`;
          }
          optionsHtml += `</optgroup>`;
      }

      const content = `
          <form class="reign-dialog-form">
              <div class="form-group">
                  <label>Asset/Problem Name:</label>
                  <input type="text" name="effName" value="${effectName}" required/>
              </div>
              <div class="form-group">
                  <label>What Quality does this modify?</label>
                  <select name="effKey" id="effKeySelect">
                      <option value="custom" ${!dict.find(d => d.value === change.key) ? "selected" : ""}>-- Custom / Unlisted Database Path --</option>
                      ${optionsHtml}
                  </select>
              </div>
              <div class="form-group" id="customKeyGroup" style="display: none;">
                  <label>Custom Attribute Key:</label>
                  <input type="text" name="customKey" value="${change.key}"/>
              </div>
              <div class="form-group">
                  <label>Modifier Value:</label>
                  <input type="text" name="effValue" id="effValueInput" value="${change.value}" required/>
                  <small class="reign-text-muted" id="effValueHint" style="display:block; margin-top:4px;">Enter a numeric value (e.g., 1 or -1).</small>
              </div>
              <div class="form-group" style="text-align:center; margin-top:10px;">
                  <a id="advancedEditBtn" style="font-size:0.85em; text-decoration:underline; color:var(--reign-color-blood); cursor:pointer;">
                      <i class="fas fa-cogs"></i> Open Advanced Foundry AE Editor
                  </a>
              </div>
          </form>
      `;

      const result = await reignDialog(
          effect ? "Edit Asset/Problem Modifier" : "Create Asset/Problem Modifier",
          content,
          (e, b, d) => {
              const form = d.element.querySelector("form");
              let finalKey = form.effKey.value;
              if (finalKey === "custom") finalKey = form.customKey.value;
              const opt = dict.find(o => o.value === finalKey);
              return {
                  name: form.effName.value,
                  key: finalKey,
                  value: form.effValue.value,
                  mode: opt ? opt.mode : (!isNaN(Number(form.effValue.value)) ? 2 : 5)
              };
          },
          {
              defaultLabel: "Save Modifier",
              render: (context, el) => {
                  const select = el.querySelector("#effKeySelect");
                  const hint = el.querySelector("#effValueHint");
                  const customGroup = el.querySelector("#customKeyGroup");
                  const advBtn = el.querySelector("#advancedEditBtn");

                  const updateUI = () => {
                     const opt = dict.find(o => o.value === select.value);
                     if (select.value === "custom") {
                         customGroup.style.display = "block";
                         hint.textContent = "Enter value based on the targeted key.";
                     } else {
                         customGroup.style.display = "none";
                         if (opt?.isBool) { hint.textContent = "Type 'true' to enable or 'false' to disable."; }
                         else if (opt?.isString) { hint.textContent = "Type a target location (e.g., 'torso')."; }
                         else { hint.textContent = "Type a number (e.g., 1 or -1)."; }
                     }
                  };
                  
                  select.addEventListener("change", updateUI);
                  updateUI();

                  advBtn.addEventListener("click", () => {
                      const closeBtn = el.querySelector('[data-action="close"]');
                      if (closeBtn) closeBtn.click(); 
                      
                      if (effect) {
                          effect.sheet.render(true);
                      } else {
                          this.document.createEmbeddedDocuments("ActiveEffect", [{
                              name: "New Advanced Effect",
                              img: "icons/svg/aura.svg",
                              disabled: false
                          }]).then(effs => effs[0].sheet.render(true));
                      }
                  });
              }
          }
      );

      if (result) {
          const changes = result.key ? [{ key: result.key, mode: result.mode, value: result.value }] : [];
          if (effect) {
              await effect.update({ name: result.name, changes });
          } else {
              await this.document.createEmbeddedDocuments("ActiveEffect", [{
                  name: result.name,
                  img: "icons/svg/aura.svg",
                  disabled: false,
                  changes: changes
              }]);
          }
      }
  }

  _processSubmitData(event, form, formData) {
    let data = super._processSubmitData(event, form, formData);
    let flatData = foundry.utils.flattenObject(data);
    let changed = false;

    for (const key in flatData) {
        if (key.endsWith(".value") || key.endsWith(".damage") || key.endsWith(".uses") || key.endsWith(".spent")) {
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
            uses: qs[k]?.uses || 0,
            effective: qs[k]?.effective || 0
        };
    });

    const items = this.document.items;
    context.assets = items.filter(i => i.type === "asset"); 
    context.problems = items.filter(i => i.type === "problem");
    
    context.effects = Array.from(this.document.effects);
    
    this._activeTab = this._activeTab || "details";
    context.tabs = {
      details: this._activeTab === "details" ? "active" : "",
      effects: this._activeTab === "effects" ? "active" : ""
    };
    
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