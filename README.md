# Reign: Realities of Lords and Leaders
### An unofficial Foundry VTT system for Reign 2nd Edition by Greg Stolze

Built for Foundry V14. Automates the OneRoll Engine (ORE) in full — from personal combat and sorcery to company actions and faction politics.

---

## Contents

- [Installation](#installation)
- [The OneRoll Engine](#the-oneroll-engine)
- [Quick Dice Roller](#quick-dice-roller)
- [Characters](#characters)
- [Combat](#combat)
- [Sorcery](#sorcery)
- [Creatures & Bestiary](#creatures--bestiary)
- [Hazards](#hazards)
- [Companies & Factions](#companies--factions)
- [Character Creation](#character-creation)
- [Company Creation](#company-creation)
- [World Settings](#world-settings)
- [Active Effects](#active-effects)
- [For Game Masters](#for-game-masters)
- [Recent Changes](#recent-changes)
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

**Compatibility:** Foundry V14 · System version 3.0.0

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

## Quick Dice Roller

A standalone ORE dice roller is available directly from the chat sidebar — the d20 icon button in the chat controls bar, next to the roll mode and speaker selectors.

Click the button to open a dialog where you can set a roll label, pool size, difficulty, bonus and penalty dice, Expert Die face, and Master Die. A live pool preview updates as you adjust inputs. On confirm, the dice are rolled through the full ORE engine and posted as a standard chat card with sets, waste, and hit locations — identical to rolls made from a character sheet.

The quick roller is useful for GMs rolling arbitrary pools (gate strength, environmental challenges, NPC checks) and players making rolls that don't map neatly to a character sheet stat. It resolves the speaker from the currently selected token or assigned character.

Also available from macros: `game.reign.openQuickDiceRoller()`

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

**Maneuvers** — the full ORE maneuver list is available from the roll dialog during combat. Automated maneuvers (Charge, Disarm, Knockout, Trip, Threaten, Display Kill, Pin, Restrain, Stand, Shove, Slam, Strangle, Iron Kiss, Redirect, Submission Hold) resolve directly from the roll result and apply effects to targeted tokens via chat card buttons. Complex narrative maneuvers (Feint, Wait, Disfiguring Strike, Formation Charge) post rules text and a GM resolution button.

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

**Dodge** — Coordination + Dodge. A successful set becomes Gobble Dice — one Gobble Die per die in the set. Each Gobble Die can cancel one opposing die from an attacker's set, provided the Gobble Die's face is equal to or higher than the opposing die's face. Removing a die from a set breaks it if it falls below two. A single successful dodge can therefore cancel multiple attacks. The system prompts selection when multiple attacker sets are present. The Redirect maneuver is available from the Dodge roll dialog.

**Dive for Cover** — after a successful Dodge, a "Dive for Cover" button appears on the chat card. Clicking it sacrifices all Gobble Dice in exchange for location-based immunity behind an obstacle. The character is downed but protected.

**Parry** — uses the best equipped weapon or shield. A shield adds its Parry Bonus to the pool. The system checks whether the character has an appropriate weapon for the attack type and applies unarmed parry redirect if bare-handed.

**Counterspell** — Knowledge + Counterspell. Produces Gobble Dice against incoming magical attacks. A "Counter This Spell" button appears on spell chat cards, applying the counterspeller's Gobble Dice against the caster's sets.

**Shield Coverage** — before each round, assign which locations the shield protects via the Shield Coverage button. Declared coverage takes priority over the default arm location for that round.

### Gobble Dice

When a defender rolls Dodge, Parry, or Counterspell successfully, the dice in their set become Gobble Dice — one per die in the set. Each Gobble Die can cancel one die from an attacker's set, as long as the Gobble Die's face is equal to or greater than the target die's face. Cancelling a die from a set breaks it if it falls below two. Because each Gobble Die acts individually, a single successful defense can break multiple attacks in the same round. When multiple attacker sets are present, the system prompts the defender to assign their Gobble Dice.

### Maneuvers

The system automates fifteen combat maneuvers across two tiers.

**Tier 1 — Fully Automated:** The chat card resolves the maneuver outcome from the roll result and provides an "Apply" button that sets the appropriate status effect on the targeted token.

Positional maneuvers: **Pin** (applies Pinned), **Restrain** (applies Restrained), **Stand** (clears Prone), **Shove** (grants +1d to next Trip/Slam against that target), **Slam** (applies Prone, Width 3+ adds Shock).

Damage-modifying maneuvers: **Strangle** (initial Shock to head, Maintain button for continuation damage), **Iron Kiss** (set up guaranteed Width×10 attack, execute next round), **Redirect** (redirect gobbled attacks to other enemies), **Submission Hold** (Shock to held limb; target can wrench free for Killing).

Standard combat maneuvers: **Charge**, **Disarm**, **Knockout**, **Trip**, **Threaten**, **Display Kill** — all resolve Width-based outcomes automatically.

**Tier 2 — GM Resolution:** **Feint**, **Wait**, **Disfiguring Strike**, **Formation Charge** — the chat card posts rules text and a GM-only "Resolve" button that creates a resolution record in chat.

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

When a character reaches Perfect Attunement, the system offers to create a labelled Active Effect for tracking mechanical attunement benefits (immunities, resistances, etc.).

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
- **Roll Sense + Eerie** button — appears on successful spells at Intensity 2+, opening a pre-configured detection roll dialog for any nearby character
- **Counter This Spell** button — applies Counterspell Gobble Dice against the caster's sets
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

## Creatures & Bestiary

### Creature Mode

The threat sheet supports a **Creature Mode** toggle for individual monsters, beasts, and named adversaries — distinct from mob/minion hordes. In creature mode, the sheet displays custom hit locations with individually configurable wound boxes and AR, creature-specific attributes and skills, and named attacks with damage formulas.

#### Skills

The Skills section has a **+** button to add skills via a dialog. The dialog offers a dropdown of all predefined combat skills (Fight, Bite, Claw, Kick, Ram, Constrict, Trample, Grapple, Dodge, Parry, Athletics, Climb, Swim, Run, Stealth) and perception skills (Hearing, Sight, Scrutinize, Smell), with already-added skills filtered out. A "Custom" option allows adding homebrew skills by name. Values can be set to a number (e.g. 3), **ED** (Expert Die), or **MD** (Master Die).

Each skill row has a cog button to edit the value and an × button to delete the skill. Skills support a dice count combined with an optional Expert Die or Master Die (e.g. Fight 3 + ED, or Bite 4 + MD), matching how character skills work in the rules. Skills are auto-paired with the correct attribute (Body for combat skills, Coordination for agility skills, Sense for perception skills) and displayed in a sorted, labelled two-column layout.

#### Attacks

The Attacks section has a **+** button to add a new attack with default values. Each attack row has a cog button that toggles an inline config panel where you can edit the attack's name, paired attribute (Body/Coordination/Sense), skill key, damage formula, slow rating, and notes. All fields auto-save on change. Attacks can be rolled directly from their row, and deleted via the × button.

Special creature mechanics supported via flags include: free Gobble Dice per round (big cats), charge accumulation (rhinos), constriction holds (boas), morale attacks (elephants), and venom delivery. Per-combat flags are cleaned up automatically when a combat encounter ends.

### Bestiary Compendium

The system ships with a **Bestiary — Creatures** compendium pack containing representative creatures built using the full creature mode schema.

---

## Hazards

### The Hazard Roller

A GM-only **Hazard Roller** is accessible from the Token Controls toolbar (skull-and-crossbones icon). It opens a tabbed dialog covering three hazard types:

**Falling** — set the fall height. The system calculates damage per RAW and applies it to targeted tokens.

**Fire** — set the fire intensity. Damage is applied through the standard damage infrastructure.

**Poison** — select a poison from the world item list. The system displays the poison's potency, major and minor effects, and delivery method. A "Resist" button prompts targeted tokens to roll the appropriate resistance check (typically Body + Vigor) against the poison's difficulty.

### Poison Items

Poisons are a dedicated item type tracking potency, major and minor effects, difficulty, and delivery method. Weapons can be flagged as poisoned with a reference to a specific poison item — when the weapon hits, the poison's effects are available for application.

The system ships with a **Poisons** compendium pack containing representative poison items.

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

The biography output includes a "Gained:" summary for each life path stage and a final character summary block.

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

### One-Roll Table Validation

When the charactermancer loads a One-Roll Table JSON, it validates the file against the expected schema. Blocking errors (missing required keys, parse failures) halt loading and post a structured red error card to chat. Advisory warnings (missing optional keys like `schools`, malformed entries) post an amber card but allow loading to continue.

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
- **Half Recovery (RAW default)** — Shock taken during combat is halved, rounded up
- **Full Recovery** — all combat Shock clears (heroic house rule)
- **No Automatic Recovery** — GM handles recovery manually (lethal house rule)

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
| Sorcery | `system.modifiers.skills.sorcery.pool` | Bonus dice to Sorcery pool |
| Sorcery | `system.modifiers.skills.sorcery.bonusWidth` | Bonus Width on spell rolls |
| Sorcery | `system.modifiers.skills.sorcery.minHeight` | Minimum Height requirement |
| Sorcery | `system.modifiers.skills.sorcery.squishLimit` | Width cap on spell sets |
| Sorcery | `system.modifiers.skills.sorcery.bonusTiming` | Initiative bonus on spell rolls |
| Action Economy | `system.modifiers.actionEconomy.ignoreMultiPenaltySkills` | Exempt skills from multi-action penalty (comma-separated) |
| Hit Location | `system.modifiers.combat.forceHitLocation` | Override rolled hit location |
| Hit Location | `system.modifiers.combat.shiftHitLocationUp` | Shift hit location up N steps |
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

The system ships with seven compendium packs:

| Pack | Contents |
|---|---|
| Weapons & Armor | Standard melee, ranged weapons and armour types |
| Gear & Equipment | General equipment, tools, provisions |
| Martial Techniques | Technique items for martial paths |
| Spells & Esoteric Disciplines | Spell and discipline items |
| Company Assets | Asset items for company sheets |
| Bestiary — Creatures | Representative creatures using the full creature mode schema |
| Poisons | Poison items with potency, effects, and delivery methods |

### Macro API

The `game.reign` global exposes core functions for macro use:

| Function | Description |
|---|---|
| `openQuickDiceRoller()` | Open the standalone ORE dice roller dialog |
| `parseORE(results)` | Parse an array of d10 results into ORE sets and waste |
| `calculateInitiative(sets, ...)` | Calculate ORE initiative from parsed sets |
| `applyDamageToTarget(...)` | Apply damage to targeted token |
| `consumeGobbleDie(msg, height)` | Consume a Gobble Die from a defense message |
| `diveForCover(msg)` | Execute Dive for Cover from a Dodge message |
| `applyItemEffectsToTargets(uuid)` | Transfer Active Effects from a spell/item to targets |
| `declareAim(actor)` | Declare the Aim maneuver for a character |
| `assignShieldCoverage(actor)` | Open the Shield Coverage assignment dialog |

---

## Recent Changes

### v3.0.1 — Creature Sheet UX

Creature skill management — skills can now be added, edited, and deleted directly from the creature sheet via dialogs and inline buttons. Attack editing — each attack row gains a cog-toggle config panel for editing name, attribute, skill, damage formula, slow rating, and notes inline. GM Toolbar bugfix — creature-mode Token Peek pool preview now correctly reads skill values (was silently ignoring all skill dice).

### v3.0.0 — Creatures, Hazards & Poisons

Creature Mode added to the threat sheet — a full bestiary system with custom hit locations, creature-specific attributes and skills (including ED/MD support), named attacks, and special mechanics (free Gobble Dice, charge accumulation, constriction, morale attacks, venom). Hazard Roller added as a GM-only toolbar button with tabbed dialogs for falling, fire, and poison hazards. Poisons added as a dedicated item type with potency, effects, difficulty, and delivery tracking. Weapons gain poison reference fields. Bestiary and Poisons compendium packs added.

---

## Credits & Legal

**System:** Llew ap Hywel · [GitHub](https://github.com/arawnlpdebug/foundryreign)

**Reign 2nd Edition** is the work of Greg Stolze, published by Arc Dream Publishing. This system is unofficial and fan-made. It contains no reproduced text, tables, or content from any published Reign product. All mechanical implementation is original. All default magical schools are original generic archetypes.

This system is released under the **MIT License**. You are free to fork, modify, and redistribute it under the same terms.

Foundry Virtual Tabletop is a product of Foundry Gaming LLC. This system is not affiliated with or endorsed by Foundry Gaming LLC or Arc Dream Publishing.