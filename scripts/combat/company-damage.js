// scripts/combat/company-damage.js

/**
 * Applies damage directly to a specific Quality of a targeted Company actor.
 * V14 UPDATE: Includes RAW Raiding/Annexation "Steal" rules & Sovereignty Collapse.
 * RAW FIX 1: Width does not determine damage amount. Successful sets deal exactly 1 damage.
 * RAW FIX 2: Steal mechanics (Raiding/Annexation) only trigger when temporary damage OVERFLOWS, causing permanent loss.
 */
export async function applyCompanyDamageToTarget(width, qualityKeyRaw, attackerActor = null) {
  const targets = Array.from(game.user.targets);
  if (targets.length === 0) return ui.notifications.warn("Please target a Company token first!");

  const qualityKey = String(qualityKeyRaw || "").toLowerCase();

  for (let target of targets) {
    const targetActor = target.actor; 
    if (!targetActor || targetActor.type !== "company") continue;

    if (!qualityKey || !targetActor.system?.qualities?.[qualityKey]) {
      ui.notifications.warn(`Invalid company quality: ${qualityKeyRaw}`);
      continue;
    }

    const safeTargetName = foundry.utils.escapeHTML(targetActor.name);
    const qualityData = targetActor.system.qualities[qualityKey];
    
    let currentValue = qualityData.value || 0;
    const currentDmg = qualityData.damage || 0;

    const updates = {};
    let stealMessage = "";

    // RAW: Company damage is always exactly 1 point per successful attack.
    let newDmg = currentDmg + 1; 
    let newValue = currentValue;
    let overflow = 0;

    // Standard Combat Attrition (Temporary Damage & Overflow)
    // RAW: "These losses are temporary until the Quality hits zero. The attack that knocks it to zero makes the loss permanent."
    if (newDmg > currentValue) {
      overflow = newDmg - currentValue;
      newValue = Math.max(0, currentValue - overflow); 
      newDmg = newValue; // CRITICAL FIX: Cap temporary damage to the newly reduced permanent maximum

      // RAW: The Steal Mechanic (Raiding & Annexation)
      // This ONLY triggers when you actually break the defenses and cause permanent loss
      if (attackerActor && attackerActor.type === "company" && (qualityKey === "treasure" || qualityKey === "territory")) {
          let attackerVal = attackerActor.system.qualities[qualityKey].value;
          
          if (attackerVal < currentValue) { // Compare against the original size before this hit
              // Attacker gets +1 permanent if target was strictly larger
              await attackerActor.update({ [`system.qualities.${qualityKey}.value`]: attackerVal + 1 });
              stealMessage = `<p class="reign-text-success reign-mb-small"><strong>Spoils of War:</strong> ${attackerActor.name} broke the enemy's defenses and permanently seized 1 <strong>${qualityKey.toUpperCase()}</strong>!</p>`;
          } else {
              stealMessage = `<p class="reign-text-muted reign-mb-small"><strong>Trivial Conquest:</strong> ${attackerActor.name} broke the enemy's defenses, permanently destroying 1 <strong>${qualityKey.toUpperCase()}</strong>, but was too large to assimilate the spoils.</p>`;
          }
      }
    }

    updates[`system.qualities.${qualityKey}.damage`] = newDmg;
    if (overflow > 0) {
      updates[`system.qualities.${qualityKey}.value`] = newValue;
    }

    // RAW FIX: Snapshot target size BEFORE applying the update so conquest
    // reward tiers compare against the company's pre-damage strength.
    let zeroCount = 0;
    let criticalZero = false;
    let targetSize = 0; 
    
    for (const [k, q] of Object.entries(targetActor.system.qualities)) {
        // Use the pre-update permanent value for size calculation
        targetSize += q.value;
        
        // For zero-checking, use newValue for the quality we're about to damage
        let valToCheck = (k === qualityKey) ? newValue : q.value;
        if (valToCheck === 0) {
            zeroCount++;
            if (k === "territory" || k === "sovereignty") criticalZero = true;
        }
    }

    await targetActor.update(updates);

    if (overflow > 0) {
      ui.notifications.warn(`Dealt 1 damage to ${safeTargetName}. Defenses broke! Permanent ${qualityKey.toUpperCase()} reduced to ${newValue}!`);
    } else {
      ui.notifications.info(`Dealt 1 temporary damage to ${safeTargetName}'s ${qualityKey.toUpperCase()} (Effective: ${Math.max(0, newValue - newDmg - (qualityData.uses || 0))}).`);
    }

    if (stealMessage !== "") {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
            content: `<div class="reign-chat-card">${stealMessage}</div>`
        });
    }
    
    // RAW: A Company collapses under two conditions:
    //   1. Sovereignty drops to exactly 0 → immediate dissolution.
    //   2. Total Conquest: an enemy reduces TWO Qualities to 0 in a single month,
    //      provided at least one of those is Sovereignty or Territory.
    // Implementation note: condition 2 checks current zeroed-quality state after each
    // damage application. It does not track *when* each quality hit zero, so two qualities
    // zeroed across different months could theoretically trigger this. Tracking per-month
    // timing would require stamping each quality with a "zeroed-in-month" flag on the actor.
    let isCollapse = (zeroCount >= 2 && criticalZero) || (qualityKey === "sovereignty" && newValue === 0);
    
    if (isCollapse) {
        let rewardHtml = "";
        
        if (attackerActor && attackerActor.type === "company") {
            let attackerSize = 0;
            for (const q of Object.values(attackerActor.system.qualities)) {
                attackerSize += q.value;
            }
            
            rewardHtml = `<p><strong>Enemy Size:</strong> ${targetSize} | <strong>Your Size:</strong> ${attackerSize}</p><hr>`;
            
            // RAW conquest rewards (compared against conqueror's total Qualities):
            //   ≤ half the winner's total → no reward.
            //   > half but < equal → permanently raise any ONE Quality by 1.
            //   ≥ equal → permanently raise any TWO Qualities by 1 each.
            if (targetSize <= (attackerSize / 2)) {
                rewardHtml += `<p class="reign-text-muted">The enemy was half your size or less — you gain <strong>no permanent Quality increases</strong>.</p>`;
            } else if (targetSize < attackerSize) {
                rewardHtml += `<p class="reign-text-success">The enemy was smaller but more than half your size — you may <strong>permanently increase any ONE Quality by 1</strong>.</p>`;
            } else {
                rewardHtml += `<p class="reign-text-info">The enemy was equal to or larger than your Company — you may <strong>permanently increase any TWO Qualities by 1</strong> each.</p>`;
            }
        } else {
            rewardHtml = `
              <p><strong>Enemy Size (Total Qualities): ${targetSize}</strong></p>
              <p class="reign-text-small reign-text-muted">Compare to the conqueror's Total Size:<br>
              • <em>Half or less:</em> No reward.<br>
              • <em>More than half, less than equal:</em> +1 to any one Quality.<br>
              • <em>Equal or larger:</em> +1 to any two Qualities.</p>
            `;
        }

        const content = `
          <div class="reign-chat-card reign-card-critical">
            <h3 class="reign-text-critical reign-header-fancy"><i class="fas fa-chess-king"></i> TOTAL CONQUEST!</h3>
            <p><strong>${safeTargetName}</strong> has been completely overwhelmed and defeated!</p>
            ${rewardHtml}
          </div>
        `;
        
        await ChatMessage.create({ 
            speaker: attackerActor ? ChatMessage.getSpeaker({ actor: attackerActor }) : null,
            content: content 
        });
    }
  }
}