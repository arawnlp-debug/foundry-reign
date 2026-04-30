// scripts/system/models.js
const { StringField, NumberField, BooleanField, SchemaField, ObjectField, ArrayField } = foundry.data.fields;

import { getEffectiveShieldLocations } from "../helpers/config.js";

// ==========================================
// REUSABLE SCHEMAS
// ==========================================

const makeAttribute = () => new SchemaField({ value: new NumberField({ initial: 2, min: 1, integer: true }) });

const makeSkill = () => new SchemaField({
    value: new NumberField({ initial: 0, min: 0, integer: true }),
    expert: new BooleanField({ initial: false }),
    master: new BooleanField({ initial: false })
});

/**
 * V13+ Architecture Note: 
 * Armor and Max values are strictly computed getters (`effectiveArmor`, `effectiveMax`).
 * They are intentionally excluded from the database schema to prevent data staleness.
 */
const makeHealthLoc = () => new SchemaField({
    shock: new NumberField({ initial: 0, min: 0, integer: true }),
    killing: new NumberField({ initial: 0, min: 0, integer: true })
});

const makeQuality = () => new SchemaField({
    value: new NumberField({ initial: 0, min: 0, integer: true }),
    damage: new NumberField({ initial: 0, min: 0, integer: true }),
    // ISSUE-006: `uses` tracks per-season action-economy expenditure (RAW Ch9 — each Company
    // Action that draws on a Quality marks it as used for that season; it resets at season end).
    // It subtracts from `effective` alongside `damage`. Reset via "Advance Month" in the dashboard.
    uses: new NumberField({ initial: 0, min: 0, integer: true }),
    effective: new NumberField({ initial: 0, min: 0, integer: true }), // runtime-only; recomputed each prepareDerivedData
    notes: new StringField({ initial: "" })
});


// ==========================================
// ACTOR DATA MODELS
// ==========================================

export class ReignCharacterData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            creationMode: new BooleanField({ initial: false }),
            biography: new SchemaField({
                mission: new StringField({ initial: "" }), duty: new StringField({ initial: "" }), craving: new StringField({ initial: "" }),
                problems: new StringField({ initial: "" }), advantages: new StringField({ initial: "" }), history: new StringField({ initial: "" }),
                grudges: new StringField({ initial: "" }), secrets: new StringField({ initial: "" }), company: new StringField({ initial: "" })
            }),
            attributes: new SchemaField({
                body: makeAttribute(), coordination: makeAttribute(), sense: makeAttribute(),
                knowledge: makeAttribute(), command: makeAttribute(), charm: makeAttribute()
            }),
            skills: new SchemaField({
                athletics: makeSkill(), endurance: makeSkill(), fight: makeSkill(), parry: makeSkill(), run: makeSkill(), vigor: makeSkill(),
                climb: makeSkill(), dodge: makeSkill(), ride: makeSkill(), stealth: makeSkill(),
                counterspell: makeSkill(), healing: makeSkill(), languageNative: makeSkill(), lore: makeSkill(), strategy: makeSkill(), tactics: makeSkill(),
                haggle: makeSkill(), inspire: makeSkill(), intimidate: makeSkill(),
                direction: makeSkill(), eerie: makeSkill(), empathy: makeSkill(), hearing: makeSkill(), scrutinize: makeSkill(), sight: makeSkill(), taste_touch_smell: makeSkill(),
                fascinate: makeSkill(), graces: makeSkill(), jest: makeSkill(), lie: makeSkill(), plead: makeSkill()
            }),
            customSkills: new ObjectField({ initial: {} }),
            customMoves: new ObjectField({ initial: {} }),
            health: new SchemaField({
                head: makeHealthLoc(), torso: makeHealthLoc(),
                armL: makeHealthLoc(), armR: makeHealthLoc(),
                legL: makeHealthLoc(), legR: makeHealthLoc()
            }),
            esoterica: new SchemaField({
                sorcery: new NumberField({ initial: 0, min: 0, integer: true }),
                expert: new BooleanField({ initial: false }), master: new BooleanField({ initial: false }),
                // Legacy free-text field kept for backward compat — now used as narrative attunement notes
                attunement: new StringField({ initial: "" }),
                // Structured school data
                schoolName: new StringField({ initial: "" }),
                schoolDomain: new StringField({ initial: "" }),
                schoolMethod: new StringField({ initial: "" }),
                schoolStat: new StringField({ initial: "" }),
                // Attunement status: none | temporary | partial | perfect
                attunementStatus: new StringField({ initial: "none" })
            }),
            xp: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }), spent: new NumberField({ initial: 0, min: 0, integer: true }) }),
            wealth: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }) }),
            
            // ACTIVE EFFECT CATCH-BASINS
            modifiers: new SchemaField({
                globalPool: new NumberField({ initial: 0, integer: true }),
                globalSpeed: new NumberField({ initial: 0, integer: true }), 
                bonusDamage: new NumberField({ initial: 0, integer: true }),
                skills: new ObjectField({ initial: {} }), 
                attributes: new ObjectField({ initial: {} }),
                actionEconomy: new SchemaField({
                    ignoreMultiPenaltySkills: new StringField({ initial: "" }),
                    freeGobbleDice: new NumberField({ initial: 0, integer: true })
                }),
                healthMax: new SchemaField({
                    head: new NumberField({ initial: 0, integer: true }),
                    torso: new NumberField({ initial: 0, integer: true }),
                    armL: new NumberField({ initial: 0, integer: true }),
                    armR: new NumberField({ initial: 0, integer: true }),
                    legL: new NumberField({ initial: 0, integer: true }),
                    legR: new NumberField({ initial: 0, integer: true })
                }),
                naturalArmor: new SchemaField({
                    head: new NumberField({ initial: 0, integer: true }),
                    torso: new NumberField({ initial: 0, integer: true }),
                    armL: new NumberField({ initial: 0, integer: true }),
                    armR: new NumberField({ initial: 0, integer: true }),
                    legL: new NumberField({ initial: 0, integer: true }),
                    legR: new NumberField({ initial: 0, integer: true })
                }),
                hitRedirects: new SchemaField({
                    head: new StringField({ initial: "" }),
                    torso: new StringField({ initial: "" }),
                    armL: new StringField({ initial: "" }),
                    armR: new StringField({ initial: "" }),
                    legL: new StringField({ initial: "" }),
                    legR: new StringField({ initial: "" })
                }),
                combat: new SchemaField({
                    bonusDamageShock: new NumberField({ initial: 0, integer: true }),
                    bonusDamageKilling: new NumberField({ initial: 0, integer: true }),
                    ignoreArmorTarget: new NumberField({ initial: 0, integer: true }),
                    forceHitLocation: new NumberField({ initial: 0, integer: true }),
                    shiftHitLocationUp: new NumberField({ initial: 0, integer: true }),
                    combineGobbleDice: new BooleanField({ initial: false }),
                    crossBlockActive: new BooleanField({ initial: false }),
                    appendManeuvers: new ArrayField(new StringField())
                }),
                systemFlags: new SchemaField({
                    ignoreHeadShock: new BooleanField({ initial: false }),
                    ignoreTorsoPenalties: new BooleanField({ initial: false }),
                    ignoreFatiguePenalties: new BooleanField({ initial: false }),
                    // General-purpose flag: allows swimming in Heavy Armor at a mandatory −4d penalty
                    // instead of auto-failing. RAW use case: Whale Blessed Advantage (Rules Ch4).
                    // GMs may also apply this for supernatural creatures, special circumstances, etc.
                    ignoreHeavyArmorSwim: new BooleanField({ initial: false }),
                    cannotUseTwoHanded: new BooleanField({ initial: false }),
                    immuneToBeauty: new BooleanField({ initial: false })
                })
            })
        };
    }

    /**
     * Dynamically calculates maximum health boxes per location,
     * factoring in Active Effect Basin Modifiers (Thick Headed, etc.).
     */
    get effectiveMax() {
        const maxes = { head: 4, torso: 10, armL: 5, armR: 5, legL: 5, legR: 5 };
        
        for (const loc of Object.keys(maxes)) {
            let max = maxes[loc];
            max += (this.modifiers?.healthMax?.[loc] || 0);
            maxes[loc] = Math.max(1, max);
        }
        return maxes;
    }

    get effectiveArmor() {
        const ar = { head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
        const equippedArmors = this.parent?.items?.filter(i => i.type === "armor" && i.system.equipped) || [];

        for (const loc of Object.keys(ar)) {
            let itemAr = 0;
            for (const armor of equippedArmors) {
                if (armor.system.protectedLocations?.[loc]) {
                    itemAr = Math.max(itemAr, armor.system.ar || 0);
                }
            }
            ar[loc] = itemAr + (this.modifiers?.naturalArmor?.[loc] || 0);
        }
        return ar;
    }

    prepareDerivedData() {
        this.validCustomMoves = {};
        if (this.customMoves) {
            for (const [key, move] of Object.entries(this.customMoves)) {
                let safeMove = foundry.utils.deepClone(move);
                if (safeMove.skillKey && safeMove.skillKey !== "none") {
                    const existsInStatic = this.skills && this.skills[safeMove.skillKey];
                    const existsInCustom = this.customSkills && this.customSkills[safeMove.skillKey];
                    if (!existsInStatic && !existsInCustom) safeMove.skillKey = "none";
                }
                this.validCustomMoves[key] = safeMove;
            }
        }

        const body = this.attributes?.body?.value || 0;
        const coord = this.attributes?.coordination?.value || 0;
        const parry = this.skills?.parry?.value || 0;
        const dodge = this.skills?.dodge?.value || 0;
        
        this.baseParryPool = body + parry;
        this.baseDodgePool = coord + dodge;

        const equippedTower = this.parent?.items?.find(i => i.type === "shield" && i.system.equipped && i.system.shieldSize === "tower");
        this.hasTowerShieldPenalty = !!equippedTower;
        
        // ISSUE-020 FIX: Tower Shield speed penalty was previously mutating this.modifiers.globalSpeed
        // inside prepareDerivedData, which pollutes schema data and causes phantom update events.
        // Instead, expose it as a read-only transient property. Any code needing the penalty
        // should read actor.system.towerShieldSpeedPenalty (−2 when moving, 0 when stationary).
        this.towerShieldSpeedPenalty = (equippedTower && !equippedTower.system.isStationary) ? -2 : 0;
    }
}

export class ReignCompanyData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            biography: new SchemaField({
                goals: new StringField({ initial: "" }), leaders: new StringField({ initial: "" }),
                description: new StringField({ initial: "" }), assets: new StringField({ initial: "" })
            }),
            qualities: new SchemaField({
                might: makeQuality(), treasure: makeQuality(), influence: makeQuality(),
                territory: makeQuality(), sovereignty: makeQuality()
            }),
            pledges: new SchemaField({
                bonus: new NumberField({ initial: 0, min: 0, integer: true }),
                ed: new NumberField({ initial: 0, min: 0, integer: true }),
                md: new NumberField({ initial: 0, min: 0, integer: true })
            }),
            modifiers: new SchemaField({
                qualities: new ObjectField({ initial: {} }),
                globalPool: new NumberField({ initial: 0, integer: true }),
                preventAllDegradation: new BooleanField({ initial: false })
            }),
            // NEW: XP Support for Companies
            xp: new SchemaField({ 
                value: new NumberField({ initial: 0, min: 0, integer: true }), 
                spent: new NumberField({ initial: 0, min: 0, integer: true }) 
            }),

            // D7: Chronicle Ledger — tracks the rise and fall of a Company over time.
            // Each entry records a month number, event type, and description.
            // Appended automatically by advanceMonth; GMs can add manual entries via the dashboard.
            chronicle: new ArrayField(new SchemaField({
                month:     new NumberField({ initial: 1, min: 1, integer: true }),
                type:      new StringField({ initial: "advance" }), // advance | event | damage | conquest
                text:      new StringField({ initial: "" }),
                timestamp: new NumberField({ initial: 0 })          // Date.now() for sort stability
            }))
        };
    }

    prepareDerivedData() {
        // ISSUE-021 NOTE: `effective` is defined in makeQuality() so Foundry V14's schema
        // validation accepts it, but its value on disk is always stale. The authoritative
        // value is computed here every time the document is prepared. Macros and external
        // integrations must read actor.system.qualities[key].effective at runtime, not from
        // raw stored data.
        for (const key of Object.keys(this.qualities)) {
            const q = this.qualities[key];
            q.effective = Math.max(0, q.value - (q.damage || 0) - (q.uses || 0));
        }
    }
}

export class ReignThreatData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            // ── Mob fields (existing) ──────────────────────────────────────────────
            threatLevel:   new NumberField({ initial: 3, min: 0, integer: true }),
            damageFormula: new StringField({ initial: "Width Shock" }),
            magnitude: new SchemaField({
                value: new NumberField({ initial: 5, min: 0, integer: true }),
                max:   new NumberField({ initial: 5, min: 1, integer: true })
            }),
            morale: new SchemaField({
                value: new NumberField({ initial: 5, min: 0, integer: true }),
                max:   new NumberField({ initial: 5, min: 1, integer: true })
            }),
            description:   new StringField({ initial: "" }),
            parentCompany: new StringField({ initial: "" }),

            // ── G3.1: Creature Mode ────────────────────────────────────────────────
            // When true: individual creature with wound boxes; false: mob (default).
            creatureMode: new BooleanField({ initial: false }),

            // Custom hit locations. Each entry: key, display name, roll heights (1-10),
            // wound box count, armor rating, and current damage state.
            customLocations: new ArrayField(new SchemaField({
                key:         new StringField({ initial: "" }),
                name:        new StringField({ initial: "" }),
                rollHeights: new ArrayField(new NumberField({ integer: true, min: 1, max: 10 })),
                woundBoxes:  new NumberField({ initial: 5, min: 1, integer: true }),
                ar:          new NumberField({ initial: 0, min: 0, integer: true }),
                shock:       new NumberField({ initial: 0, min: 0, integer: true }),
                killing:     new NumberField({ initial: 0, min: 0, integer: true })
            })),

            // Creature attributes — Body, Coordination, Sense (animals have no Charm/Knowledge/Command)
            creatureAttributes: new SchemaField({
                body:         new NumberField({ initial: 3, min: 0, integer: true }),
                coordination: new NumberField({ initial: 2, min: 0, integer: true }),
                sense:        new NumberField({ initial: 2, min: 0, integer: true })
            }),

            // Creature skills as a flexible key/value map. Values are numbers (dice pool).
            // Master Dice are stored as negative numbers (−1 = 1 MD), per convention.
            creatureSkills: new ObjectField({ initial: {} }),

            // Bestiary display fields
            trainability: new StringField({ initial: "" }),
            tricks:       new NumberField({ initial: 0, min: 0, integer: true }),
            movement:     new StringField({ initial: "" }),
            specialRules: new StringField({ initial: "" }),

            // Defined attacks — each is a rollable action with a pool and damage formula.
            creatureAttacks: new ArrayField(new SchemaField({
                name:      new StringField({ initial: "Attack" }),
                attribute: new StringField({ initial: "body" }),    // "body"|"coordination"|"sense"
                skill:     new StringField({ initial: "" }),         // key from creatureSkills
                damage:    new StringField({ initial: "Width Shock" }),
                notes:     new StringField({ initial: "" }),         // "Two per round", "Slow 1" etc.
                isSlow:    new NumberField({ initial: 0, min: 0, integer: true }) // Slow N
            })),

            // G4: Per-combat special mechanics flags
            creatureFlags: new SchemaField({
                // G4.1 Big Cat: free Gobble Dice per round (value 10)
                freeGobbleDicePerRound: new NumberField({ initial: 0, min: 0, integer: true }),
                // G4.2 Elephant: Morale Attack once per combat
                moraleAttackOnce:       new BooleanField({ initial: false }),
                // G4.3 Boa: whether the creature has a constrict ability
                hasConstrict:           new BooleanField({ initial: false }),
                constrictActive:        new BooleanField({ initial: false }),
                constrictTargetId:      new StringField({ initial: "" }),
                // G4.4 Rhino: whether the creature uses charge accumulation (NOT all 'run' creatures)
                hasChargeAccumulation:  new BooleanField({ initial: false }),
                chargeRunWidest:        new NumberField({ initial: 0, min: 0, integer: true }),
                // G4.5 Venom
                venomPotency:           new NumberField({ initial: 0, min: 0, integer: true }),
                venomType:              new StringField({ initial: "" })
            })
        };
    }

    prepareDerivedData() {
        // Build a height→location-key lookup for fast hit resolution in the damage pipeline.
        // Example: { 1: ["leftForeLeg"], 2: ["rightForeLeg"], 9: ["head","back"], 10: ["head","back"] }
        // Multiple keys per height occur on creatures like the Elephant where positions overlap.
        if (this.creatureMode && this.customLocations?.length > 0) {
            this.heightLocationMap = {};
            for (const loc of this.customLocations) {
                for (const h of (loc.rollHeights || [])) {
                    if (!this.heightLocationMap[h]) this.heightLocationMap[h] = [];
                    this.heightLocationMap[h].push(loc.key);
                }
            }
        } else {
            this.heightLocationMap = {};
        }
    }
}


// ==========================================
// ITEM DATA MODELS
// ==========================================

export class ReignWeaponData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            damage: new StringField({ initial: "Width Shock" }),
            pool: new StringField({ initial: "" }),
            range: new StringField({ initial: "" }),
            equipped: new BooleanField({ initial: false }),
            equippedTimestamp: new NumberField({ initial: 0 }), 
            qualities: new SchemaField({
                armorPiercing: new NumberField({ initial: 0, integer: true }),
                slow: new NumberField({ initial: 0, integer: true }),
                twoHanded: new BooleanField({ initial: false }),
                massive: new BooleanField({ initial: false }),
                unarmed: new BooleanField({ initial: false }),
                area: new NumberField({ initial: 0, integer: true })
            }),
            notes: new StringField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) 
        };
    }
}

export class ReignArmorData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            armorWeight: new StringField({ initial: "light", choices: ["light", "medium", "heavy"] }),
            ar: new NumberField({ initial: 1, min: 0, integer: true }), 
            equipped: new BooleanField({ initial: false }),
            equippedTimestamp: new NumberField({ initial: 0 }),
            protectedLocations: new SchemaField({
                head: new BooleanField({ initial: false }),
                torso: new BooleanField({ initial: false }),
                armL: new BooleanField({ initial: false }),
                armR: new BooleanField({ initial: false }),
                legL: new BooleanField({ initial: false }),
                legR: new BooleanField({ initial: false })
            }),
            notes: new StringField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) 
        };
    }

    // V14 FIX: Transformed from mutating derived data to a native getter
    get derivedWeight() {
        const locs = this.protectedLocations || {};
        const covered = Object.values(locs).filter(v => v).length;
        const coversAllLimbs = locs.armL && locs.armR && locs.legL && locs.legR;
        
        if (coversAllLimbs && this.ar >= 2) return "heavy";
        if (covered <= 2 && this.ar <= 2) return "light";
        return "medium";
    }
}

export class ReignShieldData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            shieldSize: new StringField({ initial: "small", choices: ["small", "large", "tower"] }),
            material: new StringField({ initial: "wood", choices: ["wood", "metal"] }),
            shieldArm: new StringField({ initial: "armL", choices: ["armL", "armR"] }),
            parryBonus: new NumberField({ initial: 1, integer: true }),
            coverAR: new NumberField({ initial: 1, integer: true }), 
            equipped: new BooleanField({ initial: false }),
            equippedTimestamp: new NumberField({ initial: 0 }),
            isStationary: new BooleanField({ initial: true }), 
            protectedLocations: new SchemaField({
                head: new BooleanField({ initial: false }),
                torso: new BooleanField({ initial: false }),
                armL: new BooleanField({ initial: false }),
                armR: new BooleanField({ initial: false }),
                legL: new BooleanField({ initial: false }),
                legR: new BooleanField({ initial: false })
            }),
            notes: new StringField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true })
        };
    }

    get effectiveLocations() {
        if (this.shieldSize === "tower") {
            const locs = { head: false, torso: false, armL: false, armR: false, legL: false, legR: false };
            const carryingArm = this.shieldArm || "armL";
            const carryingLeg = carryingArm === "armL" ? "legL" : "legR";

            if (this.isStationary) {
                locs[carryingArm] = true;
                locs[carryingLeg] = true;
                const manualChoices = Object.keys(this.protectedLocations || {}).filter(k => 
                    this.protectedLocations[k] && k !== carryingArm && k !== carryingLeg
                );
                manualChoices.slice(0, 2).forEach(k => locs[k] = true);
            } else {
                locs[carryingArm] = true;
            }
            return locs;
        } else {
            return getEffectiveShieldLocations(this);
        }
    }
}

export class ReignMagicData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            path: new StringField({ initial: "" }),
            associatedSkill: new StringField({ initial: "" }),
            rank: new NumberField({ initial: 1, min: 1, max: 5, integer: true }),
            pool: new StringField({ initial: "" }), 
            page: new StringField({ initial: "" }),
            isPassive: new BooleanField({ initial: false }),
            effect: new StringField({ initial: "" })
        };
    }
}

export class ReignSpellData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            school: new StringField({ initial: "" }),
            intensity: new NumberField({ initial: 1, min: 1, max: 10, integer: true }),
            castingTime: new NumberField({ initial: 0, min: 0, integer: true }),
            slow: new NumberField({ initial: 0, min: 0, integer: true }),        // Slow rating (fire every Slow+1 rounds)
            duration: new StringField({ initial: "" }),                           // e.g. "Width hours", "Instant", "Permanent"
            castingStat: new StringField({ initial: "knowledge", choices: ["body", "coordination", "sense", "knowledge", "command", "charm"] }), 
            damage: new StringField({ initial: "" }), 
            pool: new StringField({ initial: "" }),
            page: new StringField({ initial: "" }),
            effect: new StringField({ initial: "" }),
            // Casting properties
            attunementRequired: new BooleanField({ initial: false }),            // Requires attunement to cast
            isAttunementSpell: new BooleanField({ initial: false }),             // This spell IS an attunement spell
            dodgeable: new BooleanField({ initial: false }),                     // Can be dodged if an attack spell
            parriable: new BooleanField({ initial: false }),                     // Can be parried if an attack spell
            armorBlocks: new BooleanField({ initial: false })                    // Armor AR applies against this spell
        };
    }
}

export class ReignGearData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            quantity: new NumberField({ initial: 1, min: 0, integer: true }), 
            notes: new StringField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) 
        };
    }
}

export class ReignAdvantageData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            cost: new NumberField({ initial: 1, integer: true }), 
            effect: new StringField({ initial: "" })
        };
    }
}

export class ReignProblemData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            bonus: new NumberField({ initial: 1, integer: true }), 
            effect: new StringField({ initial: "" })
        };
    }
}

export class ReignAssetData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            description: new StringField({ initial: "" }),
            cost: new NumberField({ initial: 10, integer: true, min: 0 }) 
        };
    }
}