// scripts/sheets/item-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class ReignItemSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  
  static get DEFAULT_OPTIONS() {
    return { 
      tag: "form", 
      classes: ["reign", "sheet", "item"], 
      position: { width: 450, height: "auto" },
      // RESPONSIVENESS FIX: Enable resizable window and minimizability
      window: {
        resizable: true,
        minimizable: true
      },
      form: { submitOnChange: true, closeOnSubmit: false },
      actions: {
        // IMAGE EDIT
        editImage: async function(event, target) {
          try {
            const fp = new FilePicker({
              type: "image",
              current: this.document.img,
              callback: path => this.document.update({ img: path })
            });
            return fp.browse();
          } catch(err) { 
            ui.notifications.error(`Action failed: ${err.message}`); 
            console.error(err); 
          }
        },
        // PHASE 2.4: ACTIVE EFFECTS V2 ACTIONS (Updated for Responsiveness & UI Sync)
        createEffect: async function(event, target) {
          const item = this.document;
          // If this item can be equipped, default the effect to match the equipped state!
          const startDisabled = item.system.equipped !== undefined ? !item.system.equipped : false;
          
          // V13 STRICT: Use createEmbeddedDocuments instead of ActiveEffect.create
          await item.createEmbeddedDocuments("ActiveEffect", [{
            name: `New ${item.name} Effect`,
            img: item.img || "icons/svg/aura.svg",
            origin: item.uuid,
            disabled: startDisabled
          }]);

          this.render(true); // Force UI refresh
        },
        editEffect: async function(event, target) {
          const effectId = target.closest(".effect-item").dataset.effectId;
          const effect = this.document.effects.get(effectId);
          if (effect) effect.sheet.render(true);
        },
        deleteEffect: async function(event, target) {
          const effectId = target.closest(".effect-item").dataset.effectId;
          const effect = this.document.effects.get(effectId);
          if (effect) {
            await effect.delete();
            this.render(true); // Force UI refresh
          }
        },
        toggleEffect: async function(event, target) {
          const effectId = target.closest(".effect-item").dataset.effectId;
          const effect = this.document.effects.get(effectId);
          if (effect) {
            await effect.update({ disabled: !effect.disabled });
            this.render(true); // Force UI refresh
          }
        }
      }
    };
  }

  static get PARTS() {
    return { sheet: { template: "systems/reign/templates/item/item-sheet.hbs" } };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.document;
    context.system = this.document.system;
    
    // FIXED: Convert the Collection to an Array so Handlebars can accurately read its .length
    context.effects = Array.from(this.document.effects);

    // Type checking for template rendering
    context.isWeapon = this.document.type === "weapon";
    context.isArmor = this.document.type === "armor";
    context.isShield = this.document.type === "shield";
    context.isTechnique = this.document.type === "technique";
    context.isSpell = this.document.type === "spell";
    context.isDiscipline = this.document.type === "discipline";
    context.isGear = this.document.type === "gear";
    context.isAdvantage = this.document.type === "advantage";
    context.isProblem = this.document.type === "problem";

    // Required for the Armor/Shield weight dropdowns
    context.armorWeightOptions = {
      light: "REIGN.ArmorLight",
      medium: "REIGN.ArmorMedium",
      heavy: "REIGN.ArmorHeavy"
    };

    // PHASE 1 REFACTOR: Shield Specific Options (Airtight RAW)
    context.shieldSizeOptions = {
      small: "REIGN.ShieldSmall",
      large: "REIGN.ShieldLarge",
      tower: "REIGN.ShieldTower"
    };

    context.shieldMaterialOptions = {
      wood: "REIGN.MaterialWood",
      metal: "REIGN.MaterialMetal"
    };

    context.shieldArmOptions = {
      armL: "REIGN.ArmL",
      armR: "REIGN.ArmR"
    };

    // NEW: Casting Stat Options for Sorcery Flexibility
    context.attributeOptions = {
      body: "REIGN.AttrBody",
      coordination: "REIGN.AttrCoordination",
      sense: "REIGN.AttrSense",
      knowledge: "REIGN.AttrKnowledge",
      command: "REIGN.AttrCommand",
      charm: "REIGN.AttrCharm"
    };

    return context;
  }

  /**
   * AIRTIGHT RAW: Automated Property Calculation
   * Note: In ApplicationV2, we intercept _prepareSubmitData, not _prepareUpdateObject!
   * @override
   */
  _prepareSubmitData(event, form, formData) {
    const submitData = super._prepareSubmitData(event, form, formData);
    
    // Only enforce Armor Rating if the Material was actually changed!
    if (this.document.type === "shield") {
        const newMaterial = foundry.utils.getProperty(submitData, "system.material");
        
        if (newMaterial && newMaterial !== this.document.system.material) {
            // Wood = 1 AR, Metal = 3 AR
            foundry.utils.setProperty(submitData, "system.coverAR", newMaterial === "metal" ? 3 : 1);
        }
    }

    return submitData;
  }
}