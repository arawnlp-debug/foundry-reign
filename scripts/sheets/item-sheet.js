// scripts/sheets/item-sheet.js
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class ReignItemSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = { 
    tag: "form", 
    classes: ["reign", "sheet", "item"], 
    position: { width: 450, height: "auto" }, 
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      // NEW: Image editing action for ApplicationV2
      editImage: async function(event, target) {
        const fp = new FilePicker({
          type: "image",
          current: this.document.img,
          callback: path => this.document.update({ img: path })
        });
        return fp.browse();
      }
    }
  };

  static PARTS = { sheet: { template: "systems/reign/templates/item/item-sheet.hbs" } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.document;
    context.system = this.document.system;

    // Type checking for template rendering
    context.isWeapon = this.document.type === "weapon";
    context.isArmor = this.document.type === "armor";
    // FIXED: Added shield type check for template logic
    context.isShield = this.document.type === "shield";
    context.isTechnique = this.document.type === "technique";
    context.isSpell = this.document.type === "spell";
    context.isDiscipline = this.document.type === "discipline";
    context.isGear = this.document.type === "gear";
    context.isAdvantage = this.document.type === "advantage";
    context.isProblem = this.document.type === "problem";

    // Required for the Armor/Shield weight dropdowns to use selectOptions helper safely
    context.armorWeightOptions = {
      light: "REIGN.ArmorLight",
      medium: "REIGN.ArmorMedium",
      heavy: "REIGN.ArmorHeavy"
    };

    return context;
  }
}