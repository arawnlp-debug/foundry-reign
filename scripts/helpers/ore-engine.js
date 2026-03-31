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
      while (width >= 2) {
        if (width === 4) {
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

// SECURITY & DRY FACTOR: Centralized Hook Parsing
export function getEffectiveMax(actor, locKey) {
  const baseMax = parseInt(actor?.system?.health?.[locKey]?.max) || 0;
  let max = baseMax;
  
  if (!actor?.items) return max; // Failsafe for unlinked tokens/odd data

  const traitHooks = actor.items.filter(i => ["advantage", "problem"].includes(i.type));
  
  // Explicit whitelist prevents prototype pollution and arbitrary variable mutation
  const ALLOWED_HOOK_PATHS = ["head.max", "torso.max", "armL.max", "armR.max", "legL.max", "legR.max"];

  for (const item of traitHooks) {
    const hook = item?.system?.hook;
    if (!hook || typeof hook !== "string") continue;

    const match = hook.match(/^([a-zA-Z.]+):([+-]\d+)$/);
    if (!match) continue;

    const path = match[1];
    const delta = parseInt(match[2]) || 0;

    // Only apply if it's on the whitelist AND targets the exact location requested
    if (ALLOWED_HOOK_PATHS.includes(path) && path === `${locKey}.max`) {
      max += delta;
    }
  }

  return Math.max(0, max);
}