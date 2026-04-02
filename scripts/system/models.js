// scripts/system/models.js
const { StringField, NumberField, BooleanField, SchemaField, ObjectField, HTMLField } = foundry.data.fields;

// SPRINT 1: Import the single source of truth for shield logic
import { getEffectiveShieldLocations } from "../helpers/config.js";

// --- REUSABLE SCHEMAS ---
const makeAttribute = () => new SchemaField({ value: new NumberField({ initial: 2, min: 1, integer: true }) });
const makeSkill = () => new SchemaField({
    value: new NumberField({ initial: 0, min: 0, integer: true }),
    expert: new BooleanField({ initial: false }),
    master: new BooleanField({ initial: false })
});
const makeHealthLoc = (maxHealth) => new SchemaField({
    shock: new NumberField({ initial: 0, min: 0, integer: true }),
    killing: new NumberField({ initial: 0, min: 0, integer: true }),
    max: new NumberField({ initial: maxHealth, min: 1, integer: true }),
    armor: new NumberField({ initial: 0, min: 0, integer: true })
});
const makeQuality = () => new SchemaField({
    permanent: new NumberField({ initial: 0, min: 0, integer: true }),
    current: new NumberField({ initial: 0, min: 0, integer: true }),
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
                problems: new StringField({ initial: "" }), advantages: new StringField({ initial: "" }), history: new HTMLField({ initial: "" }),
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
                head: makeHealthLoc(4), torso: makeHealthLoc(10),
                armL: makeHealthLoc(5), armR: makeHealthLoc(5),
                legL: makeHealthLoc(5), legR: makeHealthLoc(5)
            }),
            esoterica: new SchemaField({
                sorcery: new NumberField({ initial: 0, min: 0, integer: true }),
                expert: new BooleanField({ initial: false }), master: new BooleanField({ initial: false }),
                attunement: new HTMLField({ initial: "" })
            }),
            xp: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }), spent: new NumberField({ initial: 0, min: 0, integer: true }) }),
            wealth: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }) }),
            
            // PHASE 2.4: Explicit modifier paths to accept Active Effects
            modifiers: new SchemaField({
                pool: new NumberField({ initial: 0, integer: true }),     // Intercepted by reign-roller.js
                armor: new NumberField({ initial: 0, integer: true }),    // For magic spells that grant global AR
                speed: new NumberField({ initial: 0, integer: true })     // For encumbrance movement restrictions
            })
        };
    }

    /**
     * PHASE 1 (PATCHED FOR V13+): Safe Data Centralization
     * We cannot mutate or delete source data on a TypeDataModel.
     */
    prepareDerivedData() {
        // Safe Sanitization: Create a derived list of valid moves
        this.validCustomMoves = {};
        if (this.customMoves) {
            for (const [key, move] of Object.entries(this.customMoves)) {
                let safeMove = foundry.utils.deepClone(move);
                if (safeMove.skillKey && safeMove.skillKey !== "none") {
                    const existsInStatic = this.skills && this.skills[safeMove.skillKey];
                    const existsInCustom = this.customSkills && this.customSkills[safeMove.skillKey];
                    if (!existsInStatic && !existsInCustom) {
                        safeMove.skillKey = "none"; // Sever the orphaned link safely in derived state
                    }
                }
                this.validCustomMoves[key] = safeMove;
            }
        }

        // Base Action Pools
        const body = this.attributes?.body?.value || 0;
        const coord = this.attributes?.coordination?.value || 0;
        const parry = this.skills?.parry?.value || 0;
        const dodge = this.skills?.dodge?.value || 0;
        
        this.baseParryPool = body + parry;
        this.baseDodgePool = coord + dodge;

        // SPRINT 5 (C2.2): TOWER SHIELD BULK & PENALTIES
        const equippedTower = this.parent?.items?.find(i => i.type === "shield" && i.system.equipped && i.system.shieldSize === "tower");
        this.hasTowerShieldPenalty = !!equippedTower;
        
        if (equippedTower && !equippedTower.system.isStationary) {
            // Apply speed penalty if moving with portable cover
            if (!this.modifiers) this.modifiers = { speed: 0, pool: 0, armor: 0 };
            this.modifiers.speed -= 2; 
        }

        // ==========================================
        // NEW SPRINT 6: AUTOMATED ARMOR RATING CALCULATION
        // ==========================================
        const equippedArmors = this.parent?.items?.filter(i => i.type === "armor" && i.system.equipped) || [];
        const globalAr = this.modifiers?.armor || 0; // Grabs any global magic AR bonuses

        for (const loc of ["head", "torso", "armL", "armR", "legL", "legR"]) {
            let itemAr = 0;
            for (const armor of equippedArmors) {
                // If this piece of equipped armor protects this specific body part, add its AR
                if (armor.system.protectedLocations && armor.system.protectedLocations[loc]) {
                    itemAr += armor.system.ar || 0;
                }
            }
            
            // HOTFIX: We completely ignore this._source.health[loc].armor to prevent 
            // old manual "ghost" data from stacking with the new automated items.
            this.health[loc].armor = itemAr + globalAr;
        }
    }
}

export class ReignCompanyData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            biography: new SchemaField({
                goals: new StringField({ initial: "" }), leaders: new StringField({ initial: "" }),
                description: new HTMLField({ initial: "" }), assets: new HTMLField({ initial: "" })
            }),
            qualities: new SchemaField({
                might: makeQuality(), treasure: makeQuality(), influence: makeQuality(),
                territory: makeQuality(), sovereignty: makeQuality()
            })
        };
    }
}

export class ReignThreatData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            threatLevel: new NumberField({ initial: 3, min: 0, integer: true }),
            damageFormula: new StringField({ initial: "Width Shock" }),
            magnitude: new SchemaField({
                value: new NumberField({ initial: 5, min: 0, integer: true }),
                max: new NumberField({ initial: 5, min: 1, integer: true })
            }),
            morale: new SchemaField({
                value: new NumberField({ initial: 5, min: 0, integer: true }),
                max: new NumberField({ initial: 5, min: 1, integer: true })
            }),
            description: new HTMLField({ initial: "" }),
            parentCompany: new StringField({ initial: "" })
        };
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
            // SPRINT 4 (B1.2): Tracking timestamp for chronological hand-management
            equippedTimestamp: new NumberField({ initial: 0 }),
            qualities: new SchemaField({
                armorPiercing: new NumberField({ initial: 0, integer: true }),
                slow: new NumberField({ initial: 0, integer: true }),
                twoHanded: new BooleanField({ initial: false }),
                massive: new BooleanField({ initial: false }),
                area: new NumberField({ initial: 0, integer: true })
            }),
            notes: new HTMLField({ initial: "" })
        };
    }
}

export class ReignArmorData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            armorWeight: new StringField({ initial: "light", choices: ["light", "medium", "heavy"] }),
            ar: new NumberField({ initial: 1, min: 0, integer: true }), // NEW: Stores the Armor Rating
            equipped: new BooleanField({ initial: false }),
            equippedTimestamp: new NumberField({ initial: 0 }),
            // NEW: Tracks exactly which body parts this specific piece of armor covers
            protectedLocations: new SchemaField({
                head: new BooleanField({ initial: false }),
                torso: new BooleanField({ initial: false }),
                armL: new BooleanField({ initial: false }),
                armR: new BooleanField({ initial: false }),
                legL: new BooleanField({ initial: false }),
                legR: new BooleanField({ initial: false })
            }),
            notes: new HTMLField({ initial: "" })
        };
    }
}

export class ReignShieldData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            shieldSize: new StringField({ initial: "small", choices: ["small", "large", "tower"] }),
            material: new StringField({ initial: "wood", choices: ["wood", "metal"] }),
            shieldArm: new StringField({ initial: "armL", choices: ["armL", "armR"] }),
            parryBonus: new NumberField({ initial: 1, integer: true }),
            coverAR: new NumberField({ initial: 1, integer: true }), // Wood = 1, Metal = 3
            equipped: new BooleanField({ initial: false }),
            // SPRINT 4 (B1.2): Tracking timestamp for chronological hand-management
            equippedTimestamp: new NumberField({ initial: 0 }),
            // SPRINT 5 (C2.2): Stationary toggle for RAW Tower Shield mechanics
            isStationary: new BooleanField({ initial: true }),
            // Dynamic Passive Protection state
            protectedLocations: new SchemaField({
                head: new BooleanField({ initial: false }),
                torso: new BooleanField({ initial: false }),
                armL: new BooleanField({ initial: false }),
                armR: new BooleanField({ initial: false }),
                legL: new BooleanField({ initial: false }),
                legR: new BooleanField({ initial: false })
            }),
            notes: new HTMLField({ initial: "" })
        };
    }

    /**
     * PHASE 1: Resolve Default Passive Shield Locations
     */
    prepareDerivedData() {
        // SPRINT 5 (C2.2): Enforce specific RAW Tower shield sets
        if (this.shieldSize === "tower") {
            const locs = { head: false, torso: false, armL: false, armR: false, legL: false, legR: false };
            const carryingArm = this.shieldArm || "armL";
            const carryingLeg = carryingArm === "armL" ? "legL" : "legR";

            if (this.isStationary) {
                // STATIONARY: Carrying arm + carrying leg + 2 user choices
                locs[carryingArm] = true;
                locs[carryingLeg] = true;
                
                const manualChoices = Object.keys(this.protectedLocations || {}).filter(k => 
                    this.protectedLocations[k] && k !== carryingArm && k !== carryingLeg
                );
                manualChoices.slice(0, 2).forEach(k => locs[k] = true);
            } else {
                // MOVING: Carrying arm only
                locs[carryingArm] = true;
            }
            this.effectiveLocations = locs;
        } else {
            // SPRINT 1: Standard shield logic via shared utility
            this.effectiveLocations = getEffectiveShieldLocations(this);
        }
    }
}

/**
 * REIGN MAGIC DATA (Martial Techniques & Esoteric Disciplines)
 * Note: Shared schema for both Paths and Disciplines.
 */
export class ReignMagicData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            path: new StringField({ initial: "" }),
            rank: new NumberField({ initial: 1, min: 1, max: 5, integer: true }),
            pool: new StringField({ initial: "" }), // NEW: Restored the missing pool field required by the HTML sheet
            page: new StringField({ initial: "" }),
            // AUDIT FIX: Advanced Arts - Allow passive stances that don't overwrite each other
            isPassive: new BooleanField({ initial: false }),
            effect: new HTMLField({ initial: "" })
        };
    }
}

export class ReignSpellData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            intensity: new NumberField({ initial: 1, min: 1, max: 10, integer: true }),
            // AUDIT FIX 5.4b: Spells have casting times measured in rounds
            castingTime: new NumberField({ initial: 0, min: 0, integer: true }),
            castingStat: new StringField({ initial: "knowledge" }), // NEW: Flexible casting stat
            damage: new StringField({ initial: "" }), // NEW: Enables conditional hit-location targeting for Attack Spells
            pool: new StringField({ initial: "" }),
            page: new StringField({ initial: "" }),
            effect: new HTMLField({ initial: "" })
        };
    }
}

export class ReignGearData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { quantity: new NumberField({ initial: 1, min: 0, integer: true }), notes: new HTMLField({ initial: "" }) };
    }
}

export class ReignAdvantageData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { cost: new NumberField({ initial: 1, integer: true }), effect: new HTMLField({ initial: "" }), hook: new StringField({ initial: "" }) };
    }
}

export class ReignProblemData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { bonus: new NumberField({ initial: 1, integer: true }), effect: new HTMLField({ initial: "" }), hook: new StringField({ initial: "" }) };
    }
}