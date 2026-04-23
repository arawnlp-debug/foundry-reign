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
    uses: new NumberField({ initial: 0, min: 0, integer: true }),
    effective: new NumberField({ initial: 0, min: 0, integer: true }), // V14 FIX: Explicitly define derived fields
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
                attunement: new StringField({ initial: "" })
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
                    ignoreMultiPenaltySkills: new ArrayField(new StringField()),
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
        
        if (equippedTower && !equippedTower.system.isStationary) {
            if (!this.modifiers) this.modifiers = {};
            this.modifiers.globalSpeed = (this.modifiers.globalSpeed || 0) - 2; 
        }
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
            })
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
            description: new StringField({ initial: "" }),
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
            castingStat: new StringField({ initial: "knowledge", choices: ["body", "coordination", "sense", "knowledge", "command", "charm"] }), 
            damage: new StringField({ initial: "" }), 
            pool: new StringField({ initial: "" }),
            page: new StringField({ initial: "" }),
            effect: new StringField({ initial: "" })
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