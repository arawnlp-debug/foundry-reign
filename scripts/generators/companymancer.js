// scripts/generators/companymancer.js
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { parseORE } from "../helpers/ore-engine.js";
import { ScrollPreserveMixin } from "../helpers/scroll-mixin.js";

const COMPANY_TABLES = {
    sets: {
        1: {
            2: { text: "Gossipy Old Folks (+1 Influence, Asset: Culture of Shame and Gossip)", q: {influence: 1}, items: [{name: "Culture of Shame and Gossip", type: "asset", system: {description: "+2 bonus to Might + Sovereignty to police the populace."}}] },
            3: { text: "Paid Network of Informants (+1 Influence)", q: {influence: 1} },
            4: { text: "Elite Secret Agents (+1 Influence)", q: {influence: 1} },
            5: { text: "Traitor (Asset: Mole)", items: [{name: "Mole", type: "asset", system: {description: "+3d bonus to one Influence roll against a specific Company (One-time use)."}}] }
        },
        2: {
            2: { text: "Access to Bored, Jaded Sybarites (+1 Influence, Asset: Cultural Tradition)", q: {influence: 1}, items: [{name: "Cultural Tradition", type: "asset", system: {description: "+2d bonus to Territory + Treasure to raise Sovereignty."}}] },
            3: { text: "Open Ears for the Riff-Raff (+1 Influence)", q: {influence: 1} },
            4: { text: "Good Roads, Fast Horses (+1 Influence)", q: {influence: 1} },
            5: { text: "Elaborately Titled Diplomatic Corps (Asset: Eloquent Diplomats)", items: [{name: "Eloquent Diplomats", type: "asset", system: {description: "+2d to Influence + Treasure to alter opinions."}}] }
        },
        3: {
            2: { text: "Fertile Foothills (+1 Treasure, Asset: Wealth of the Mountains)", q: {treasure: 1}, items: [{name: "Wealth of the Mountains (Possession)", type: "asset", system: {description: "Provides leaders with valuable trade curios."}}] },
            3: { text: "Bountiful Peaks (+1 Treasure)", q: {treasure: 1} },
            4: { text: "Towering Crag (+1 Treasure)", q: {treasure: 1} },
            5: { text: "Implacable Sky Walls (Asset: Defensible Terrain)", items: [{name: "Defensible Terrain", type: "asset", system: {description: "+2 to Might + Territory to defend lands from external approach."}}] }
        },
        4: {
            2: { text: "Pleasant Copses (+1 Treasure, Asset: Shipshape Navy)", q: {treasure: 1}, items: [{name: "Shipshape Navy", type: "asset", system: {description: "+2d to Might rolls at sea or via amphibious assault."}}] },
            3: { text: "Extensive Woods (+1 Treasure)", q: {treasure: 1} },
            4: { text: "Vast Tracts of Timber (+1 Treasure)", q: {treasure: 1} },
            5: { text: "Deep Dark Forests (Asset: Magic Resistant)", items: [{name: "Magic Resistant", type: "asset", system: {description: "+2d to Might rolls when the enemy relies heavily on sorcery."}}] }
        },
        5: {
            2: { text: "Storied Warrior Family (+1 Might, Asset: Defiant Tradition)", q: {might: 1}, items: [{name: "Defiant Tradition", type: "asset", system: {description: "+2d to all Sovereignty rolls against outside attacks."}}] },
            3: { text: "Traditional Soldier Caste (+1 Might)", q: {might: 1} },
            4: { text: "Code of Death Before Dishonor (+1 Might)", q: {might: 1} },
            5: { text: "Elite Soldier-Sorcerers (Asset: Irregular Forces)", items: [{name: "Irregular Forces", type: "asset", system: {description: "+2d to Might + Influence for Unconventional Warfare exfiltration."}}] }
        },
        6: {
            2: { text: "Broad Appreciation for Tactics (+1 Might, Asset: Rules of Plunder)", q: {might: 1}, items: [{name: "Rules of Plunder", type: "asset", system: {description: "On first Might + Treasure attack per month, change 1 regular die to an Expert Die (ED)."}}] },
            3: { text: "Wide Reading of a Classical Strategic Treatise (+1 Might)", q: {might: 1} },
            4: { text: "Established War College (+1 Might)", q: {might: 1} },
            5: { text: "Peerless Tactical Secrets (Asset: Keen)", items: [{name: "Keen", type: "asset", system: {description: "+2d to all Might rolls against a Company with lower permanent Might."}}] }
        },
        7: {
            2: { text: "Nice Bit in the River Valley (+1 Territory, Asset: Patriotism)", q: {territory: 1}, items: [{name: "Patriotism", type: "asset", system: {description: "+2d to Might + Sovereignty to police unconventional attacks."}}] },
            3: { text: "Pleasant Fruiting Trees (+1 Territory)", q: {territory: 1} },
            4: { text: "We Call It 'The Grain Sea' (+1 Territory)", q: {territory: 1} },
            5: { text: "Bounteous Harvest (Asset: Fortune Smiles)", items: [{name: "Fortune Smiles", type: "asset", system: {description: "+3d to the next roll incorporating Territory (One-time use)."}}] }
        },
        8: {
            2: { text: "High-Quality Smithing (+1 Territory, Asset: Foundries, Smiths and Armorers)", q: {territory: 1}, items: [{name: "Foundries, Smiths and Armorers", type: "asset", system: {description: "+2d to Sovereignty + Territory to increase Might."}}] },
            3: { text: "Tidy Bureaucracy (+1 Territory)", q: {territory: 1} },
            4: { text: "Artistic Renaissance (+1 Territory)", q: {territory: 1} },
            5: { text: "Oppression (Asset: Permanent Underclass)", items: [{name: "Permanent Underclass", type: "asset", system: {description: "Once per year, permanently decrease Sovereignty by 1 to permanently raise Treasure by 1."}}] }
        },
        9: {
            2: { text: "Expectation of Piety (+1 Sovereignty, Asset: Classic Enemy)", q: {sovereignty: 1}, items: [{name: "Classic Enemy", type: "asset", system: {description: "+3d to the first Might + Territory defense against a designated rival."}}] },
            3: { text: "Culture of Worship (+1 Sovereignty)", q: {sovereignty: 1} },
            4: { text: "Church Acknowledges the Crown (+1 Sovereignty)", q: {sovereignty: 1} },
            5: { text: "High Holy Days (Asset: Predictable Bounty)", items: [{name: "Predictable Bounty", type: "asset", system: {description: "For one designated month per year: +1 Territory, +1 Treasure, -1 Might."}}] }
        },
        10: {
            2: { text: "Recent Happiness (Asset: Payoff)", items: [{name: "Payoff", type: "asset", system: {description: "Temporary +2 Treasure this month, +2 Territory next month (One-time use)."}}] },
            3: { text: "Just Courts (+1 Sovereignty)", q: {sovereignty: 1} },
            4: { text: "Justified Pride (Asset: Epic History)", items: [{name: "Epic History", type: "asset", system: {description: "+2d to Sovereignty + Treasure to temporarily increase Influence."}}] },
            5: { text: "Culture of Obedience (+1 Sovereignty)", q: {sovereignty: 1} }
        }
    },
    waste: {
        1: { text: "Oracle (+1 Influence)", q: {influence: 1} },
        2: { text: "Advantageous Marriage (Asset: Entangling Alliance)", items: [{name: "Entangling Alliance", type: "asset", system: {description: "+2 Influence when dealing with one specific ally."}}] },
        3: { text: "Loan Operation (+1 Treasure)", q: {treasure: 1} },
        4: { text: "Exotic Crop (Asset: Unbalanced Economy)", items: [{name: "Unbalanced Economy", type: "asset", system: {description: "+2 Treasure for 6 months, -1 Treasure for the other 6 months."}}] },
        5: { text: "Murderous Thugs (Asset: Sinister Operatives)", items: [{name: "Sinister Operatives", type: "asset", system: {description: "+2d to Might + Influence for Unconventional Warfare."}}] },
        6: { text: "Underappreciated Officer (Asset: Unexpected Deliverance)", items: [{name: "Unexpected Deliverance", type: "asset", system: {description: "+3d to one attack or defense roll (One-time use)."}}] },
        7: { text: "Splendid Roads to Market (+1 Territory)", q: {territory: 1} },
        8: { text: "Coast (+1 Territory)", q: {territory: 1} },
        9: { text: "Charismatic Elite (Asset: Mass Appeal)", items: [{name: "Mass Appeal", type: "asset", system: {description: "Reduce Difficulty by 1 when rolling to raise Sovereignty or Might."}}] },
        10: { text: "Culture of Inquisitiveness (Asset: Small Horizon)", items: [{name: "Small Horizon", type: "asset", system: {description: "Reduce Difficulty by 1 when rolling Sovereignty + Treasure to improve Influence."}}] }
    }
};

export class ReignCompanymancer extends ScrollPreserveMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: "reign-companymancer",
    classes: ["reign", "companymancer", "app-v2"], // Fully isolated CSS context
    tag: "form",
    window: { 
      title: "Reign: Forge Your Faction", 
      resizable: true, 
      width: 900, 
      height: 700
    },
    position: { width: 900, height: 700 },
    // V14 Pattern: Map actions to the class prototype directly so 'this' binding works perfectly
    actions: {
      selectPath: this.prototype._onSelectPath,
      rollTheBones: this.prototype._onRollTheBones,
      finishCompany: this.prototype._onFinishCompany
    }
  };

  static PARTS = {
    main: { template: "systems/reign/templates/apps/companymancer.hbs" }
  };

  constructor(options={}) {
      super(options);
      this.actor = options.document;
      this.pathSelected = false;
      this.diceRolled = false;
      this.companyDice = 15; // Default to user preference

      this.draftCompany = {
          qualities: { might: 0, treasure: 0, influence: 0, territory: 0, sovereignty: 1 },
          items: [], history: [], waste: []
      };
  }

  async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.actor = this.actor;
      context.pathSelected = this.pathSelected;
      context.diceRolled = this.diceRolled;
      context.draftCompany = this.draftCompany;
      context.companyDice = this.companyDice;
      return context;
  }

  async _onSelectPath(event, target) {
      event.preventDefault();
      const path = target.dataset.path;

      if (path === "manual") {
          return this._onFinishCompany(event, target);
      }

      // Explicitly extract the input value before initiating the roll
      if (path === "oneroll") {
          const input = this.element.querySelector("#company-dice-input");
          if (input) this.companyDice = parseInt(input.value, 10) || 15;
      }

      this.pathSelected = path;
      if (path === "oneroll") await this._onRollTheBones(event, target);
      else this.render();
  }

  async _onRollTheBones(event, target) {
      event.preventDefault();
      
      // If triggered from the workspace Re-Roll button, update the dice count
      const rerollInput = this.element.querySelector("#company-dice-reroll-input");
      if (rerollInput) {
          this.companyDice = parseInt(rerollInput.value, 10) || 15;
      }
      
      this.draftCompany.history = [];
      this.draftCompany.waste = [];
      this.draftCompany.items = [];
      this.draftCompany.qualities = { might: 0, treasure: 0, influence: 0, territory: 0, sovereignty: 1 }; // Reset with baseline Sov 1

      let allResults = [];
      let diceToRoll = this.companyDice;

      // Recursive Cap Re-roll (No sets > 5 width per RAW)
      while (diceToRoll > 0) {
          let r = new Roll(`${diceToRoll}d10`);
          await r.evaluate();
          allResults.push(...r.dice[0].results.map(x => x.result));
          
          let counts = {};
          allResults.forEach(x => counts[x] = (counts[x] || 0) + 1);
          
          let excess = 0;
          allResults = [];
          for (let i = 1; i <= 10; i++) {
              if (counts[i]) {
                  if (counts[i] > 5) {
                      excess += (counts[i] - 5);
                      for(let j = 0; j < 5; j++) allResults.push(i);
                  } else {
                      for(let j = 0; j < counts[i]; j++) allResults.push(i);
                  }
              }
          }
          diceToRoll = excess;
      }

      const parsed = parseORE(allResults);

      // Apply Company Sets (Ladder Cascade)
      for (let set of parsed.sets) {
          for (let w = 2; w <= set.width; w++) {
              let entry = COMPANY_TABLES.sets[set.height]?.[w];
              if (entry) {
                  this.draftCompany.history.push(`${w}x${set.height}: ${entry.text}`);
                  if (entry.q) {
                      for (let [k,v] of Object.entries(entry.q)) {
                          this.draftCompany.qualities[k] += v;
                      }
                  }
                  if (entry.items) {
                      for (let i of entry.items) {
                          this.draftCompany.items.push(foundry.utils.deepClone(i));
                      }
                  }
              }
          }
      }
      
      // Apply Company Waste
      for (let die of parsed.waste) {
          let dieVal = die.value !== undefined ? die.value : die; // SAFE EXTRACTION
          let entry = COMPANY_TABLES.waste[dieVal];
          if (entry) {
              this.draftCompany.waste.push(`${dieVal}: ${entry.text}`);
              if (entry.q) {
                  for (let [k,v] of Object.entries(entry.q)) {
                      this.draftCompany.qualities[k] += v;
                  }
              }
              if (entry.items) {
                  for (let i of entry.items) {
                      this.draftCompany.items.push(foundry.utils.deepClone(i));
                  }
              }
          }
      }
      
      // Hard Cap at 6
      for (let k of Object.keys(this.draftCompany.qualities)) {
          if (this.draftCompany.qualities[k] > 6) this.draftCompany.qualities[k] = 6;
      }

      this.diceRolled = true;
      this.render();
  }

  async _onFinishCompany(event, target) {
      event.preventDefault();

      if (this.pathSelected === "manual") {
          await this.actor.update({"system.creationMode": false});
          this.close();
          return;
      }

      let updates = {};
      for (let [k,v] of Object.entries(this.draftCompany.qualities)) {
          updates[`system.qualities.${k}.value`] = v;
      }
      
      let bioText = "";
      if (this.draftCompany.history.length > 0) {
          bioText += `<h3>Company History (Sets)</h3><ul>${this.draftCompany.history.map(h => `<li>${h}</li>`).join("")}</ul>`;
      }
      if (this.draftCompany.waste.length > 0) {
          bioText += `<h3>Singular Events (Waste)</h3><ul>${this.draftCompany.waste.map(w => `<li>${w}</li>`).join("")}</ul>`;
      }
      if (bioText) updates['system.biography.description'] = bioText;

      await this.actor.update(updates);

      if (this.draftCompany.items.length > 0) {
          await this.actor.createEmbeddedDocuments("Item", this.draftCompany.items, { keepId: false });
      }

      ui.notifications.success(`${this.actor.name} forged!`);
      await this.actor.update({"system.creationMode": false});
      this.close();
  }
}