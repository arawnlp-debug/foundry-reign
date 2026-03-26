// scripts/system/models.js
const { StringField, NumberField, BooleanField, SchemaField, ObjectField, HTMLField } = foundry.data.fields;

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
                attunement: new StringField({ initial: "" })
            }),
            xp: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }), spent: new NumberField({ initial: 0, min: 0, integer: true }) }),
            wealth: new SchemaField({ value: new NumberField({ initial: 0, min: 0, integer: true }) })
        };
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
            magnitude: new SchemaField({ value: new NumberField({ initial: 5, min: 0 }), max: new NumberField({ initial: 5, min: 1 }) }),
            morale: new SchemaField({ value: new NumberField({ initial: 5, min: 0 }), max: new NumberField({ initial: 5, min: 1 }) }),
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
            equipped: new BooleanField({ initial: false }),
            notes: new HTMLField({ initial: "" })
        };
    }
}

export class ReignShieldData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            parryBonus: new NumberField({ initial: 1, integer: true }),
            coverAR: new NumberField({ initial: 2, integer: true }),
            equipped: new BooleanField({ initial: false }),
            notes: new HTMLField({ initial: "" })
        };
    }
}

export class ReignMagicData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            path: new StringField({ initial: "" }),
            rank: new NumberField({ initial: 1, min: 1, max: 5, integer: true }),
            page: new StringField({ initial: "" }),
            effect: new HTMLField({ initial: "" })
        };
    }
}

export class ReignSpellData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            intensity: new NumberField({ initial: 1, min: 1, max: 10, integer: true }),
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

// FIXED: Split ReignTraitData into distinct Advantage and Problem data models
export class ReignAdvantageData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            cost: new NumberField({ initial: 1, integer: true }),
            effect: new HTMLField({ initial: "" }),
            hook: new StringField({ initial: "" })
        };
    }
}

export class ReignProblemData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            bonus: new NumberField({ initial: 1, integer: true }),
            effect: new HTMLField({ initial: "" }),
            hook: new StringField({ initial: "" })
        };
    }
}