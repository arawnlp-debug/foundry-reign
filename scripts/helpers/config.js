// scripts/helpers/config.js

export const REIGN = {};

/**
 * Shared mapping of Reign skills to their default attributes.
 * Used by the Roller and the Character Sheet.
 * @constant {Object}
 */
export const skillAttrMap = {
  athletics: "body", endurance: "body", fight: "body", parry: "body", run: "body", vigor: "body",
  climb: "coordination", dodge: "coordination", ride: "coordination", stealth: "coordination",
  direction: "sense", eerie: "sense", empathy: "sense", hearing: "sense", scrutinize: "sense", sight: "sense", taste_touch_smell: "sense",
  counterspell: "knowledge", healing: "knowledge", languageNative: "knowledge", lore: "knowledge", strategy: "knowledge", tactics: "knowledge",
  haggle: "command", inspire: "command", intimidate: "command",
  fascinate: "charm", graces: "charm", jest: "charm", lie: "charm", plead: "charm"
};

/**
 * Shared utility to calculate effective shield coverage.
 * If a shield is equipped but the user hasn't explicitly toggled any protected locations,
 * it defaults to protecting the arm holding it.
 * * @param {Object} shieldSystemData - The `item.system` object of a shield.
 * @returns {Object} A map of body locations to boolean values indicating protection.
 */
export function getEffectiveShieldLocations(shieldSystemData) {
  const locs = shieldSystemData.protectedLocations || {};
  const anyActive = Object.values(locs).some(v => v === true);
  
  let effectiveLocations = foundry.utils.deepClone(locs);
  
  if (!anyActive && shieldSystemData.equipped && shieldSystemData.shieldArm) {
      effectiveLocations[shieldSystemData.shieldArm] = true;
  }
  
  return effectiveLocations;
}

/**
 * Standardized Reign Company Actions (RAW Chapter 8).
 * Extracted from the sheets for maintainability and localization.
 * @constant {Object}
 */
REIGN.companyActions = {
    attack: { label: "REIGN.CompanyActionAttack", pool: ["might", "might"] },
    defend: { label: "REIGN.CompanyActionDefend", pool: ["might", "territory"] },
    espionage: { label: "REIGN.CompanyActionEspionage", pool: ["influence", "treasure"] },
    policing: { label: "REIGN.CompanyActionPolicing", pool: ["sovereignty", "territory"] },
    levy: { label: "REIGN.CompanyActionLevy", pool: ["sovereignty", "treasure"] },
    morale: { label: "REIGN.CompanyActionMorale", pool: ["sovereignty", "influence"] },
    createAsset: { label: "REIGN.CompanyActionCreateAsset", pool: ["treasure", "influence"] },
    unconventional: { label: "REIGN.CompanyActionUnconventional", pool: ["custom", "custom"] }
};