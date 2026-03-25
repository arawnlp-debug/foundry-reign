// scripts/helpers/ore-engine.js

export function computeLocationDamage(currentShock, currentKilling, incomingShock, incomingKilling, max) {
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
  results.forEach(n => counts[n] = (counts[n] || 0) + 1);
  const sets = [], waste = [];
  Object.entries(counts).forEach(([height, width]) => {
    let h = parseInt(height);
    
    if (isMinion) {
      while (width >= 2) {
        if (width === 4) { sets.push({ width: 2, height: h, text: `2x${h}` }); sets.push({ width: 2, height: h, text: `2x${h}` }); width = 0; }
        else if (width >= 3) { sets.push({ width: 3, height: h, text: `3x${h}` }); width -= 3; }
        else if (width === 2) { sets.push({ width: 2, height: h, text: `2x${h}` }); width -= 2; }
      }
      for(let i=0; i<width; i++) waste.push(h);
    } else {
      if (width >= 2) {
        sets.push({ width, height: h, text: `${width}x${h}` });
      } else {
        for(let i=0; i<width; i++) waste.push(h);
      }
    }
  });
  sets.sort((a, b) => b.height - a.height);
  waste.sort((a, b) => b - a);
  return { sets, waste };
}

export function getHitLocation(height) {
  if (height === 10) return "head";
  if (height >= 7) return "torso";
  if (height >= 5) return "armR";
  if (height >= 3) return "armL";
  if (height === 2) return "legR";
  if (height === 1) return "legL";
  return "unknown";
}

export function getHitLocationLabel(key) {
  const labels = { head: "Head (10)", torso: "Torso (7-9)", armR: "Right Arm (5-6)", armL: "Left Arm (3-4)", legR: "Right Leg (2)", legL: "Left Leg (1)" };
  return labels[key] || "Unknown";
}

// SECURITY & DRY FACTOR: Centralized Hook Parsing
export function getEffectiveMax(actor, locKey) {
  let max = actor.system.health[locKey]?.max || 0;
  
  if (!actor.items) return max; // Failsafe for unlinked tokens/odd data

  const traitHooks = actor.items.filter(i => ["advantage", "problem"].includes(i.type));
  
  // Explicit whitelist prevents prototype pollution and arbitrary variable mutation
  const ALLOWED_HOOK_PATHS = ["head.max", "torso.max", "armL.max", "armR.max", "legL.max", "legR.max"];

  for (const item of traitHooks) {
    const hook = item.system.hook;
    if (!hook) continue;

    const match = hook.match(/^([a-zA-Z.]+):([+-]\d+)$/);
    if (match) {
      const path = match[1];
      // Only apply if it's on the whitelist AND targets the exact location requested
      if (ALLOWED_HOOK_PATHS.includes(path) && path === `${locKey}.max`) {
        max += parseInt(match[2]);
      }
    }
  }
  return max;
}