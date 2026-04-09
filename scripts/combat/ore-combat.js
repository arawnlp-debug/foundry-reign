// scripts/combat/ore-combat.js

export class ReignCombat extends Combat {
  /**
   * Override the default sorting to handle Reign's two phases: Declaration & Resolution
   * @override
   */
  _sortCombatants(a, b) {
    // FIX: Safely retrieve the combat document from the combatants to avoid 'this' context loss in Array.sort
    const combat = a.combat || b.combat;
    const phase = combat?.getFlag("reign", "phase") || "declaration";

    if (phase === "declaration") {
      // DECLARATION PHASE: Lowest Sense declares first.
      const senseA = a.actor?.system?.attributes?.sense?.value || 0;
      const senseB = b.actor?.system?.attributes?.sense?.value || 0;
      
      if (senseA !== senseB) return senseA - senseB; // Ascending order
    } else {
      // RESOLUTION PHASE: Highest Width/Height resolves first.
      const initA = Number.isNumeric(a.initiative) ? a.initiative : -9999;
      const initB = Number.isNumeric(b.initiative) ? b.initiative : -9999;
      
      if (initA !== initB) return initB - initA; // Descending order
    }

    // Fallback: Alphabetical
    return a.name.localeCompare(b.name);
  }
}