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
                eerie: makeSkill(), empathy: makeSkill(), hearing: makeSkill(), scrutinize: makeSkill(), sight: makeSkill(),
                inspire: makeSkill(), intimidate: makeSkill(), jest: makeSkill(),
                fascinate: makeSkill(), graces: makeSkill(), lie: makeSkill(), plead: makeSkill()
            }),
            customSkills: new ObjectField({ initial: {} }),
            esoterica: new SchemaField({
                sorcery: new NumberField({ initial: 0, min: 0, integer: true }),
                expert: new BooleanField({ initial: false }),
                master: new BooleanField({ initial: false }),
                attunement: new StringField({ initial: "" }),
                attunementStatus: new StringField({ initial: "none", choices: ["none", "temporary", "partial", "perfect"] }),
                schoolName: new StringField({ initial: "" }),
                schoolDomain: new StringField({ initial: "" }),
                schoolMethod: new StringField({ initial: "" }),
                schoolStat: new StringField({ initial: "" })
            }),
            health: new SchemaField({
                head: makeHealthLoc(), torso: makeHealthLoc(),
                armL: makeHealthLoc(), armR: makeHealthLoc(),
                legL: makeHealthLoc(), legR: makeHealthLoc()
            }),
            xp: new SchemaField({ 
                value: new NumberField({ initial: 0, min: 0, integer: true }), 
                spent: new NumberField({ initial: 0, min: 0, integer: true }) 
            }),
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
                hitRedirects: new ObjectField({ initial: {} }),
                systemFlags: new SchemaField({
                    ignoreFatiguePenalties: new BooleanField({ initial: false }),
                    ignoreHeavyArmorSwim: new BooleanField({ initial: false }),
                    cannotUseTwoHanded: new BooleanField({ initial: false })
                })
            })
        };
    }

    prepareDerivedData() {
        const LOCATIONS = ["head", "torso", "armL", "armR", "legL", "legR"];
        const BASE_MAX = { head: 4, torso: 10, armL: 5, armR: 5, legL: 5, legR: 5 };

        this.effectiveMax = {};
        this.effectiveArmor = {};

        for (const loc of LOCATIONS) {
            this.effectiveMax[loc] = BASE_MAX[loc] + (this.modifiers?.healthMax?.[loc] || 0);
            
            let totalAR = this.modifiers?.naturalArmor?.[loc] || 0;
            const items = this.parent?.items || [];
            for (const item of items) {
                if (item.type === "armor" && item.system.equipped && item.system.protectedLocations?.[loc]) {
                    totalAR += item.system.ar || 0;
                }
            }
            this.effectiveArmor[loc] = totalAR;
        }

        // Tower Shield speed penalty — exposed as a transient property
        const equippedTower = (this.parent?.items || []).find(i => 
            i.type === "shield" && i.system.equipped && i.system.shieldSize === "tower" && !i.system.isStationary
        );
        this.towerShieldSpeedPenalty = equippedTower ? -2 : 0;
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
            xp: new SchemaField({ 
                value: new NumberField({ initial: 0, min: 0, integer: true }), 
                spent: new NumberField({ initial: 0, min: 0, integer: true }) 
            }),
            chronicle: new ArrayField(new SchemaField({
                month:     new NumberField({ initial: 1, min: 1, integer: true }),
                type:      new StringField({ initial: "advance" }),
                text:      new StringField({ initial: "" }),
                timestamp: new NumberField({ initial: 0 })
            }))
        };
    }

    prepareDerivedData() {
        for (const key of Object.keys(this.qualities)) {
            const q = this.qualities[key];
            q.effective = Math.max(0, q.value - (q.damage || 0) - (q.uses || 0));
        }
    }
}

export class ReignThreatData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
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

            // Creature-mode display fields
            movement:      new StringField({ initial: "" }),
            trainability:  new StringField({ initial: "" }),
            tricks:        new NumberField({ initial: 0, min: 0, integer: true }),
            specialRules:  new StringField({ initial: "" }),

            // G3.1: Creature Mode
            creatureMode: new BooleanField({ initial: false }),
            customLocations: new ArrayField(new SchemaField({
                key:         new StringField({ initial: "" }),
                name:        new StringField({ initial: "" }),
                rollHeights: new ArrayField(new NumberField({ integer: true, min: 1, max: 10 })),
                woundBoxes:  new NumberField({ initial: 5, min: 1, integer: true }),
                ar:          new NumberField({ initial: 0, min: 0, integer: true }),
                shock:       new NumberField({ initial: 0, min: 0, integer: true }),
                killing:     new NumberField({ initial: 0, min: 0, integer: true })
            })),
            creatureAttributes: new SchemaField({
                body:         new NumberField({ initial: 3, min: 0, integer: true }),
                coordination: new NumberField({ initial: 2, min: 0, integer: true }),
                sense:        new NumberField({ initial: 2, min: 0, integer: true })
            }),
            creatureSkills: new ObjectField({ initial: {} }),
            creatureAttacks: new ArrayField(new SchemaField({
                name:      new StringField({ initial: "Bite" }),
                attribute: new StringField({ initial: "body" }),
                skill:     new StringField({ initial: "fight" }),
                damage:    new StringField({ initial: "Width Shock" }),
                notes:     new StringField({ initial: "" }),
                isSlow:    new NumberField({ initial: 0, min: 0, integer: true })
            })),
            creatureFlags: new SchemaField({
                freeGobbleDicePerRound: new NumberField({ initial: 0, min: 0, integer: true }),
                moraleAttackOnce: new BooleanField({ initial: false }),
                constrictActive: new BooleanField({ initial: false }),
                constrictTargetId: new StringField({ initial: "" }),
                chargeRunWidest: new NumberField({ initial: 0, min: 0, integer: true }),
                venomPotency: new NumberField({ initial: 0, min: 0, integer: true }),
                venomType: new StringField({ initial: "" }),
                hasChargeAccumulation: new BooleanField({ initial: false }),
                hasConstrict: new BooleanField({ initial: false })
            })
        };
    }

    prepareDerivedData() {
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
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true }),
            // G2: Weapon Poison Integration
            isPoisoned: new BooleanField({ initial: false }),
            poisonRef: new StringField({ initial: "" })
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
            slow: new NumberField({ initial: 0, min: 0, integer: true }),
            duration: new StringField({ initial: "" }),
            castingStat: new StringField({ initial: "knowledge", choices: ["body", "coordination", "sense", "knowledge", "command", "charm"] }), 
            damage: new StringField({ initial: "" }), 
            pool: new StringField({ initial: "" }),
            page: new StringField({ initial: "" }),
            effect: new StringField({ initial: "" }),
            attunementRequired: new BooleanField({ initial: false }),
            isAttunementSpell: new BooleanField({ initial: false }),
            dodgeable: new BooleanField({ initial: false }),
            parriable: new BooleanField({ initial: false }),
            armorBlocks: new BooleanField({ initial: false })
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

// ==========================================
// G2: POISON ITEM DATA MODEL
// ==========================================

export class ReignPoisonData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            potency: new NumberField({ initial: 5, min: 1, max: 15, integer: true }),
            majorEffect: new StringField({ initial: "" }),
            minorEffect: new StringField({ initial: "" }),
            difficulty: new NumberField({ initial: 0, min: 0, max: 10, integer: true }),
            retainedDelivery: new BooleanField({ initial: true }),
            notes: new StringField({ initial: "" }),
            wealthCost: new NumberField({ initial: 0, min: 0, integer: true })
        };
    }
}
