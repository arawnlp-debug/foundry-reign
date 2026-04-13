// scripts/system/models.js
const { StringField, NumberField, BooleanField, SchemaField, ObjectField, HTMLField } = foundry.data.fields;

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

// UPDATED: Aligned with the P1 Company Fix (value = permanent, damage = temporary)
const makeQuality = () => new SchemaField({
    value: new NumberField({ initial: 0, min: 0, integer: true }),
    damage: new NumberField({ initial: 0, min: 0, integer: true }),
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
                head: makeHealthLoc(), torso: makeHealthLoc(),
                armL: makeHealthLoc(), armR: makeHealthLoc(),
                legL: makeHealthLoc(), legR: makeHealthLoc()
            }),
            esoterica: new SchemaField({
                sorcery: new NumberField({ initial: 0, min: 0, integer: true }),
                expert: new BooleanField({ initial: false }), master: new BooleanField({ initial: false }),
                attunement: new HTMLField({ initial: "" })
            }),
            xp: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }), spent: new NumberField({ initial: 0, min: 0, integer: true }) }),
            wealth: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }) }),
            modifiers: new SchemaField({
                pool: new NumberField({ initial: 0, integer: true }),
                armor: new NumberField({ initial: 0, integer: true }),
                speed: new NumberField({ initial: 0, integer: true })
            })
        };
    }

    /**
     * Dynamically calculates maximum health boxes per location,
     * factoring in active Problems and Advantages.
     * @returns {Object} Key-value pairs of hit locations and their max integer value.
     */
    get effectiveMax() {
        const maxes = { head: 4, torso: 10, armL: 5, armR: 5, legL: 5, legR: 5 };
        const traitHooks = this.parent?.items?.filter(i => ["advantage", "problem"].includes(i.type)) || [];
        
        for (const loc of Object.keys(maxes)) {
            let max = maxes[loc];
            const locHookPath = `${loc}.max`;
            
            for (const item of traitHooks) {
                // Supports both legacy "head.max:+1" and modern "[head.max] +1" syntax
                const hookMatch = (item.system.hook || "").match(/\[(.+?)\]\s*([\+\-]\d+)/) || (item.system.hook || "").match(/^([a-zA-Z.]+):([\+\-]?\d+)$/);
                if (hookMatch) {
                    const hookTarget = hookMatch[1].trim();
                    const hookVal = parseInt(hookMatch[2].replace(/\s/g, "")) || 0;
                    if (hookTarget === locHookPath) max += hookVal;
                }
            }
            maxes[loc] = Math.max(1, max);
        }
        return maxes;
    }

    /**
     * Dynamically calculates the Armor Rating per hit location based on equipped items.
     * Non-linear stacking: Only the highest AR applies per location per RAW.
     * @returns {Object} Key-value pairs of hit locations and their AR integer value.
     */
    get effectiveArmor() {
        const ar = { head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
        const equippedArmors = this.parent?.items?.filter(i => i.type === "armor" && i.system.equipped) || [];
        const globalAr = this.modifiers?.armor || 0;

        for (const loc of Object.keys(ar)) {
            let itemAr = 0;
            for (const armor of equippedArmors) {
                if (armor.system.protectedLocations?.[loc]) {
                    itemAr = Math.max(itemAr, armor.system.ar || 0);
                }
            }
            ar[loc] = itemAr + globalAr;
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
        
        if (equippedTower && !equippedTower.system.isStationary) {
            if (!this.modifiers) this.modifiers = { speed: 0, pool: 0, armor: 0 };
            this.modifiers.speed -= 2; 
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

    // UPDATED: Automatically calculate the effective rating for Company Rollers
    prepareDerivedData() {
        for (const key of Object.keys(this.qualities)) {
            const q = this.qualities[key];
            q.effective = Math.max(0, q.value - (q.damage || 0));
        }
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
            equippedTimestamp: new NumberField({ initial: 0 }), // Tracks equip order for hand conflict resolution
            qualities: new SchemaField({
                armorPiercing: new NumberField({ initial: 0, integer: true }),
                slow: new NumberField({ initial: 0, integer: true }),
                twoHanded: new BooleanField({ initial: false }),
                massive: new BooleanField({ initial: false }),
                area: new NumberField({ initial: 0, integer: true })
            }),
            notes: new HTMLField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) // Ready for Charactermancer
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
            notes: new HTMLField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) // Ready for Charactermancer
        };
    }

    /**
     * Auto-derives physical weight class based on coverage and AR thickness per RAW classification.
     */
    prepareDerivedData() {
        const locs = this.protectedLocations || {};
        const covered = Object.values(locs).filter(v => v).length;
        const coversAllLimbs = locs.armL && locs.armR && locs.legL && locs.legR;
        
        if (coversAllLimbs && this.ar >= 2) {
            this.derivedWeight = "heavy";
        } else if (covered <= 2 && this.ar <= 2) {
            this.derivedWeight = "light";
        } else {
            this.derivedWeight = "medium";
        }
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
            isStationary: new BooleanField({ initial: true }), // Required for Tower Shield cover mechanics
            protectedLocations: new SchemaField({
                head: new BooleanField({ initial: false }),
                torso: new BooleanField({ initial: false }),
                armL: new BooleanField({ initial: false }),
                armR: new BooleanField({ initial: false }),
                legL: new BooleanField({ initial: false }),
                legR: new BooleanField({ initial: false })
            }),
            notes: new HTMLField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) // Ready for Charactermancer
        };
    }

    /**
     * Safely derives which locations are actually covered based on 
     * shield size, limits, and stationary status for Tower Shields.
     */
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

/**
 * Shared schema for Reign Magic (Martial Techniques & Esoteric Disciplines).
 */
export class ReignMagicData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            path: new StringField({ initial: "" }),
            associatedSkill: new StringField({ initial: "" }), // For Charactermancer prerequisites
            rank: new NumberField({ initial: 1, min: 1, max: 5, integer: true }),
            pool: new StringField({ initial: "" }), 
            page: new StringField({ initial: "" }),
            isPassive: new BooleanField({ initial: false }),
            effect: new HTMLField({ initial: "" })
        };
    }
}

export class ReignSpellData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            school: new StringField({ initial: "" }), // For Charactermancer groupings
            intensity: new NumberField({ initial: 1, min: 1, max: 10, integer: true }),
            castingTime: new NumberField({ initial: 0, min: 0, integer: true }),
            castingStat: new StringField({ initial: "knowledge", choices: ["body", "coordination", "sense", "knowledge", "command", "charm"] }), 
            damage: new StringField({ initial: "" }), 
            pool: new StringField({ initial: "" }),
            page: new StringField({ initial: "" }),
            effect: new HTMLField({ initial: "" })
        };
    }
}

export class ReignGearData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            quantity: new NumberField({ initial: 1, min: 0, integer: true }), 
            notes: new HTMLField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }) // Ready for Charactermancer
        };
    }
}

export class ReignAdvantageData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            cost: new NumberField({ initial: 1, integer: true }), 
            effect: new HTMLField({ initial: "" }), 
            hook: new StringField({ initial: "" }) // Maintained for legacy compatibility; new architecture will prefer ActiveEffects
        };
    }
}

export class ReignProblemData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return { 
            bonus: new NumberField({ initial: 1, integer: true }), 
            effect: new HTMLField({ initial: "" }), 
            hook: new StringField({ initial: "" }) // Maintained for legacy compatibility; new architecture will prefer ActiveEffects
        };
    }
}