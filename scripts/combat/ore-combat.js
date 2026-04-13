// scripts/combat/ore-combat.js

/**
 * Custom Combat class for the Reign ORE system.
 * Handles dual-phase sorting with specific Reign tiebreakers:
 * 1. Declaration Phase: Sense (Asc), GMCs before PCs, Sight (Asc).
 * 2. Resolution Phase: Sorted by Initiative (Width.Height, Descending).
 */
export class ReignCombat extends Combat {

  /**
   * Overrides the standard combatant sorting logic.
   * @param {Combatant} a
   * @param {Combatant} b
   * @protected
   */
  _sortCombatants(a, b) {
    // Safely retrieve the combat document to avoid 'this' context loss
    const combat = a.combat || b.combat;
    const phase = combat?.getFlag("reign", "phase") || "declaration";

    // --- PHASE 1: DECLARATION (Commitment Order) ---
    // Rule: Characters with less awareness/priority declare first.
    if (phase === "declaration") {
      // 1. Primary: Sense (Lowest declares first)
      const senseA = a.actor?.system?.attributes?.sense?.value || 0;
      const senseB = b.actor?.system?.attributes?.sense?.value || 0;
      if (senseA !== senseB) return senseA - senseB;

      // 2. Secondary: GMC vs PC (GMCs must declare before PCs)
      // hasPlayerOwner is false (0) for GMCs and true (1) for PCs
      const isPcA = a.actor?.hasPlayerOwner ? 1 : 0;
      const isPcB = b.actor?.hasPlayerOwner ? 1 : 0;
      if (isPcA !== isPcB) return isPcA - isPcB;

      // 3. Tertiary: Sight Skill (Lowest Sight declares first)
      const sightA = a.actor?.system?.skills?.sight?.value || 0;
      const sightB = b.actor?.system?.skills?.sight?.value || 0;
      if (sightA !== sightB) return sightA - sightB;
    } 
    
    // --- PHASE 2: RESOLUTION (Speed Order) ---
    else {
      // Rule: Higher Width (speed) goes first. If Widths are tied, higher Height goes first.
      // Initiative is stored as a decimal (Width.Height), e.g., 2x10 is 2.10
      const initA = Number.isNumeric(a.initiative) ? a.initiative : -999;
      const initB = Number.isNumeric(b.initiative) ? b.initiative : -999;

      // Primary Sort: Initiative Descending
      if (initA !== initB) return initB - initA;

      // Tie-breaker: Falling back to Sense (Descending) in resolution
      const resSenseA = a.actor?.system?.attributes?.sense?.value || 0;
      const resSenseB = b.actor?.system?.attributes?.sense?.value || 0;
      if (resSenseA !== resSenseB) return resSenseB - resSenseA;
    }

    // Final Fallback: Alphabetical then ID
    const nameSort = a.name.localeCompare(b.name);
    if (nameSort !== 0) return nameSort;
    return a.id.localeCompare(b.id);
  }

  /**
   * Ensures that the tracker re-sorts whenever turns are set up 
   * (e.g., when the Phase flag is toggled in reign.mjs).
   */
  async setupTurns() {
    return super.setupTurns();
  }

  /**
   * Round advancement logic.
   * Resets initiative and declaration flags for all participants.
   */
  async nextRound() {
    const updates = this.combatants.map(c => ({
      _id: c.id,
      initiative: null,
      "flags.reign.declared": false
    }));
    
    await this.updateEmbeddedDocuments("Combatant", updates);
    await this.setFlag("reign", "phase", "declaration");
    
    return super.nextRound();
  }
}