// scripts/generators/charactermancer.js
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { skillAttrMap } from "../helpers/config.js";

export class ReignCharactermancer extends HandlebarsApplicationMixin(ApplicationV2) {
static DEFAULT_OPTIONS = {
    id: "reign-charactermancer",
    classes: ["reign", "charactermancer", "app-v2"],
    tag: "form",
    window: { 
      title: "Reign: Forge Your Legend", 
      resizable: true, 
      width: 950, 
      height: 800,
      /* Added the correct sub-containers for scrolling */
      scrollable: [".cm-results-left", ".cm-biography", ".cm-editor"]
    },
    position: { width: 950, height: 800 },
    actions: {
      selectPath: this._onSelectPath,
      adjustStat: this._onAdjustStat,
      toggleUpgrade: this._onToggleUpgrade,
      addCustomSkill: this._onAddCustomSkill,
      removeCustomSkill: this._onRemoveCustomSkill,
      changeBudget: this._onChangeBudget,
      removeItem: this._onRemoveItem,
      finishCharacter: this._onFinishCharacter,
      rollTheBones: this._onRollTheBones,
      selectWasteChart: this._onSelectWasteChart,
      acceptFate: this._onAcceptFate
    }
  };

  static PARTS = {
    main: { template: "systems/reign/templates/apps/charactermancer.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.document;
    this.creationPath = null; 
    
    // THE DRAFT PATTERN
    this.draftCharacter = {
      name: "Unnamed Legend",
      pointsMax: 85, 
      pointsSpent: 0,
      attributes: { body: 1, coordination: 1, sense: 1, knowledge: 1, command: 1, charm: 1 }, 
      skills: {},
      sorcery: { value: 0, expert: false, master: false },
      customSkills: {}, 
      wealth: 0,
      advantages: [],
      problems: [],
      martialPaths: [],
      esoterica: [],
      spells: []
    };

    // ONE-ROLL STATE
    this.oneRollState = {
      rolled: false,
      dice: [],
      sets: [],
      waste: [],
      wasteChoices: {},
      biography: []
    };
    this.oneRollTable = null;

    for (const skill of Object.keys(skillAttrMap)) {
      this.draftCharacter.skills[skill] = {
        value: 0,
        expert: false,
        master: skill === "languageNative" 
      };
    }
  }

  _onRender(context, options) {
      super._onRender(context, options);
      const dropZone = this.element.querySelector(".cm-drop-zone");
      if (dropZone) {
          dropZone.addEventListener("dragover", (ev) => {
              ev.preventDefault();
              dropZone.style.background = "rgba(1, 87, 155, 0.1)"; 
              dropZone.style.borderColor = "#01579b";
          });
          dropZone.addEventListener("dragleave", (ev) => {
              ev.preventDefault();
              dropZone.style.background = "rgba(0,0,0,0.02)"; 
              dropZone.style.borderColor = "#ccc";
          });
          dropZone.addEventListener("drop", async (ev) => {
              ev.preventDefault();
              dropZone.style.background = "rgba(0,0,0,0.02)";
              dropZone.style.borderColor = "#ccc";
              await this._handleItemDrop(ev);
          });
      }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;
    context.draft = this.draftCharacter;

    this.draftCharacter.pointsMax = game.settings.get("reign", "campaignBudget") || 85;
    context.costs = { attribute: 5, skill: 1, ed: 1, md: 6 };
    
    this._calculatePoints();
    context.pointsRemaining = this.draftCharacter.pointsMax - this.draftCharacter.pointsSpent;
    
    context.pathSelected = !!this.creationPath;
    context.isOneRoll = this.creationPath === "oneroll";
    context.isPointBuy = this.creationPath === "pointbuy";

    // --- Format Gains Helper for the UI ---
    const formatGains = (stage) => {
        const gains = [];
        if (stage.attributes) Object.entries(stage.attributes).forEach(([k, v]) => gains.push(`+${v} ${k.toUpperCase()}`));
        if (stage.skills) Object.entries(stage.skills).forEach(([k, v]) => gains.push(`+${v} ${k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`));
        if (stage.customSkills) stage.customSkills.forEach(cs => gains.push(`+${cs.value || 1} ${cs.name}`));
        if (stage.wealth) gains.push(`+${stage.wealth} Wealth`);
        if (stage.advantages) stage.advantages.forEach(a => gains.push(`${a.name}`));
        if (stage.martialPaths) stage.martialPaths.forEach(m => gains.push(`${m.name}`));
        if (stage.esoterica) stage.esoterica.forEach(e => gains.push(`${e.name}`));
        if (stage.spells) stage.spells.forEach(s => gains.push(`${s.name}`));
        if (stage.special) gains.push(`Special: ${stage.special}`);
        return gains.join(" | ");
    };

    if (context.isOneRoll) {
        const tablesSetting = game.settings.get("reign", "oneRollTables") || `systems/${game.system.id}/data/oneroll-default.json`;
        const paths = tablesSetting.split(",").map(p => p.trim()).filter(p => p);
        
        context.availableTables = paths.map(path => {
            const filename = path.split('/').pop().replace('.json', '').replace(/-/g, ' ').replace('oneroll', 'one roll');
            const label = filename.replace(/\b\w/g, l => l.toUpperCase()); 
            return { path: path, label: label };
        });

        context.oneRoll = this.oneRollState;
        if (this.oneRollState.rolled && this.oneRollTable) {
            context.oneRollDisplay = {
                sets: this.oneRollState.sets.map(s => {
                    const pathData = this.oneRollTable.sets[s.height];
                    const pathName = pathData?.path || "Unknown Path";
                    
                    let aggregatedGains = [];
                    for (let w = 2; w <= s.width; w++) {
                        const stage = pathData?.stages[w.toString()];
                        if (stage) {
                            const fg = formatGains(stage);
                            if (fg) aggregatedGains.push(`(W${w}) ` + fg);
                        }
                    }
                    return { 
                        label: `${s.width}x${s.height}: ${pathName}`,
                        details: aggregatedGains 
                    };
                }),
                waste: this.oneRollState.waste.map(w => {
                    const selectedChart = this.oneRollState.wasteChoices[w];
                    let details = "";
                    if (selectedChart) {
                        const stage = this.oneRollTable.waste[selectedChart]?.results[w];
                        if (stage) details = formatGains(stage);
                    }
                    return {
                        die: w,
                        selected: selectedChart,
                        details: details,
                        options: ["A", "B", "C"].map(c => ({
                            chart: c,
                            label: this.oneRollTable.waste[c]?.results[w]?.label || "Unknown",
                            active: selectedChart === c
                        }))
                    };
                })
            };
        }
    }

    context.skillGroups = {};
    for (const [sKey, aKey] of Object.entries(skillAttrMap)) {
      if (!context.skillGroups[aKey]) context.skillGroups[aKey] = [];
      let label = sKey.replace(/_/g, " ");
      if (sKey === "languageNative") label = "Language (Native)";
      if (sKey === "taste_touch_smell") label = "Taste/Touch/Smell";
      context.skillGroups[aKey].push({
        key: sKey, label: label, data: this.draftCharacter.skills[sKey],
        isNative: sKey === "languageNative", isCustom: false, type: "skill"
      });
    }

    for (const [cKey, cSkill] of Object.entries(this.draftCharacter.customSkills)) {
        const aKey = cSkill.attribute;
        if (!context.skillGroups[aKey]) context.skillGroups[aKey] = [];
        context.skillGroups[aKey].push({
            key: cKey, label: cSkill.name, data: cSkill,
            isNative: false, isCustom: true, type: "customSkill"
        });
    }

    for (const group in context.skillGroups) {
        context.skillGroups[group].sort((a, b) => a.label.localeCompare(b.label));
    }
    
    return context;
  }

  _calculatePoints() {
    let spent = 0;
    const costAttr = 5, costSkill = 1, costED = 1, costMD = 6;

    for (const val of Object.values(this.draftCharacter.attributes)) {
      if (val > 1) spent += ((val - 1) * costAttr);
    }

    for (const [key, skill] of Object.entries(this.draftCharacter.skills)) {
      spent += (skill.value * costSkill); 
      let isNativeLang = (key === "languageNative");
      if (skill.expert && !isNativeLang) spent += costED; 
      if (skill.master && !isNativeLang) spent += costMD; 
    }

    spent += (this.draftCharacter.sorcery.value * costSkill);
    if (this.draftCharacter.sorcery.expert) spent += costED;
    if (this.draftCharacter.sorcery.master) spent += costMD;

    for (const skill of Object.values(this.draftCharacter.customSkills)) {
        spent += (skill.value * costSkill);
        if (skill.expert) spent += costED;
        if (skill.master) spent += costMD;
    }

    spent += this.draftCharacter.wealth;
    for (const item of this.draftCharacter.advantages) spent += (Number(item.system.cost) || 0);
    for (const item of this.draftCharacter.martialPaths) spent += (Number(item.system.rank) || 1);
    for (const item of this.draftCharacter.esoterica) spent += (Number(item.system.rank) || 1);

    const isAttuned = this.draftCharacter.advantages.some(a => /attuned/i.test(a.name));
    let attunedSpellClaimed = false;

    const spellsByIntensity = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    
    for (const spell of this.draftCharacter.spells) {
        if (isAttuned && !attunedSpellClaimed && /permanent attunement/i.test(spell.name)) {
            attunedSpellClaimed = true;
            continue; 
        }
        const intensity = Math.clamp(Number(spell.system.intensity) || 1, 1, 6);
        spellsByIntensity[intensity].push(spell);
    }

    for (let i = 1; i <= 6; i++) {
        const count = spellsByIntensity[i].length;
        if (count === 0) continue;

        if (i === 1) {
            spent += Math.ceil(count / 2);
        } else {
            const pairs = Math.floor(count / 2);
            const remainder = count % 2;
            spent += (pairs * i) + (remainder * (i - 1));
        }
    }

    this.draftCharacter.pointsSpent = spent;
  }

  async _loadOneRollTable(path) {
      if (this.oneRollTable && this.oneRollTable._path === path) return this.oneRollTable;
      
      if (path.startsWith("http://") || path.startsWith("https://")) {
          ui.notifications.error("Security Risk: Custom tables must be stored locally in your Foundry data folder.");
          return null;
      }

      try {
          const response = await fetch(path);
          if (response.ok) {
              this.oneRollTable = await response.json();
              this.oneRollTable._path = path;
              return this.oneRollTable;
          } else {
              ui.notifications.error(`Could not find table at: ${path}`);
          }
      } catch (e) {
          console.error("Failed to load One-Roll table", e);
          ui.notifications.error(`Error parsing JSON at: ${path}`);
      }
      return null;
  }

  // NEW HELPER: Searches World Items first, then Compendiums
  async _findItem(name, type) {
      const lowerName = name.toLowerCase();
      
      // 1. Search Sidebar Items
      let found = game.items.find(i => i.type === type && i.name.toLowerCase() === lowerName);
      if (found) return found;

      // 2. Search Compendiums
      for (const pack of game.packs.values()) {
          if (pack.metadata.type === "Item") {
              // Ensure we are getting the type fields in the index
              const index = await pack.getIndex({fields: ["type", "name"]});
              const match = index.find(i => i.type === type && i.name.toLowerCase() === lowerName);
              if (match) {
                  found = await pack.getDocument(match._id);
                  return found;
              }
          }
      }
      return null;
  }

  // UPDATED: Now asynchronous to allow compendium searching
  async _applyOneRollSets(table) {
      this.draftCharacter.attributes = { body: 2, coordination: 2, sense: 2, knowledge: 2, command: 2, charm: 2 };
      for (const skill of Object.keys(skillAttrMap)) {
          this.draftCharacter.skills[skill] = { value: 0, expert: false, master: skill === "languageNative" };
      }
      this.draftCharacter.customSkills = {};
      this.draftCharacter.sorcery = { value: 0, expert: false, master: false };
      this.draftCharacter.wealth = 0;
      this.draftCharacter.advantages = [];
      this.draftCharacter.problems = [];
      this.draftCharacter.martialPaths = [];
      this.draftCharacter.esoterica = [];
      this.draftCharacter.spells = [];
      this.oneRollState.biography = [];

      for (const set of this.oneRollState.sets) {
          const heightData = table.sets[set.height];
          if (!heightData) continue;
          for (let w = 2; w <= set.width; w++) {
              const stage = heightData.stages[w.toString()];
              if (stage) await this._applyStageGains(stage);
          }
      }

      for (const wDie of this.oneRollState.waste) {
          const choice = this.oneRollState.wasteChoices[wDie];
          if (choice) {
              const wasteData = table.waste[choice]?.results[wDie];
              if (wasteData) await this._applyStageGains(wasteData);
          }
      }

      this._calculatePoints();
  }

  // UPDATED: Now asynchronous to pull real items
  async _applyStageGains(stage) {
      if (stage.description) this.oneRollState.biography.push(`**${stage.label}**: ${stage.description}`);

      if (stage.attributes) {
          for (const [attr, val] of Object.entries(stage.attributes)) {
              if (this.draftCharacter.attributes[attr] !== undefined) {
                  this.draftCharacter.attributes[attr] = Math.min(5, this.draftCharacter.attributes[attr] + val);
              }
          }
      }

      const inferAttribute = (name, currentStage) => {
          const lower = name.toLowerCase();

          if (/athletics|endurance|fight|parry|run|vigor/.test(lower)) return "body";
          
          if (lower.includes("perform")) {
              if (currentStage?.attributes?.command) return "command";
              if (currentStage?.attributes?.coordination) return "coordination";
              return "command"; 
          }

          if (/climb|dodge|ride|stealth|weapon/.test(lower)) return "coordination";
          if (/direction|eerie|empathy|hearing|scrutinize|sight|taste|touch|smell/.test(lower)) return "sense";
          if (/counterspell|healing|language|lore|strategy|student|tactics/.test(lower)) return "knowledge";
          if (/haggle|inspire|intimidate/.test(lower)) return "command";
          if (/fascinate|graces|jest|lie|plead/.test(lower)) return "charm";

          return "knowledge"; 
      };

      const addSkillBonus = (skillKey, val, nameOverride = null) => {
          const lowerKey = skillKey.toLowerCase();
          const isForcedCustom = /perform|weapon|student|languageother/.test(lowerKey);

          if (!isForcedCustom && this.draftCharacter.skills[skillKey]) {
              this.draftCharacter.skills[skillKey].value = Math.min(5, this.draftCharacter.skills[skillKey].value + val);
          } else if (skillKey === "sorcery") {
              this.draftCharacter.sorcery.value = Math.min(5, this.draftCharacter.sorcery.value + val);
          } else {
              let name = nameOverride || skillKey.replace(/_/g, ': ').replace(/\b\w/g, l => l.toUpperCase());
              if (lowerKey === "languageother") name = "Language: Other";
              
              let existingKey = Object.keys(this.draftCharacter.customSkills).find(k => this.draftCharacter.customSkills[k].name.toLowerCase() === name.toLowerCase());
              
              if (existingKey) {
                  this.draftCharacter.customSkills[existingKey].value = Math.min(5, this.draftCharacter.customSkills[existingKey].value + val);
              } else {
                  const key = `custom_${foundry.utils.randomID(6)}`;
                  this.draftCharacter.customSkills[key] = {
                      name: name,
                      value: Math.min(5, val),
                      expert: false,
                      master: false,
                      attribute: inferAttribute(name, stage)
                  };
              }
          }
      };

      if (stage.skills) {
          for (const [skill, val] of Object.entries(stage.skills)) {
              addSkillBonus(skill, val);
          }
      }

      if (stage.customSkills) {
          for (const cs of stage.customSkills) {
              addSkillBonus(cs.name, cs.value || 1, cs.name);
          }
      }

      if (stage.wealth) {
          this.draftCharacter.wealth += stage.wealth;
      }

      // NEW: Search for real items before defaulting to a placeholder
      const listMap = { advantages: "advantage", problems: "problem", martialPaths: "technique", esoterica: "discipline", spells: "spell" };
      for (const [list, type] of Object.entries(listMap)) {
          if (stage[list]) {
              for (const item of stage[list]) {
                  const foundItem = await this._findItem(item.name, type);
                  
                  if (foundItem) {
                      const itemData = foundItem.toObject();
                      itemData._draftId = foundry.utils.randomID();
                      // Keep JSON system overrides if they exist (like cost overrides)
                      if (item.system) itemData.system = foundry.utils.mergeObject(itemData.system, item.system);
                      this.draftCharacter[list].push(itemData);
                  } else {
                      // Fallback to placeholder
                      this.draftCharacter[list].push({
                          _draftId: foundry.utils.randomID(),
                          name: `[PLACEHOLDER] ${item.name}`,
                          type: type,
                          system: item.system || {}
                      });
                  }
              }
          }
      }

      if (stage.special) {
           this.oneRollState.biography.push(`*(Special)*: ${stage.special}`);
           const specLower = stage.special.toLowerCase();

           if (specLower.includes("lose the normal master die")) {
               if(this.draftCharacter.skills.languageNative) this.draftCharacter.skills.languageNative.master = false;
           }

           const checkAndUpgrade = (keyword, isMaster) => {
               if (specLower.includes(keyword)) {
                   const targetSkill = Object.keys(this.draftCharacter.skills).find(k => k.toLowerCase().includes(keyword)) 
                       || (keyword === "sorcery" ? "sorcery" : null);
                       
                   if (targetSkill && targetSkill !== "sorcery") {
                       if (isMaster) { this.draftCharacter.skills[targetSkill].master = true; this.draftCharacter.skills[targetSkill].expert = false; }
                       else this.draftCharacter.skills[targetSkill].expert = true;
                   } else if (targetSkill === "sorcery") {
                       if (isMaster) { this.draftCharacter.sorcery.master = true; this.draftCharacter.sorcery.expert = false; }
                       else this.draftCharacter.sorcery.expert = true;
                   } else {
                       const cKey = Object.keys(this.draftCharacter.customSkills).find(k => this.draftCharacter.customSkills[k].name.toLowerCase().includes(keyword));
                       if (cKey) {
                           if (isMaster) { this.draftCharacter.customSkills[cKey].master = true; this.draftCharacter.customSkills[cKey].expert = false; }
                           else this.draftCharacter.customSkills[cKey].expert = true;
                       }
                   }
               }
           };

           const isMasterUpgrade = specLower.includes("to a master die") || specLower.includes("into a master die");
           const isExpertUpgrade = (specLower.includes("expert die") || specLower.includes("an expert")) && !isMasterUpgrade;

           if (isExpertUpgrade || isMasterUpgrade) {
               ["stealth", "climb", "perform", "fascinate", "haggle", "survival", "fight", "sword", "lore", "sorcery", "intimidate", "ride", "dodge", "parry"].forEach(kw => {
                   checkAndUpgrade(kw, isMasterUpgrade);
               });
               
               if (specLower.includes("change your expert die into a master die") || specLower.includes("change one expert die to a master die")) {
                   let upgraded = false;
                   for (let s of Object.values(this.draftCharacter.skills)) {
                       if (s.expert && !upgraded) { s.expert = false; s.master = true; upgraded = true; }
                   }
                   if (!upgraded && this.draftCharacter.sorcery.expert) {
                       this.draftCharacter.sorcery.expert = false; this.draftCharacter.sorcery.master = true; upgraded = true;
                   }
                   if (!upgraded) {
                       for (let s of Object.values(this.draftCharacter.customSkills)) {
                           if (s.expert && !upgraded) { s.expert = false; s.master = true; upgraded = true; }
                       }
                   }
               }
           }
      }
  }

  static async _onRollTheBones(event, target) {
      event.preventDefault();
      
      const selectElement = this.element.querySelector("#oneroll-table-select");
      const selectedPath = selectElement ? selectElement.value : `systems/${game.system.id}/data/oneroll-default.json`;

      const table = await this._loadOneRollTable(selectedPath);
      if (!table) return;

      const roll = new Roll("11d10");
      await roll.evaluate();
      const dice = roll.terms[0].results.map(r => r.result).sort((a,b) => a - b);

      const counts = {};
      dice.forEach(d => counts[d] = (counts[d] || 0) + 1);

      const sets = [];
      const waste = [];

      for (let i = 1; i <= 10; i++) {
          const count = counts[i] || 0;
          if (count >= 2) {
              sets.push({ height: i, width: Math.min(count, 5) });
          } else if (count === 1) {
              waste.push(i);
          }
      }

      this.oneRollState.rolled = true;
      this.oneRollState.dice = dice;
      this.oneRollState.sets = sets;
      this.oneRollState.waste = waste;
      this.oneRollState.wasteChoices = {};
      this.oneRollState.biography = [];

      // Await is now required because of the async compendium search
      await this._applyOneRollSets(table);
      this.render(true);
  }

  static async _onSelectWasteChart(event, target) {
      event.preventDefault();
      const die = target.dataset.die;
      const chart = target.dataset.chart;

      this.oneRollState.wasteChoices[die] = chart;
      
      const selectElement = this.element.querySelector("#oneroll-table-select");
      const selectedPath = selectElement ? selectElement.value : `systems/${game.system.id}/data/oneroll-default.json`;

      const table = await this._loadOneRollTable(selectedPath);
      // Await is now required because of the async compendium search
      if(table) await this._applyOneRollSets(table);
      this.render(true);
  }

  static async _onAcceptFate(event, target) {
       event.preventDefault();
       const bioText = this.oneRollState.biography.join("\n\n");
       this.oneRollState.finalBio = bioText;
       
       await ReignCharactermancer._onFinishCharacter.call(this, event, target);
  }

  async _handleItemDrop(event) {
      let data;
      try { data = TextEditor.getDragEventData(event); } 
      catch(err) { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
      
      if (data.type !== "Item") return;
      const item = await Item.implementation.fromDropData(data);
      if (!item) return;

      const itemData = item.toObject();
      itemData._draftId = foundry.utils.randomID();
      
      let listName = "";
      if (item.type === "advantage") listName = "advantages";
      else if (item.type === "problem") listName = "problems";
      else if (item.type === "technique") listName = "martialPaths";
      else if (item.type === "discipline") listName = "esoterica";
      else if (item.type === "spell") {
          listName = "spells";
          if ((Number(item.system.intensity) || 1) > 6) return ui.notifications.error("Starting characters cannot know spells above Sixth Intensity.");
      }
      else { return ui.notifications.warn("You cannot purchase this item type with starting points."); }

      if (listName === "problems" && this.draftCharacter.problems.length >= 3) return ui.notifications.error("Maximum 3 Problems allowed.");

      this.draftCharacter[listName].push(itemData);
      const prevSpent = this.draftCharacter.pointsSpent;
      this._calculatePoints();

      if (this.draftCharacter.pointsSpent > this.draftCharacter.pointsMax && listName !== "problems") {
          this.draftCharacter[listName].pop();
          this._calculatePoints();
          return ui.notifications.error("Not enough points to purchase this item.");
      }

      this.render(true);
  }

  static async _onRemoveItem(event, target) {
      event.preventDefault();
      const list = target.dataset.list;
      const draftId = target.dataset.id;
      if (!this.draftCharacter[list]) return;
      this.draftCharacter[list] = this.draftCharacter[list].filter(i => i._draftId !== draftId);
      this._calculatePoints();
      this.render(true);
  }

  static async _onSelectPath(event, target) {
    this.creationPath = target.dataset.path;
    if (this.creationPath === "manual") {
      await this.actor.update({ "system.creationMode": false });
      this.actor.sheet.render(true);
      this.close();
    } else if (this.creationPath === "oneroll") {
      this.draftCharacter.attributes = { body: 2, coordination: 2, sense: 2, knowledge: 2, command: 2, charm: 2 };
      this.render(true);
    } else {
      this.render(true); 
    }
  }

  static async _onChangeBudget(event, target) {
      event.preventDefault();
      this.draftCharacter.pointsMax = parseInt(target.value) || 85;
      this.render(true);
  }

  static async _onAdjustStat(event, target) {
    event.preventDefault();
    const type = target.dataset.type, key = target.dataset.key, isIncrease = target.dataset.dir === "up";
    let currentVal;
    if (type === "skill") currentVal = this.draftCharacter.skills[key].value;
    else if (type === "customSkill") currentVal = this.draftCharacter.customSkills[key].value;
    else if (type === "sorcery") currentVal = this.draftCharacter.sorcery.value;
    else if (type === "wealth") currentVal = this.draftCharacter.wealth;
    else currentVal = this.draftCharacter.attributes[key];

    const maxVal = 5, minVal = type === "attribute" ? 1 : 0;

    if (isIncrease) {
        if (currentVal >= maxVal) return; 
        if (type === "skill") this.draftCharacter.skills[key].value++;
        else if (type === "customSkill") this.draftCharacter.customSkills[key].value++;
        else if (type === "sorcery") this.draftCharacter.sorcery.value++;
        else if (type === "wealth") this.draftCharacter.wealth++;
        else this.draftCharacter.attributes[key]++;
        this._calculatePoints();
        if (this.draftCharacter.pointsSpent > this.draftCharacter.pointsMax) {
            if (type === "skill") this.draftCharacter.skills[key].value--;
            else if (type === "customSkill") this.draftCharacter.customSkills[key].value--;
            else if (type === "sorcery") this.draftCharacter.sorcery.value--;
            else if (type === "wealth") this.draftCharacter.wealth--;
            else this.draftCharacter.attributes[key]--;
            this._calculatePoints();
            return ui.notifications.error("Not enough points!");
        }
    } else {
        if (currentVal <= minVal) return;
        if (type === "skill") this.draftCharacter.skills[key].value--;
        else if (type === "customSkill") this.draftCharacter.customSkills[key].value--;
        else if (type === "sorcery") this.draftCharacter.sorcery.value--;
        else if (type === "wealth") this.draftCharacter.wealth--;
        else this.draftCharacter.attributes[key]--;
        this._calculatePoints();
    }
    this.render(true);
  }

  static async _onToggleUpgrade(event, target) {
      event.preventDefault();
      const type = target.dataset.type, key = target.dataset.key, upgradeType = target.dataset.upgrade; 
      let skill;
      if (type === "customSkill") skill = this.draftCharacter.customSkills[key];
      else if (type === "sorcery") skill = this.draftCharacter.sorcery;
      else skill = this.draftCharacter.skills[key];

      if (!skill) return;
      if (key === "languageNative") return ui.notifications.warn("Native Language MD is locked.");

      const prevExp = skill.expert, prevMas = skill.master;
      if (upgradeType === "expert") { skill.expert = !skill.expert; if (skill.expert) skill.master = false; } 
      else if (upgradeType === "master") { skill.master = !skill.master; if (skill.master) skill.expert = false; }

      this._calculatePoints();
      if (this.draftCharacter.pointsSpent > this.draftCharacter.pointsMax) {
          skill.expert = prevExp; skill.master = prevMas;
          this._calculatePoints();
          return ui.notifications.error("Not enough points!");
      }
      this.render(true);
  }

  static async _onAddCustomSkill(event, target) {
      event.preventDefault();
      const attr = target.dataset.attr; 
      const input = this.element.querySelector(`#new-skill-${attr}`);
      const name = input ? input.value.trim() : "";
      if (!name) return ui.notifications.warn("Enter a name.");
      const key = `custom_${foundry.utils.randomID(6)}`;
      this.draftCharacter.customSkills[key] = { name: name, value: 0, expert: false, master: false, attribute: attr };
      this.render(true);
  }

  static async _onRemoveCustomSkill(event, target) {
      event.preventDefault();
      const key = target.dataset.key;
      if (!key || !this.draftCharacter.customSkills[key]) return;
      delete this.draftCharacter.customSkills[key];
      this._calculatePoints();
      this.render(true);
  }

  static async _onFinishCharacter(event, target) {
      event.preventDefault();
      const updates = {
          "system.creationMode": false, 
          "system.wealth.value": this.draftCharacter.wealth,
          "system.attributes.body.value": this.draftCharacter.attributes.body,
          "system.attributes.coordination.value": this.draftCharacter.attributes.coordination,
          "system.attributes.sense.value": this.draftCharacter.attributes.sense,
          "system.attributes.knowledge.value": this.draftCharacter.attributes.knowledge,
          "system.attributes.command.value": this.draftCharacter.attributes.command,
          "system.attributes.charm.value": this.draftCharacter.attributes.charm,
          "system.esoterica.sorcery": this.draftCharacter.sorcery.value,
          "system.esoterica.expert": this.draftCharacter.sorcery.expert,
          "system.esoterica.master": this.draftCharacter.sorcery.master
      };

      if (this.creationPath === "oneroll" && this.oneRollState.finalBio) {
          updates["system.biography.history"] = this.oneRollState.finalBio;
      }

      for (const [key, skill] of Object.entries(this.draftCharacter.skills)) {
          updates[`system.skills.${key}.value`] = skill.value;
          updates[`system.skills.${key}.expert`] = skill.expert;
          updates[`system.skills.${key}.master`] = skill.master;
      }

      for (const [key, skill] of Object.entries(this.draftCharacter.customSkills)) {
          updates[`system.customSkills.${key}`] = {
              customLabel: skill.name, 
              value: skill.value, expert: skill.expert, master: skill.master,
              attribute: skill.attribute, isCombat: false
          };
      }

      await this.actor.update(updates);

      const itemsToCreate = [];
      const itemLists = ["advantages", "problems", "martialPaths", "esoterica", "spells"];
      for (const list of itemLists) {
          for (const item of this.draftCharacter[list]) {
              const cleanItem = foundry.utils.deepClone(item);
              delete cleanItem._draftId; delete cleanItem._id;
              itemsToCreate.push(cleanItem);
          }
      }
      if (itemsToCreate.length > 0) await this.actor.createEmbeddedDocuments("Item", itemsToCreate);

      ui.notifications.success(`${this.actor.name} forged!`);
      this.actor.sheet.render(true);
      this.close();
  }
}