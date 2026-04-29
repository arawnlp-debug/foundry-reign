// scripts/helpers/ore-engine.js

export function computeLocationDamage(currentShock, currentKilling, incomingShock, incomingKilling, max) {
  currentShock = parseInt(currentShock) || 0;
  currentKilling = parseInt(currentKilling) || 0;
  incomingShock = parseInt(incomingShock) || 0;
  incomingKilling = parseInt(incomingKilling) || 0;
  max = parseInt(max) || 0;

  // Step 1: Apply Killing first
  let newKilling = currentKilling + incomingKilling;
  let newShock = currentShock + incomingShock;

  // Step 2: If total Shock exceeds remaining non-Killing boxes, excess becomes Killing
  let shockCapacity = max - newKilling;
  if (shockCapacity < 0) shockCapacity = 0;

  let excessShock = Math.max(0, newShock - shockCapacity);
  if (excessShock > 0) {
    newShock -= excessShock;
    newKilling += excessShock;
  }

  // Step 3: Calculate overflow
  let overflowKilling = Math.max(0, newKilling - max);
  newKilling = Math.min(newKilling, max);
  newShock = Math.max(0, Math.min(newShock, max - newKilling));

  return { newShock, newKilling, overflowKilling, convertedShock: excessShock };
}

/**
 * Parses an array of d10 results into ORE sets and waste dice.
 * When isMinion is true, enforces the RAW Width cap of 3:
 *   4× → two 2× pairs
 *   5× → one 3× trio + one 2× pair
 *   6× → two 3× trios (or three 2× pairs, but trios are more useful)
 *   etc.
 */
export function parseORE(results, isMinion = false) {
  const counts = {};
  for (const result of results || []) {
    const n = parseInt(result);
    if (!Number.isInteger(n) || n < 1 || n > 10) continue;
    counts[n] = (counts[n] || 0) + 1;
  }

  const sets = [];
  const waste = [];

  Object.entries(counts).forEach(([height, count]) => {
    const h = parseInt(height);
    let width = parseInt(count) || 0;
    
    if (isMinion) {
      // RAW Ch6: Minion Width Cap — no set wider than 3×
      while (width >= 2) {
        if (width === 4) {
          // 4× must become two pairs (RAW explicit rule)
          sets.push({ width: 2, height: h, text: `2x${h}` });
          sets.push({ width: 2, height: h, text: `2x${h}` });
          width = 0;
        } else if (width >= 3) {
          sets.push({ width: 3, height: h, text: `3x${h}` });
          width -= 3;
        } else if (width === 2) {
          sets.push({ width: 2, height: h, text: `2x${h}` });
          width -= 2;
        }
      }

      for (let i = 0; i < width; i++) waste.push(h);
    } else {
      if (width >= 2) {
        sets.push({ width, height: h, text: `${width}x${h}` });
      } else {
        for (let i = 0; i < width; i++) waste.push(h);
      }
    }
  });

  sets.sort((a, b) => {
    if (b.width !== a.width) return b.width - a.width;
    return b.height - a.height;
  });

  waste.sort((a, b) => b - a);

  return { sets, waste };
}

export function getHitLocation(height) {
  const h = parseInt(height) || 0;

  if (h === 10) return "head";
  if (h >= 7) return "torso";
  if (h >= 5) return "armR";
  if (h >= 3) return "armL";
  if (h === 2) return "legR";
  if (h === 1) return "legL";

  return "unknown";
}

export function getHitLocationLabel(key) {
  const labels = {
    head: "Head (10)",
    torso: "Torso (7-9)",
    armR: "Right Arm (5-6)",
    armL: "Left Arm (3-4)",
    legR: "Right Leg (2)",
    legL: "Left Leg (1)"
  };

  return labels[key] || "Unknown";
}

/**
 * Calculates ORE Initiative based on Set Width, Height, and Modifiers.
 * RAW: Width x 10 + Height. Defenses get +0.9. Weapons get range modifier. Minions get -0.5.
 */
export function calculateInitiative(parsedSets, isDefense = false, isAttack = false, isMinion = false, weaponRange = "0") {
  if (!parsedSets || parsedSets.length === 0) return 0;

  const fastestSet = parsedSets.reduce((max, set) => {
    if (set.width > max.width) return set;
    if (set.width === max.width && set.height > max.height) return set;
    return max;
  });

  let initValue = (fastestSet.width * 10) + fastestSet.height;

  if (isDefense) {
      initValue += 0.90;
  } else if (isAttack) {
      const rangeStr = String(weaponRange).toLowerCase().trim();
      let rangeWeight = 0;
      const rangeMap = { "touch": 1, "point": 1, "blank": 1, "short": 2, "medium": 3, "long": 4, "extreme": 6 };
      const keyword = Object.keys(rangeMap).find(k => rangeStr.includes(k));
      if (keyword) {
          rangeWeight = rangeMap[keyword];
      } else {
          const match = rangeStr.match(/(\d+)/);
          rangeWeight = match ? parseInt(match[1]) : 0;
      }
      initValue += Math.min(rangeWeight * 0.01, 0.89);
  }

  if (isMinion) {
      initValue -= 0.50;
  }

  return initValue;
}


// ==========================================
// PACKAGE A: THREAT / UNWORTHY OPPONENT HELPERS
// ==========================================

/**
 * RAW Ch6 "Out of the Action" (p.117): Checks if an attack set eliminates an unworthy opponent.
 *
 * "Each set that hits with a Width or Height equal to or greater than their Threat rating
 *  takes one of them out of the action."  (Rules Ch6 p.117)
 *
 * ISSUE-007 CITATION CONFIRMED: Width OR Height ≥ Threat removes one fighter.
 * Threat 1-2: Any successful set eliminates (minimum 2×1 has Width 2 ≥ 2, Height 1 ≥ 1).
 * Threat 3:   Needs 3× Width, OR Height 3+ (e.g. 2×3 works, 2×2 does not).
 * Threat 4:   Needs 4× Width, OR Height 4+ (e.g. 2×4 works, 3×3 does not).
 *
 * @param {number} width - Width of the attacking set.
 * @param {number} height - Height of the attacking set.
 * @param {number} threatRating - The group's Threat rating (1-4).
 * @returns {boolean} True if the attack eliminates the minion.
 */
export function checkThreatElimination(width, height, threatRating) {
  const w = parseInt(width) || 0;
  const h = parseInt(height) || 0;
  const t = parseInt(threatRating) || 1;
  return w >= t || h >= t;
}

/**
 * RAW Ch6 "Morale Attacks" (p.118): Calculates how many unworthies flee from a Morale Attack.
 *
 * "A number of unworthies equal to the Morale Attack's rating cut and run…
 *  The only exception is if their Threat is equal to or greater than the Morale Attack
 *  value, in which case none of them flee." (Rules Ch6 p.118 — ties go to the mooks.)
 *
 * ISSUE-008 CITATION CONFIRMED: Threat ≥ MA → full resistance; otherwise exactly MA fighters flee
 * (capped at the current group size).
 *
 * @param {number} moraleAttackValue - The strength of the Morale Attack (1-10).
 * @param {number} threatRating - The group's Threat rating (1-4).
 * @param {number} currentGroupSize - Current number of active fighters.
 * @returns {number} Number of fighters that flee (0 if resisted).
 */
export function calculateMoraleAttackRemoval(moraleAttackValue, threatRating, currentGroupSize) {
  const ma = parseInt(moraleAttackValue) || 0;
  const t = parseInt(threatRating) || 1;
  const gs = parseInt(currentGroupSize) || 0;

  // RAW Ch6 p.118: "The only exception is if their Threat is equal to or greater than the Morale Attack."
  if (t >= ma) return 0;

  return Math.min(ma, gs);
}

/**
 * G3.3: Resolves a die-face height to one or more creature location keys using the
 * creature's pre-built heightLocationMap (constructed in prepareDerivedData).
 *
 * Returns an array because some creatures (e.g. Elephant) map the same height to two
 * different locations depending on the attacker's position. The caller is responsible for
 * adjudicating the correct location when multiple keys are returned — typically the first
 * matching location is used for automated damage and the GM may redirect via triage controls.
 *
 * @param {number} height - The die face result (1-10).
 * @param {Object} heightLocationMap - Derived map from ReignThreatData.prepareDerivedData().
 * @returns {string[]} Array of matching location keys (usually length 1, may be 2 for overlapping heights).
 */
export function getCreatureHitLocation(height, heightLocationMap) {
  const h = parseInt(height);
  if (!heightLocationMap || isNaN(h)) return [];
  return heightLocationMap[h] || [];
}