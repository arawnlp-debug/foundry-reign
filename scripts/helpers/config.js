// scripts/helpers/config.js

export const REIGN = {};

/**
 * Global pool limit for ORE rolls (RAW default).
 * AUDIT FIX B16: Centralized dice cap for universal reference.
 * @constant {number}
 */
REIGN.MAX_DICE = 15;

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
 * @param {Object} shieldSystemData - The `item.system` object of a shield.
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
    attack:          { label: "REIGN.CompanyActionAttack",        q1: "might",       q2: "treasure",    target: "might",     diff: 0, cost: "might" },
    being_informed:  { label: "REIGN.CompanyActionInformed",      q1: "influence",   q2: "sovereignty", target: "none",      diff: 0, cost: "none" },
    counter_espionage:{ label: "REIGN.CompanyActionCounterEsp",   q1: "influence",   q2: "territory",   target: "influence", diff: 0, cost: "none" },
    defend:          { label: "REIGN.CompanyActionDefend",        q1: "might",       q2: "territory",   target: "none",      diff: 0, cost: "none" },
    espionage:       { label: "REIGN.CompanyActionEspionage",     q1: "influence",   q2: "treasure",    target: "influence", diff: 0, cost: "none" },
    improve_culture: { label: "REIGN.CompanyActionCulture",       q1: "territory",   q2: "treasure",    target: "none",      diff: 0, cost: "none" },
    policing:        { label: "REIGN.CompanyActionPolicing",      q1: "might",       q2: "sovereignty", target: "influence", diff: 0, cost: "none" },
    rise_in_stature: { label: "REIGN.CompanyActionRise",          q1: "sovereignty", q2: "treasure",    target: "none",      diff: 0, cost: "none" },
    train_levy:      { label: "REIGN.CompanyActionLevy",          q1: "sovereignty", q2: "territory",   target: "none",      diff: 0, cost: "none" },
    unconventional:  { label: "REIGN.CompanyActionUnconventional",q1: "influence",   q2: "might",       target: "might",     diff: 0, cost: "none" }
};