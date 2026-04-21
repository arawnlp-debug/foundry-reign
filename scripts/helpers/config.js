// scripts/helpers/config.js

export const REIGN = {};

/**
 * Canonical list of character hit locations, used across damage, health,
 * sheet rendering, and status-effect logic.
 * @constant {string[]}
 */
export const HIT_LOCATIONS = Object.freeze(["head", "torso", "armR", "armL", "legR", "legL"]);

/**
 * Human-readable labels for each hit location (with die-face ranges).
 * @constant {Object}
 */
export const HIT_LOCATION_LABELS = Object.freeze({
  head: "Head (10)", torso: "Torso (7–9)", armR: "R. Arm (5–6)",
  armL: "L. Arm (3–4)", legR: "R. Leg (2)", legL: "L. Leg (1)"
});

/**
 * Short labels for hit locations (no die ranges), used in effect dictionaries
 * and compact UIs.
 * @constant {Object}
 */
export const HIT_LOCATION_SHORT_LABELS = Object.freeze({
  head: "Head", torso: "Torso", armR: "Right Arm", armL: "Left Arm",
  legR: "Right Leg", legL: "Left Leg"
});

/**
 * Master Active Effect dictionary shared by character and item sheets.
 * Each entry defines a change key, its label, group, and mode.
 * Sheets can filter or extend as needed.
 * @returns {Object[]} The array of effect dictionary entries.
 */
export function getEffectDictionary() {
  const dict = [];

  // Global
  dict.push({ group: "Global", value: "system.modifiers.globalPool", label: "Bonus Dice Pool", mode: 2 });

  // Combat & Damage
  dict.push({ group: "Combat & Damage", value: "system.modifiers.combat.bonusDamageShock", label: "Bonus Shock Damage", mode: 2 });
  dict.push({ group: "Combat & Damage", value: "system.modifiers.combat.bonusDamageKilling", label: "Bonus Killing Damage", mode: 2 });
  dict.push({ group: "Combat & Damage", value: "system.modifiers.combat.ignoreArmorTarget", label: "Ignore Target Armor (e.g. Venom Blade)", mode: 2 });
  dict.push({ group: "Combat & Damage", value: "system.modifiers.combat.combineGobbleDice", label: "Combine Gobble Dice (Superior Interception)", mode: 5, isBool: true });
  dict.push({ group: "Combat & Damage", value: "system.modifiers.combat.crossBlockActive", label: "Cross Block Enabled", mode: 5, isBool: true });

  // Health, Armor, Hit Redirection (per-location)
  for (const [k, v] of Object.entries(HIT_LOCATION_SHORT_LABELS)) {
    dict.push({ group: "Max Health", value: `system.modifiers.healthMax.${k}`, label: `Max Health: ${v}`, mode: 2 });
    dict.push({ group: "Natural Armor", value: `system.modifiers.naturalArmor.${k}`, label: `Natural Armor: ${v}`, mode: 2 });
    dict.push({ group: "Hit Redirection", value: `system.modifiers.hitRedirects.${k}`, label: `Redirect Hits from ${v} to...`, mode: 5, isString: true });
  }

  // Skills
  for (const s of Object.keys(skillAttrMap)) {
    const sName = s.charAt(0).toUpperCase() + s.slice(1);
    dict.push({ group: `Skill: ${sName}`, value: `system.modifiers.skills.${s}.pool`, label: `Bonus Dice Pool`, mode: 2 });
  }

  // Immunities
  dict.push({ group: "Immunities & Restrictions", value: "system.modifiers.systemFlags.ignoreFatiguePenalties", label: "Ignore Fatigue", mode: 5, isBool: true });
  dict.push({ group: "Immunities & Restrictions", value: "system.modifiers.systemFlags.ignoreHeavyArmorSwim", label: "Swim in Heavy Armor", mode: 5, isBool: true });
  dict.push({ group: "Immunities & Restrictions", value: "system.modifiers.systemFlags.cannotUseTwoHanded", label: "Cannot Use Two-Handed Weapons", mode: 5, isBool: true });

  return dict;
}

/**
 * Additional effect entries for item sheets (Company Quality bonuses).
 * @returns {Object[]}
 */
export function getItemEffectExtras() {
  return [
    { group: "Company Qualities", value: "system.qualities.might.value", label: "Might (Bonus / Penalty)", mode: 2 },
    { group: "Company Qualities", value: "system.qualities.treasure.value", label: "Treasure (Bonus / Penalty)", mode: 2 },
    { group: "Company Qualities", value: "system.qualities.influence.value", label: "Influence (Bonus / Penalty)", mode: 2 },
    { group: "Company Qualities", value: "system.qualities.territory.value", label: "Territory (Bonus / Penalty)", mode: 2 },
    { group: "Company Qualities", value: "system.qualities.sovereignty.value", label: "Sovereignty (Bonus / Penalty)", mode: 2 },
  ];
}

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
 * Standardized Reign Company Actions (RAW Chapter 5).
 * Extracted from the sheets for maintainability and localization.
 * @constant {Object}
 */
REIGN.companyActions = {
    attack:            { label: "REIGN.CompanyActionAttack",         q1: "might",       q2: "treasure" },
    being_informed:    { label: "REIGN.CompanyActionInformed",       q1: "influence",   q2: "sovereignty" },
    counter_espionage: { label: "REIGN.CompanyActionCounterEsp",     q1: "influence",   q2: "territory" },
    defend:            { label: "REIGN.CompanyActionDefend",         q1: "might",       q2: "territory" },
    espionage:         { label: "REIGN.CompanyActionEspionage",      q1: "influence",   q2: "treasure" },
    improve_culture:   { label: "REIGN.CompanyActionCulture",        q1: "territory",   q2: "treasure" },
    policing:          { label: "REIGN.CompanyActionPolicing",       q1: "might",       q2: "sovereignty" },
    rise_in_stature:   { label: "REIGN.CompanyActionRise",           q1: "sovereignty", q2: "treasure" },
    train_levy:        { label: "REIGN.CompanyActionLevy",           q1: "sovereignty", q2: "territory" },
    unconventional:    { label: "REIGN.CompanyActionUnconventional", q1: "influence",   q2: "might" }
};