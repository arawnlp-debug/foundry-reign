# Reign: Realities of Lords and Leaders
### An unofficial Foundry VTT system for Reign 2nd Edition by Greg Stolze

Built for Foundry V14. Automates the OneRoll Engine (ORE) in full — from personal combat and sorcery to company actions and faction politics.

---

## Contents

- [Installation](#installation)
- [The OneRoll Engine](#the-oneroll-engine)
- [Characters](#characters)
- [Combat](#combat)
- [Sorcery](#sorcery)
- [Companies & Factions](#companies--factions)
- [Character Creation](#character-creation)
- [Company Creation](#company-creation)
- [World Settings](#world-settings)
- [Active Effects](#active-effects)
- [For Game Masters](#for-game-masters)
- [Recent Changes](#recent-changes)
- [Roadmap](#roadmap)
- [Credits & Legal](#credits--legal)

---

## Installation

**From Foundry's system browser:**
1. Open Foundry VTT → Game Systems → Install System
2. Search for **Reign**

**By manifest URL:**
1. Open Foundry VTT → Game Systems → Install System
2. Paste into the manifest field:
   ```
   https://raw.githubusercontent.com/arawnlpdebug/foundryreign/main/system.json
   ```

**Compatibility:** Foundry V14 · System version 2.3.0

---

## The OneRoll Engine

Every roll in Reign uses the OneRoll Engine. You roll a pool of d10s and look for **sets** — dice showing the same face. A set's **Width** (how many dice) determines speed and potency. Its **Height** (which face) determines precision and location.

The system handles all ORE mechanics automatically:

**Pool building** — select your Attribute and Skill from dropdowns. The roller calculates the pool, applies Expert and Master dice, and shows a live preview before you roll. Individual character pools cap at 10d regardless of pool size — any overflow above 10d can be used to offset penalties instead of adding dice (RAW p.38). Minion group pools cap at 15d.

**Expert Dice (ED)** — one gold die in the pool. Set it to any face *before* rolling the other dice. Having an ED means you are always making a called shot with no penalty — the die is pre-set to the desired location.

**Master Dice (MD)** — one die set to any face *after* rolling the other dice, guaranteeing at least one die at any chosen face. You can never have both an ED and MD in the same pool.

**Multi-action penalties** — declaring multiple actions automatically reduces pool size by 1d per extra action. The roller calculates this silently; the dialog shows the adjusted pool.

**Called shots** — choose a target hit location. You take a –1d penalty and set one die to the desired face before rolling. If a set forms at that face it hits the intended location. Other sets that form at other faces can also be used at the player's option — the called shot doesn't discard them.

**Difficulty** — a minimum Height requirement. Sets below the difficulty are discarded. Set this in the roll dialog.

**Waste dice** — dice that don't form sets. In Reign, waste can matter for threats and minions; the system tracks and displays them separately.

**Environmental modifiers** — bonus and penalty dice from scene or situational context, added in the roll dialog.

---

## Characters

### The Character Sheet

The character sheet has five tabs: **Stats**, **Combat**, **Esoterica**, **Biography**, and **Effects**.

#### Stats Tab

Six attributes — Body, Coordination, Sense, Knowledge, Command, Charm — each with a rollable score and a skill list. Click any stat or skill label to open the roll dialog. Expert and Master dice are toggled per-skill.

**Custom skills** — add any number of custom skills to any attribute. These appear in the skill list and are fully rollable.

**Advantages & Problems** — tracked with cost/bonus values and effect notes. Problems grant bonus dice on relevant rolls.

**Gear** — inventory with quantity tracking.

**Wealth** — a single value representing economic standing, rollable for purchase attempts.

**XP** — total earned and spent tracked separately.

#### Combat Tab

The combat tab has three sections that update in real time during an encounter.

**Health** — a six-location silhouette (Head, Torso, Left Arm, Right Arm, Left Leg, Right Leg). Each location tracks Shock and Killing independently. Locations fill visually as damage accrues. When a limb fills entirely with Killing damage, any further damage to that limb overflows into the torso — this is a standard rule applying to all attacks. The torso filling with Killing damage means death, as does the head filling with Killing damage. The head filling with Shock damage renders the character unconscious; the torso filling with Shock damage inflicts a –1d penalty to all actions. Armor Rating applies per location.

**Inventory** — equipped weapons, armor, and shields in a compact list. Weapons show damage formula, pool, range, and qualities. Equip and unequip with one click. Slow weapons show their cooldown status in the current combat round.

**Combat Moves** — all declared actions for the round, including the **Aim** maneuver (which accumulates a bonus Width that carries into the next attack roll) and **Shield Coverage** (assigning which locations the shield protects this round).

**Maneuvers** — the full ORE maneuver list is available from the roll dialog during combat. Maneuvers that produce deterministic outcomes (Charge, Disarm, Knockout, Trip, Threaten, Display Kill) resolve automatically from the roll result. Complex maneuvers (Pin, Restrain, Slam, Strangle, and others) post detailed rules text to chat for GM adjudication.

#### Progression Mode

Toggle **Progression Mode** on any character sheet. In this mode, stat and skill increment buttons replace the roll buttons, enforcing the XP cost structure. Click a stat to upgrade it; the XP cost is deducted automatically.

---

## Combat

### Rolling Attacks

Click a weapon name on the combat tab to open the attack roll dialog. The pool is pre-set from the weapon's pool field. Select the attack stat, apply situational modifiers, and roll.

**Damage application** — the chat card shows each set as a damage block. Click the damage number to apply it to a targeted token. The system resolves hit location, Armor Rating, Shock vs Killing split, and health updates automatically.

**Armor Piercing** — weapons with AP reduce the target's AR before damage is applied.

**Slow weapons** — a Slow N weapon sets a per-character cooldown flag. The roller blocks another attack with that weapon until the cooldown clears (next available round shown in the combat inventory).

**Area weapons** — area N weapons produce N extra damage rolls against secondary targets. Apply each separately.

**Massive weapons** — certain two-handed weapons (large clubs, battleaxes, polearms, greatswords) can be made massive. A massive weapon adds +1 Killing damage on every hit. Wielding one requires Body 4 or higher.

### Defense

Click **Dodge** or **Parry** from the roll dialog or combat moves panel.

**Dodge** — Coordination + Dodge. A successful set becomes Gobble Dice — one Gobble Die per die in the set. Each Gobble Die can cancel one opposing die from an attacker's set, provided the Gobble Die's face is equal to or higher than the opposing die's face. Removing a die from a set breaks it if it falls below two. A single successful dodge can therefore cancel multiple attacks. The system prompts selection when multiple attacker sets are present.

**Parry** — uses the best equipped weapon or shield. A shield adds its Parry Bonus to the pool. The system checks whether the character has an appropriate weapon for the attack type and applies unarmed parry redirect if bare-handed.

**Counterspell** — Knowledge + Counterspell. Produces Gobble Dice against incoming magical attacks. Treated identically to Dodge in terms of gobble resolution.

**Shield Coverage** — before each round, assign which locations the shield protects via the Shield Coverage button. Declared coverage takes priority over the default arm location for that round.

### Gobble Dice

When a defender rolls Dodge, Parry, or Counterspell successfully, the dice in their set become Gobble Dice — one per die in the set. Each Gobble Die can cancel one die from an attacker's set, as long as the Gobble Die's face is equal to or greater than the target die's face. Cancelling a die from a set breaks it if it falls below two. Because each Gobble Die acts individually, a single successful defense can break multiple attacks in the same round. When multiple attacker sets are present, the system prompts the defender to assign their Gobble Dice.

### Threats

Unworthy opponents — mobs, rabble, minions — don't have hit locations or wound boxes. Instead they use binary elimination: if the Height or Width of any set from an attack equals or exceeds the group's **Threat rating**, one fighter is removed from the group. A Threat 2 mob can be picked off by any 2×anything or any ×2 result; a Threat 4 bodyguard requires Width 4 or Height 4 to eliminate.

Threat is a static rating from 1 to 4 measuring how dangerous the fighters are — it is not the mob itself. The mob is the group of fighters tracked by the magnitude pool.

**When a fighter is eliminated**, two things happen simultaneously: one die is immediately removed from any set the mob has in the current round's roll (spoiling or narrowing their attack), and the mob's pool shrinks by one die for every subsequent round. A mob that started with eight fighters rolling 8d will roll 7d next round after losing one.

The mob's own waste dice don't trigger special effects.

A mob is defeated when its magnitude reaches zero through eliminations, or when a morale check produces no sets and the group routs.

The threat sheet tracks four values:

- **Threat** — the elimination threshold (Width or Height of a hit must meet or exceed this)
- **Magnitude** — the current headcount of active fighters; also the dice pool for the mob's attacks (capped at 15d RAW)
- **Morale** — a secondary pool used for routing checks; if the roll produces no sets, the horde routs and is removed from play
- **Damage Formula** — the standard Shock/Killing formula the mob deals (e.g. "Width Shock")

Clicking **Roll Attack** on the threat sheet rolls the group's magnitude pool and produces a standard chat card. Damage is applied to targeted tokens as normal physical Shock or Killing. Clicking **Roll Morale** checks whether the horde holds — no sets means the horde flees and both magnitude and morale are zeroed automatically.

---

## Sorcery

### The Esoterica Tab

All magic lives in the Esoterica tab: Esoteric Disciplines at the top, and below that a split layout — a structured sidebar on the left and the spell list on the right.

### Sorcery Skill

The Sorcery score sits in the top of the sidebar. It rolls using the school's associated attribute. Expert and Master dice function identically to combat skills.

The casting attributes quick-reference shows all six attributes. The attribute that pairs with the character's school is highlighted with a pip indicator so the correct pool is always obvious.

### Magical School

Below the Sorcery panel, the School panel records:
- **School Name** — e.g. "The Runewrights"
- **Domain** — what the magic acts upon
- **Method** — how spells are cast (dancing, writing, chanting, touch, etc.)
- **Associated Attribute** — the Stat (or occasionally Skill) that pairs with Sorcery for this school, as defined by the school's rules. All canonical schools in Heluso & Milonda use a Stat, but custom schools may use a Skill instead.

Selecting an associated attribute from the dropdown immediately updates the casting attributes highlight.

### Attunement

The Attunement panel tracks the four states of attunement as radio buttons with colour-coded badges:

| State | Badge | Meaning |
|---|---|---|
| Not Attuned | Grey | Must cast a temporary attunement spell before domain spells |
| Temporary | Amber | Attunement spell has been cast; grants access to one higher-intensity spell in the domain |
| Partial | Red | Permanently attuned but with unpleasant side effects (sandy texture, fragile bones, etc.) |
| Perfect | Green | Perfectly attuned; full domain access and attunement benefits |

A notes textarea below the badges holds narrative descriptions of attunement effects and side effects, pre-seeded during character creation with the school's attunement description.

### The Spell List

Spells are listed grouped by school name. Each school group is collapsible — click the header to collapse or expand it. Spells within a group are presented in a compact list showing:

**Intensity badge** — circular badge colour-coded by tier: smoke (1–2), amber (3–4), crimson (5–6), purple (7–10). Hovering shows the detection radius for that intensity level.

**Status icons:**
- 🔒 Lock — the spell requires attunement and the character is not attuned
- ⚡ Link — this is an attunement spell (provides attunement, not a direct effect)
- ⏳ Slow N — the spell requires N rounds of preparation before the roll is made

**Duration** — how long the effect lasts.

**Effect summary** — truncated first line of the effect text.

Click the dice icon to open the casting roll dialog.

### Casting a Spell

The roll dialog for spells shows a spell information banner:
- **Intensity difficulty** — "Width of your set must equal or exceed Intensity N" (an Intensity 3 spell requires a set of at least 3 dice — any Height)
- **Slow rating** — if the spell is slow, shows how many rounds of preparation are required before the roll
- **Attunement Required** tag — if applicable
- **Attunement Spell** tag — if this spell grants attunement

The attribute pre-selects the school's associated attribute. The Sorcery skill is pre-selected.

If the spell has `attunementRequired: true` and the character is not attuned, a warning notification fires before the dialog opens. The roll proceeds regardless — the GM adjudicates.

### Roll Result

Spell roll chat cards include a spell result block below the sets:

- **Spell Fires** (green) if any set's Width equals or exceeds the spell's Intensity; **Spell Fizzled** (red) otherwise
- **Detection radius** — how far away any character can detect the casting with a Sense + Eerie roll (any match succeeds; no Height/Width threshold)
- **Slow** — reminder of preparation rounds required; a notification also posts when the next roll opportunity arrives
- **School, Duration** — contextual tags
- **Dodgeable / Parriable / Armor Blocks** — shown if the spell has attack properties

### Spell Properties

Each spell item tracks:

| Property | Description |
|---|---|
| Intensity | 1–10; both purchase cost tier and Width difficulty |
| Slow | N rounds of preparation before the roll; a Slow 1 spell prepares one round then rolls the next |
| Casting Time | Rounds to charge before release |
| Duration | Freeform text — "Width hours", "Instant", "Permanent", etc. |
| School | Which school this spell belongs to (used for grouping) |
| Casting Stat | The attribute that pairs with Sorcery for this spell |
| Pool | Freeform pool description hint |
| Damage | Damage formula if this is an attack spell |
| Attunement Required | A temporary attunement spell must be cast before this spell; the attunement spell itself does nothing except enable the next casting |
| Is Attunement Spell | This spell grants temporary attunement |
| Dodgeable | Targets may attempt to Dodge |
| Parriable | Targets may attempt to Parry |
| Armor Blocks | Target's AR applies |

---

## Companies & Factions

### The Company Sheet

Companies are organisations — armies, guilds, courts, cults — with five Quality scores: **Might, Treasure, Influence, Territory, Sovereignty**. Each runs from 1 to 6 (0 means the Quality is absent entirely).

Quality scores are both permanent values and hit point pools. Damage is tracked separately as a temporary overlay; overflow causes permanent loss.

**Company Actions** — ten standard actions defined by RAW, each combining two Quality ratings into a single dice pool. You may use only one Quality if the other is penalised or reserved. Actions: Attack, Defend, Espionage, Counter-Espionage, Being Informed, Policing, Rise in Stature, Improve Culture, Train and Levy Troops, and Unconventional Warfare.

**Assets** — companies can own item assets (fortifications, fleets, magical resources) tracked in an asset list.

### The Faction Dashboard

A dedicated application showing all companies in the world simultaneously. View quality scores, current damage, and company relationships on one screen. Open from the sidebar tools or via the macro API.

### Company Creation (Companymancer)

The Companymancer generator creates companies from scratch:

1. **Name and concept** — title and brief description
2. **Quality allocation** — distribute points across the five qualities within the campaign budget (configurable in settings)
3. **Actions** — pre-declare which company actions are available
4. **Assets** — add starting assets from the compendium or create custom ones

The campaign budget is configurable per world in **World Settings → Reign Settings → Campaign Budget**.

---

## Character Creation

### The Charactermancer

Open the Charactermancer from the character sheet header or by clicking the creation wand icon on an empty character. Two creation methods are available:

### One-Roll Creation

Roll once to determine the character's life path. The result is interpreted through the active **One-Roll Table** — a JSON file that maps set Width and Height to life stages, skill grants, and narrative prompts.

1. **Roll the Bones** — one ORE roll determines the entire life path
2. **Accept or Reroll** — review the result and reroll if desired (GM may limit rerolls)
3. **Life Path** — each set maps to a life stage: childhood, apprenticeship, journeyman years, recent history
4. **Waste Dice** — waste maps to the Waste chart, granting small bonuses, background details, or complications
5. **Apply** — the result is written directly to the character

### Point Buy Creation

Manual allocation within a point budget (default 85 points):

- **Attributes** — 5 points per level (minimum 1 in each)
- **Skills** — 1 point per level
- **Expert Die** — 1 point per skill
- **Master Die** — 5 points per skill
- **Sorcery** — 1 point per level, same as skills; Expert and Master dice available at the same costs
- **Advantages & Problems** — advantages cost their listed point value; problems refund them
- **Equipment** — starting weapons, armour, and gear

### School Selection (Both Methods)

When any Sorcery investment is made, a **Magical School** picker appears. Schools are loaded from the active One-Roll Table JSON and presented as a card grid. Each card shows the school name, associated attribute, casting method, and domain. Clicking a card selects it; clicking again deselects it for a generalist sorcerer.

On creation, the selected school writes its name, domain, method, and associated attribute to the character's esoterica fields. The attunement notes textarea is pre-seeded with the school's attunement description.

Different worlds using custom One-Roll Table JSON files automatically get their own school lists. See **World Settings** below.

---

## World Settings

Access via **Game Settings → Configure Settings → Reign Settings**.

### Available One-Roll Tables

A comma-separated list of JSON file paths (relative to the Foundry data directory) specifying which One-Roll Tables are available for character creation. The first path in the list is the primary table — used by the school picker and the one-roll generator.

The system ships with `systems/reign/data/oneroll-default.json`. To add a custom setting:

1. Create a JSON file with the following top-level structure:
```json
{
  "tableName": "My Setting",
  "sets": { ... },
  "schools": [ ... ],
  "waste": { ... }
}
```
2. Place it in your Foundry user data directory
3. Add its path to the One-Roll Tables setting
4. The charactermancer will offer it as an option on next open

**The `schools` array** (optional — omitting it hides the school picker):
```json
"schools": [
  {
    "id": "unique-id",
    "name": "School Name",
    "domain": "What the magic affects",
    "method": "How spells are cast",
    "associatedStat": "knowledge",
    "description": "Flavour text shown in the card tooltip.",
    "attunementNote": "What attunement does to the practitioner."
  }
]
```

### Campaign Budget

The point budget for company creation in the Companymancer. Default: varies by setting recommendation. Raise for more powerful starting companies.

### Post-Combat Recovery

Controls how Shock is recovered after combat ends. Options:
- **Full Recovery** — all combat Shock clears
- **Half Recovery** — Shock taken during combat is halved
- **No Automatic Recovery** — GM handles recovery manually

---

## Active Effects

Active Effects in Reign modify actor data through Foundry's standard Active Effect system. Effects can be applied via items (equipped gear, advantages, spells) or directly to the actor.

### Supported Effect Paths

| Group | Path | Effect |
|---|---|---|
| Global | `system.modifiers.globalPool` | Bonus dice to all pools |
| Combat | `system.modifiers.combat.bonusDamageShock` | Bonus Shock damage |
| Combat | `system.modifiers.combat.bonusDamageKilling` | Bonus Killing damage |
| Combat | `system.modifiers.combat.ignoreArmorTarget` | Ignore target's AR |
| Combat | `system.modifiers.combat.combineGobbleDice` | Superior Interception |
| Combat | `system.modifiers.combat.crossBlockActive` | Cross Block enabled |
| Max Health | `system.modifiers.healthMax.{location}` | Raise health cap per location |
| Natural Armor | `system.modifiers.naturalArmor.{location}` | Innate AR per location |
| Hit Redirection | `system.modifiers.hitRedirects.{location}` | Redirect hits from location |
| Skill (per skill) | `system.modifiers.skills.{skill}.pool` | Bonus dice to skill pool |
| Skill (per skill) | `system.modifiers.skills.{skill}.bonusWidth` | Bonus Width from equipment |
| Immunities | `system.modifiers.systemFlags.ignoreFatiguePenalties` | Ignore fatigue |
| Immunities | `system.modifiers.systemFlags.ignoreHeavyArmorSwim` | Swim in heavy armor |
| Immunities | `system.modifiers.systemFlags.cannotUseTwoHanded` | Block two-handed weapon use |

Locations: `head`, `torso`, `armL`, `armR`, `legL`, `legR`

Skills: all standard Reign skills plus any custom skill by its key.

### Applying Effects

1. Open any item, advantage, or the Effects tab on a character sheet
2. Click **Add Effect**
3. Set the **Attribute Key** from the supported paths above
4. Set the **Change Mode** — Add (2) for numeric, Override (5) for boolean/string
5. Set the **Effect Value**

Effects from equipped items are active only while the item is equipped. Advantages and problems apply unconditionally.

---

## For Game Masters

### One-Roll Table Format

The One-Roll Table JSON maps ORE results to life path outcomes. The default table ships with the system. A custom table can implement any setting.

**Top-level structure:**
```json
{
  "tableName": "Setting Name",
  "sets": { "2": { ... }, "3": { ... }, ... "10": { ... } },
  "schools": [ ... ],
  "waste": { "A": { ... }, "B": { ... }, ... }
}
```

**Set entries** (keyed by Height 2–10):
```json
"5": {
  "stages": {
    "1": { "label": "Life Stage Name", "results": { "1": {...}, "2": {...}, ... } },
    "2": { ... }
  }
}
```

Each result entry within a stage:
```json
{
  "label": "Result description",
  "skills": { "fight": 2, "endurance": 1 },
  "attributes": { "body": 1 },
  "sorcery": 0,
  "advantages": ["Tough"],
  "wealth": 1
}
```

**Waste entries** (keyed by chart letter):
```json
"A": {
  "name": "Chart A: The Common Lot",
  "results": {
    "1": { "label": "Waste result 1", "skills": { "haggle": 1 } },
    ...
  }
}
```

### Migration

The system includes an automatic migration engine. On world load, if the system version exceeds the world's last migration version, the engine runs across all world actors, items, scene tokens, and compendium packs. All migrations are additive — no data is deleted without an explicit `.-=field` removal.

If a migration fails for a document, it is logged to the console with the document name and error. Other documents continue migrating.

### Compendium Packs

The system ships with five compendium packs:

| Pack | Contents |
|---|---|
| Weapons & Armor | Standard melee, ranged weapons and armour types |
| Gear & Equipment | General equipment, tools, provisions |
| Martial Techniques | Technique items for martial paths |
| Spells & Esoteric Disciplines | Spell and discipline items |
| Company Assets | Asset items for company sheets |

---

## Recent Changes

### v2.3.0 — Sorcery Elevation & School System

The magic system is fully rebuilt. Spells now track Intensity as a Width-based casting difficulty (the Width of any set must equal or exceed the spell's Intensity), Slow as a preparation mechanic (N rounds before the roll), duration, and a full set of interaction flags (dodgeable, parriable, armor blocks, attunement required). Roll chat cards include a spell result block showing whether the spell fired, detection radius, and all relevant flags. The esoterica tab is redesigned with structured school and attunement status panels (Not Attuned / Temporary / Partial / Perfect). Magical schools are defined in the One-Roll Table JSON — different worlds load different schools automatically. The charactermancer school picker appears whenever any Sorcery is purchased.

The pre-existing `style="display:none"` inline styles on roll dialog custom fields have been replaced with a `.reign-hidden` CSS utility class.

### v2.2.0 — Architecture & Chat Optimisation

DRY extraction of hit location constants, scroll mixin, effect dictionary, and damage commit utility. Slimmed chat flag projection. Faction dashboard instance tracking improved.

### v2.1.0 — Critical Bug Fixes

Company conquest reward pre-damage snapshot fix. Shock recovery respects preCombatShock flag. Double-deletion in custom skills/moves resolved.

---

## Roadmap

### v2.4.0 — Active Effects Phase 2
Complete the Active Effects audit against RAW. Add sorcery to the effect dictionary. Surface the multi-action penalty exemption path (`ignoreMultiPenaltySkills`) used by certain esoteric disciplines. Verify all referenced modifier paths are reachable through the AE UI.

### v2.5.0 — Combat Manoeuvre Automation
Promote tractable Tier 2 manoeuvres to full automation: Pin, Restrain, Stand, Shove, Slam, Strangle, Iron Kiss, Redirect, Submission Hold. Each will set the appropriate status effect on the targeted token directly from the chat card. Complex narrative manoeuvres (Feint, Wait, Disfiguring Strike, Formation Charge) remain Tier 2 with a GM resolution button.

### v2.6.0 — Presentation Pass
Consistency audit across threat and company sheets to match the character sheet improvements. Dark mode sweep of all new CSS introduced in v2.3.0 — replace hardcoded hex values with CSS variable references. Charactermancer biography formatting improvements.

### v2.7.0 — Compendium Content
Seed compendium packs with representative content using the full schema: weapons with all qualities, armour types, one spell per default school (showcasing all new fields), two complete martial paths, two complete esoteric disciplines.

### v2.8.0 — Quality of Life
Counterspell integration — a "Counter This Spell" button on spell chat cards opening a pre-configured counterspell roll dialog. One-Roll Table validation with structured error reporting. Eerie detection prompt from spell cast chat cards.

---

## Credits & Legal

**System:** Llew ap Hywel · [GitHub](https://github.com/arawnlpdebug/foundryreign)

**Reign 2nd Edition** is the work of Greg Stolze, published by Arc Dream Publishing. This system is unofficial and fan-made. It contains no reproduced text, tables, or content from any published Reign product. All mechanical implementation is original. All default magical schools are original generic archetypes.

This system is released under the **MIT License**. You are free to fork, modify, and redistribute it under the same terms.

Foundry Virtual Tabletop is a product of Foundry Gaming LLC. This system is not affiliated with or endorsed by Foundry Gaming LLC or Arc Dream Publishing.
