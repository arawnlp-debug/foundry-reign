// scripts/sheets/item-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { reignDialog } from "../helpers/dialog-util.js";
import { skillAttrMap, getEffectDictionary, getItemEffectExtras } from "../helpers/config.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";

export class ReignItemSheet extends ScrollPreserveMixin(HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2)) {
  
  static get DEFAULT_OPTIONS() {
    return { 
      tag: "form", 
      classes: ["reign", "sheet", "item"], 
      position: { width: 450, height: "auto" },
      window: {
        resizable: true,
        minimizable: true
      },
      form: { submitOnChange: true, closeOnSubmit: false },
      // V14 ARCHITECTURE FIX: All actions strictly bound to the prototype
      actions: {
        changeTab: this.prototype._onChangeTab,
        editImage: this.prototype._onEditImage,
        createEffect: this.prototype._onCreateEffect,
        editEffect: this.prototype._onEditEffect,
        deleteEffect: this.prototype._onDeleteEffect,
        toggleEffect: this.prototype._onToggleEffect,
        advancedEditEffect: this.prototype._onAdvancedEditEffect
      }
    };
  }

  static get PARTS() {
    return { sheet: { template: "systems/reign/templates/item/item-sheet.hbs" } };
  }

  // ==========================================
  // ACTION HANDLERS (V14 Standard)
  // ==========================================

  async _onChangeTab(event, target) {
    event.preventDefault();
    this._activeTab = target.dataset.tab;
    this.render();
  }
  
  async _onEditImage(event, target) {
    event.preventDefault();
    try {
      const fp = new foundry.applications.apps.FilePicker.implementation({
        type: "image",
        current: this.document.img,
        callback: path => this.document.update({ img: path })
      });
      return fp.browse();
    } catch(err) { 
      ui.notifications.error(`Action failed: ${err.message}`); 
      console.error(err); 
    }
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

  /**
   * The Master Dictionary that bridges the UI dropdowns to the `models.js` catch-basins.
   * [PRUNED FOR V2.0.1: Only active, engine-wired fields remain]
   */
  _getEffectDictionary() {
    return [...getEffectDictionary(), ...getItemEffectExtras()];
  }

  async _handleEffectBuilder(effectId = null) {
      const effect = effectId ? this.document.effects.get(effectId) : null;
      
      if (effect && effect.changes.length > 1) {
          ui.notifications.warn(game.i18n.localize("REIGN.EffectMultiWarning") || "This effect has multiple modifiers. Opening Advanced Editor.");
          return effect.sheet.render(true);
      }

      const change = effect && effect.changes.length > 0 ? effect.changes[0] : { key: "system.modifiers.globalPool", value: "1", mode: 2 };
      const effectName = effect ? effect.name : `${this.document.name} Modifier`;

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
                  <label>Effect Name:</label>
                  <input type="text" name="effName" value="${effectName}" required/>
              </div>
              <div class="form-group">
                  <label>What does this modify?</label>
                  <select name="effKey" id="effKeySelect">
                      <option value="custom" ${!dict.find(d => d.value === change.key) ? "selected" : ""}>-- Custom / Unlisted Database Path --</option>
                      ${optionsHtml}
                  </select>
              </div>
              <div class="form-group" id="customKeyGroup" class="reign-hidden">
                  <label>Custom Attribute Key:</label>
                  <input type="text" name="customKey" value="${change.key}"/>
              </div>
              <div class="form-group">
                  <label>Modifier Value:</label>
                  <input type="text" name="effValue" id="effValueInput" value="${change.value}" required/>
                  <small class="reign-text-muted reign-dialog-subtitle" id="effValueHint">Enter a numeric value (e.g., 1 or -1).</small>
              </div>
              <div class="form-group reign-text-center">
                  <a id="advancedEditBtn" class="reign-dialog-advanced-link">
                      <i class="fas fa-cogs"></i> Open Advanced Foundry AE Editor
                  </a>
              </div>
          </form>
      `;

      const result = await reignDialog(
          effect ? "Edit Modifier" : "Create Modifier",
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
                         customGroup.classList.remove("reign-hidden");
                         hint.textContent = "Enter value based on the targeted key.";
                     } else {
                         customGroup.classList.add("reign-hidden");
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
                          const startDisabled = this.document.system.equipped !== undefined ? !this.document.system.equipped : false;
                          this.document.createEmbeddedDocuments("ActiveEffect", [{
                              name: "New Advanced Effect",
                              img: this.document.img || "icons/svg/aura.svg",
                              disabled: startDisabled
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
              const startDisabled = this.document.system.equipped !== undefined ? !this.document.system.equipped : false;
              await this.document.createEmbeddedDocuments("ActiveEffect", [{
                  name: result.name,
                  img: this.document.img || "icons/svg/aura.svg",
                  origin: this.document.uuid,
                  disabled: startDisabled,
                  changes: changes
              }]);
          }
      }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.document;
    context.system = this.document.system;
    
    context.effects = Array.from(this.document.effects);

    context.isWeapon = this.document.type === "weapon";
    context.isArmor = this.document.type === "armor";
    context.isShield = this.document.type === "shield";
    context.isTechnique = this.document.type === "technique";
    context.isSpell = this.document.type === "spell";
    context.isDiscipline = this.document.type === "discipline";
    context.isGear = this.document.type === "gear";
    context.isAdvantage = this.document.type === "advantage";
    context.isProblem = this.document.type === "problem";
    context.isAsset = this.document.type === "asset";

    context.armorWeightOptions = { light: "REIGN.ArmorLight", medium: "REIGN.ArmorMedium", heavy: "REIGN.ArmorHeavy" };
    context.shieldSizeOptions = { small: "REIGN.ShieldSmall", large: "REIGN.ShieldLarge", tower: "REIGN.ShieldTower" };
    context.shieldMaterialOptions = { wood: "REIGN.MaterialWood", metal: "REIGN.MaterialMetal" };
    context.shieldArmOptions = { armL: "REIGN.ArmL", armR: "REIGN.ArmR" };
    context.attributeOptions = { body: "REIGN.AttrBody", coordination: "REIGN.AttrCoordination", sense: "REIGN.AttrSense", knowledge: "REIGN.AttrKnowledge", command: "REIGN.AttrCommand", charm: "REIGN.AttrCharm" };

    // Spell: compute detection radius from intensity for display
    if (context.isSpell) {
        const DETECTION_RADIUS = ["—", "—", "5 ft", "10 ft", "50 ft", "1,000 ft", "1 mile", "10 miles", "25 miles", "50 miles", "100 miles"];
        const intensity = Math.min(10, Math.max(1, parseInt(this.document.system.intensity) || 1));
        context.detectionRadius = DETECTION_RADIUS[intensity];
    }

    this._activeTab = this._activeTab || "details";
    context.tabs = {
      details: this._activeTab === "details" ? "active" : "",
      effects: this._activeTab === "effects" ? "active" : ""
    };

    return context;
  }

  _processSubmitData(event, form, formData) {
    const submitData = super._processSubmitData(event, form, formData);
    if (this.document.type === "shield") {
        const newMaterial = foundry.utils.getProperty(submitData, "system.material");
        if (newMaterial && newMaterial !== this.document.system.material) {
            foundry.utils.setProperty(submitData, "system.coverAR", newMaterial === "metal" ? 3 : 1);
        }
    }
    // Coerce numeric spell fields to integers (empty string → 0)
    if (this.document.type === "spell") {
        const numericFields = ["system.intensity", "system.slow", "system.castingTime"];
        const flat = foundry.utils.flattenObject(submitData);
        let changed = false;
        for (const field of numericFields) {
            if (field in flat) {
                const parsed = parseInt(flat[field]);
                flat[field] = isNaN(parsed) ? 0 : Math.max(0, parsed);
                changed = true;
            }
        }
        return changed ? foundry.utils.expandObject(flat) : submitData;
    }

    // Enforce massive requires two-handed: clear massive if twoHanded is being unset
    if (this.document.type === "weapon") {
        const flat = foundry.utils.flattenObject(submitData);
        const twoHanded = flat["system.qualities.twoHanded"] ?? this.document.system.qualities?.twoHanded;
        if (!twoHanded && flat["system.qualities.massive"]) {
            flat["system.qualities.massive"] = false;
            return foundry.utils.expandObject(flat);
        }
    }

    return submitData;
  }
}