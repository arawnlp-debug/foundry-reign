# Reign: Realities of Lords and Leaders — Changelog

---

## v3.0.1 — Creature Sheet UX

### UX — Creature Skill Management
**Files:** `templates/actor/threat-sheet.hbs`, `scripts/sheets/threat-sheet.js`, `styles/actor-sheet.css`

The Skills section on the creature mode threat sheet now supports full add/edit/delete from the sheet UI.

- **Add skill** — the + button in the section header opens a dialog with a dropdown of all predefined combat and perception skills (already-added skills are filtered out), plus a "Custom" option for homebrew skill names. Set dice count, and optionally toggle Expert Die or Master Die.
- **Edit skill** — the cog button on each skill row opens a dialog to change the dice count and ED/MD toggles.
- **Delete skill** — the × button on each skill row removes the skill.
- The section now always displays (previously hidden when no skills existed), showing an empty-state prompt with the + button.

### DATA — Creature Skill Format Change
**Files:** `scripts/sheets/threat-sheet.js`, `scripts/helpers/migration.js`

Creature skills are now stored as structured objects `{ value, expert, master }` instead of flat values (number / "ED" / "MD"). This allows a creature to have dice in a skill AND an Expert or Master Die simultaneously (e.g. Fight 3 + ED), matching how character skills work in the rules.

A migration step in `migrateThreat()` converts any legacy flat-format skills to the new structured format. All skill-reading code uses a `normalizeCreatureSkill()` helper that handles both old and new formats gracefully, so creatures work correctly even before migration runs.

### UX — Creature Attack Editing
**Files:** `templates/actor/threat-sheet.hbs`, `scripts/sheets/threat-sheet.js`, `styles/actor-sheet.css`

Each attack row now has a cog button that toggles an inline config panel (same pattern as hit locations). The config panel exposes editable fields for: Name, Attribute (Body/Coordination/Sense dropdown), Skill (text key matching a creature skill), Damage formula, Slow rating, and Notes. All fields auto-save via `submitOnChange`.

### BUG — GM Toolbar Creature Pool Calculation
**File:** `scripts/gm-toolbar.js`

The Token Peek pool preview for creature-mode threats was reading `creatureSkills?.[skill]?.value`, but `creatureSkills` stores values directly as numbers/"ED"/"MD", not as `{value: N}` objects. The skill contribution was silently always 0. Fixed to read the value directly and correctly count ED/MD as +1 die.

---

## v2.8.0 — Quality of Life

### F1 — Counterspell Integration

**Files:** `templates/chat/ore-roll.hbs`, `scripts/reign.mjs`

A counterspell gobble button (ban icon, magic blue) is added to the secondary action row of each set on spell chat cards. It works identically to the existing Dodge/Parry gobble button — clicking it calls `consumeGobbleDie(msg, heightToRemove)` against that set's Height, using the counterspeller's already-rolled Gobble Dice. No new roll dialog is opened; the mechanic is the same as Dodge and Parry per RAW.

The existing Dodge/Parry gobble button (shield icon) is preserved on spell cards but is now conditionally shown — it only appears when the spell item has `dodgeable` or `parriable` set to true. On physical attack cards the shield gobble button is unchanged and always visible. The counterspell gobble button never appears on physical attack cards.

---

### F2 — One-Roll Table Validation

**File:** `generators/charactermancer.js`

`_loadOneRollTable` previously failed silently on malformed JSON — a parse error produced only a notification, and a structurally valid but incomplete table (missing `sets` or `waste`) would load and cause downstream errors in character generation.

The method is rewritten with a two-tier validation layer:

**Errors (blocking):** Missing `tableName`, `sets`, or `waste` keys; `sets` is not an object; JSON parse failure. On any error, loading halts and a structured red error card posts to chat listing every problem found, with the file path and an instruction to fix and reload.

**Warnings (advisory):** No `schools` key (school picker will be hidden); malformed set entries (wrong shape for life path results). Warnings post an amber card to chat but loading continues normally.

Two new helper methods: `_postTableValidationError(path, errors, warnings)` and `_postTableValidationWarning(path, warnings)`. Both post structured chat cards using the existing card style classes.

---

### F3 — Eerie Detection Prompt

**Files:** `templates/chat/ore-roll.hbs`, `scripts/reign.mjs`, `combat/character-roller.js`, `templates/dialogs/roll-character.hbs`

When a spell fires successfully at Intensity 2 or higher, a "Roll Sense + Eerie (Xft)" button appears alongside the Counter This Spell button. Clicking it opens the Sense + Eerie roll dialog pre-configured with the spell's detection radius and name. The dialog banner notes the RAW rule: any match succeeds — there is no Width or Height threshold for detection. The character is either within range or they are not.

Detection radius values are the canonical RAW table (Intensity 1 = none, 2 = 5 ft, 3 = 10 ft, 4 = 50 ft, 5 = 1,000 ft, 6 = 1 mile, 7 = 10 miles, 8 = 25 miles, 9 = 50 miles, 10 = 100 miles) already computed by the existing detection radius system and passed through `spellDetectionRadius` on the chat card flags.

---

### F4 — Quick Dice Roller

**Files:** `scripts/reign.mjs`, `styles/chat.css`, `lang/en.json`

A standalone ORE dice roller button is injected into the chat sidebar controls bar via a `renderChatLog` hook. The button (d20 icon, blood-red accent) sits alongside the existing roll mode and speaker selectors, providing one-click access to an arbitrary dice pool roll without needing a character sheet open.

Clicking the button opens a `reignDialog` with the following fields: roll label (free text), pool size (d10 count), difficulty (minimum Height), bonus dice, penalty dice, Expert Die face (0 = none), and a Master Die checkbox. A live pool preview at the top of the dialog reacts to all inputs in real time, using `calculateOREPool` from `character-roller.js` to display the effective dice count with special dice annotations and cap warnings.

On confirm, normal dice are rolled via `new Roll(Nd10).evaluate()`, the Expert Die face is appended if active, and if a Master Die is enabled a second dialog prompts the user to assign its face value (showing the current results for context). The final results array is passed through `generateOREChatHTML` to produce a full ORE chat card with sets, waste, hit locations, and difficulty filtering — identical to cards produced by the character sheet roller.

The speaker is resolved from the currently selected token, the user's assigned character, or falling back to the user's name. The `Roll` instance is attached to the message for Dice So Nice integration.

The function is also exposed via `game.reign.openQuickDiceRoller()` for macro use. All UI strings are localised under the `REIGN.QR*` namespace.

---

## v2.6.0 — Presentation Pass

### D1 — Sheet Consistency

**Files:** `templates/actor/threat-sheet.hbs`, `templates/actor/company-sheet.hbs`, `lang/en.json`

Threat sheet: all legacy `cm-*` utility class references replaced with their `reign-*` equivalents throughout `threat-sheet.hbs`. The `cm-*` classes remain defined in `actor-sheet.css` for backward compatibility but are no longer used by any system template. Header layout, stat blocks, and action rows now use the shared utility system consistently with the character sheet.

Company sheet: profile image gains `reign-circle` for visual parity with the character sheet. Header-top gets `reign-p10` padding. Two hardcoded English strings ("Company XP", "War Chest (Pledged Dice)") replaced with locale keys `REIGN.CompanyXP` and `REIGN.CompanyWarChest`.

---

### D2 — Dark Mode & CSS Variable Audit

**Files:** `styles/variables.css`, `styles/chat.css`, `styles/actor-sheet.css`, `styles/base.css`

Fourteen new semantic colour variables defined with full light and dark mode values, covering all categories introduced in v2.3.0–v2.5.0 that previously used hardcoded hex values:

| Variable | Light | Dark | Use |
|---|---|---|---|
| `--reign-color-teal` | `#00695c` | `#009688` | Success confirmations, manoeuvre effects |
| `--reign-color-teal-light` | `#00897b` | `#00bfa5` | Teal borders, hover states |
| `--reign-color-teal-border` | `#4db6ac` | `#00897b` | Teal card borders |
| `--reign-bg-teal` | `#e0f2f1` | `#004d40` | Teal card backgrounds |
| `--reign-bg-danger` | `#ffebee` | `#3b1010` | Danger/failure backgrounds |
| `--reign-color-danger` | `#c62828` | `#ef5350` | Danger text |
| `--reign-color-danger-border` | `#ef5350` | `#ff1744` | Danger borders |
| `--reign-bg-warn` | `#fff3e0` | `#3e2723` | Warning backgrounds |
| `--reign-color-warn-border` | `#ffb74d` | `#d84315` | Warning borders |
| `--reign-bg-info` | `#e3f2fd` | `#001e36` | Info/gobble backgrounds |
| `--reign-color-blue-dark` | `#1565c0` | `#42a5f5` | Info text |
| `--reign-color-info-border` | `#90caf9` | `#0d47a1` | Info borders |
| `--reign-color-amber` | `#c88b00` | `#e6a800` | Mid-intensity spells, temporary attunement |
| `--reign-color-arcane` | `#4a1a6e` | `#9c6dbf` | Extreme-intensity spells, esoteric power |

Approximately 35 hardcoded hex values replaced across `chat.css`, `actor-sheet.css`, and `base.css`. `.intensity-mid` now uses `--reign-color-amber`; `.intensity-extreme` uses `--reign-color-arcane` and `--reign-color-arcane-light`. All button variants (magic, heal, morale, manoeuvre, company), banner states, die faces, tag colours, wound banners, and the gobble dice block are fully variablised. The token HUD status wheel (9 Reign-specific statuses in a 3×3 CSS grid) is covered.

---

### D+ — Redirect UX (Dodge Roll Dialog)

**Files:** `combat/character-roller.js`, `templates/dialogs/roll-character.hbs`, `lang/en.json`

Redirect was previously inaccessible from the roll dialog — the manoeuvre selector was gated on `isCombatRoll` which excluded dodge rolls. A separate `isDodgeRoll` flag now identifies Dodge skill rolls, passing a filtered `dodgeManeuverOptions` array (only manoeuvres with `poolType: "dodge"`) to the dialog template. A dedicated manoeuvre block renders below the standard combat block showing only dodge manoeuvres, with a hint line noting the −2d penalty. Selecting Redirect applies the penalty automatically via the existing manoeuvre wiring. All downstream systems (pool breakdown, chat card outcome, Apply: Redirect button) function without further changes.

---

### D+ — Submission Hold Limb UX

**File:** `combat/character-roller.js`

When Submission Hold is selected from the manoeuvre dropdown, the Called Shot selector is filtered in-place: head and torso options (heights 7–10) are disabled and hidden, leaving only arm and leg locations (1–6) plus None. If the current selection is a head or torso height, it defaults to Right Arm High (6). A tooltip on the select communicates the restriction. All options are restored when switching away from Submission Hold. This prevents the post-roll "requires a limb" warning from firing in normal play.

---

### D3 — Charactermancer Biography Formatting

**File:** `generators/charactermancer.js`

One-roll character creation biography output is restructured. Previously a flat join of description strings; now each life path stage entry includes a compact "Gained:" line listing all mechanical awards from that stage (attributes, skills, wealth, advantages, equipment, and esoterica). A `_buildFinalBiography()` method replaces the inline `.join` call in `_onAcceptFate`, appending a "--- Character Summary ---" block at the end of the biography showing final wealth, advantages, problems, equipment, martial paths, esoterica, and spells. Stages without a `description` field in the one-roll table remain silent in the biography — gains from those stages are still applied to the character.

Example output:

```
**Farmstead Childhood**: You grew up working the land in a quiet valley.
Gained: +1 Body, +1 Endurance, +1 Wealth

**Trade Caravan**: A merchant hired you as a guard across three seasons of road.
Gained: +1 Fight, +1 Scrutinize, Sword

*(Special)*: A veteran soldier took an interest and taught you a fighting style.

--- Character Summary ---
Wealth: 3
Advantages: Iron Stomach
Equipment: Sword, Leather Armour
```

---

### Bug Fix — `squishLimit` Sentinel Value

**File:** `combat/character-roller.js`

`squishLimit` was initialised to `1` when no Active Effect set it, rather than `0`. The chat engine treats `0` as "no cap" and any positive value as an active Width cap — so the default of `1` was silently capping every set above Width 1 and zeroing all manoeuvre bonus damage (Charge, Knockout, Slam, etc.) since the AE system launched. Fixed to `|| 0`.

---

### Bug Fix — `models.js` `ignoreMultiPenaltySkills` Field Type

**File:** `system/models.js`

`ignoreMultiPenaltySkills` was defined as `ArrayField(StringField)` but the AE dictionary registered it as `mode: Override` (5) with `isString: true`, and the roller treated it as a comma-separated string. A Foundry Override AE cannot write a clean value into an ArrayField. Corrected to `StringField({ initial: "" })`. The defensive array/string parsing in `character-roller.js` handles any legacy actor data that stored an array.

---

## v2.5.0 — Combat Manoeuvre Automation

### C1 — Positional & Status Manoeuvres

**Files:** `combat/maneuvers.js`, `combat/chat.js`, `combat/damage.js`, `scripts/reign.mjs`, `combat/ore-combat.js`, `combat/character-roller.js`, `templates/chat/ore-roll.hbs`, `styles/chat.css`, `styles/base.css`, `lang/en.json`

Five manoeuvres promoted from Tier 2 to Tier 1 with automated status effect application via a teal "Apply: X" button on their chat cards:

| Manoeuvre | Effect |
|---|---|
| **Pin** | Applies `pinned` status to target; posts escape roll instructions |
| **Restrain** | Applies `restrained` status to target |
| **Stand** | Clears `prone` from the rolling actor; restores dodge eligibility |
| **Shove** | Sets `shoveBonusAgainst` combatant flag with the target token ID; grants +1d to the attacker's next Trip or Slam against that specific target this round |
| **Slam** | Applies `prone` to target; Width 3+ posts a chat note for additional Shock |

`pinned` and `restrained` added to Reign's curated status effect list. Token HUD stripped to 9 Reign-specific statuses and forced into a 3×3 CSS grid via `base.css`. Shove bonus is target-specific (flag stores token ID), consumed on use, and cleared by `nextRound()`.

---

### C2 — Damage-Modifying Manoeuvres

**Files:** `combat/maneuvers.js`, `combat/chat.js`, `combat/damage.js`, `scripts/reign.mjs`, `combat/ore-combat.js`, `templates/chat/ore-roll.hbs`, `lang/en.json`

Four manoeuvres promoted from Tier 2 to Tier 1 with per-round hold tracking via combatant flags:

| Manoeuvre | Implementation |
|---|---|
| **Strangle** | "Apply: Strangle" fires initial Shock to Head; "Maintain Strangle" button applies continuation Shock next round without rolling |
| **Iron Kiss** | "Set Up" stores `ironKissSetup` flag with weapon formula and virtual Width; "Execute" fires the guaranteed Width×10 attack next round consuming the flag; flag cleared by `nextRound()` if unused |
| **Redirect** | "Apply: Redirect" opens a dialog for the incoming attack's Width, formula, hit location, and AP; damage is applied to the targeted token at the redirected Width |
| **Submission Hold** | "Apply: Hold" deals Shock to the held limb; "Wrench Free" applies self-inflicted Killing to the same location |

---

### C3 — Tier 2 GM Resolve Button

**Files:** `templates/chat/ore-roll.hbs`, `scripts/reign.mjs`

Tier 2 manoeuvre chat cards gain a dashed "GM: Resolve X" button (visible on success only, GM-restricted). Clicking it posts a confirmation message naming the manoeuvre, Width×Height, and the rolling player — providing a chat record that the GM has acknowledged and applied the narrative effect.

---

### Bug Fix — `advancedMods` Key Collision

**File:** `combat/chat.js`

`resolvedAdvancedMods = flags.advancedMods || advancedMods || {}` — a local `advancedMods` parameter was shadowing the flags value on every attack roll, silently zeroing all advanced modifiers (manoeuvre data, minHeight, squishLimit, bonusTiming) since launch. The resolution order now correctly prefers the flags value.

---

## v2.4.0 — Active Effects Phase 2

### B1 — Sorcery AE Coverage

**File:** `helpers/config.js`

Sorcery group added to `getEffectDictionary()` covering: Bonus Pool, Bonus Width, minHeight, squishLimit, bonusTiming, and `ignoreMultiPenaltySkills` (Override mode, comma-separated string).

### B2 — RAW Audit of Existing AE Paths

**File:** `helpers/config.js`

Three new AE paths added and tested end-to-end:

- `forceHitLocation` — overrides the rolled hit location for all sets on that roll
- `shiftHitLocationUp` — increments the hit location by N steps (capped at Head)
- `appendManeuvers` — adds extra manoeuvre options to the roll dialog dropdown

`squishLimit`, `bonusTiming`, and `minHeight` implemented end-to-end:
- `minHeight`: third failure condition in set evaluation ("Minimum Height N Required")
- `squishLimit`: Width capped after bonusWidth addition, `(capped N)` shown in set text
- `bonusTiming`: added to `initValue` after `calculateInitiative` in `postOREChat`

### B3 — Attunement as Active Effects

**File:** `scripts/reign.mjs`

`preUpdateActor` stashes previous `attunementStatus` into `options.previousData`. `updateActor` hook fires when status transitions to `"perfect"`, offering to create a pre-labelled AE with attunement notes pre-populated. Guards: owner only, no duplicates, correct actor type, genuine transition only.

---

## v2.3.0 — Sorcery Elevation & School System

### Sprint 4 — Sorcery Elevation

A comprehensive overhaul of the magic system across 17 files. This sprint brings the sorcery implementation into full alignment with the OneRoll Engine rules, replacing placeholder fields and free-text areas with structured, mechanical data that integrates with the roller, chat cards, and character creation.

### 4.1 Spell Item Schema Extended
**File:** `system/models.js`

`ReignSpellData` gains seven new fields, all with safe defaults so existing spell items require no manual data entry:

| Field | Type | Purpose |
|---|---|---|
| `slow` | Number | Slow rating — N rounds of preparation before the roll; a Slow 1 spell prepares one round then rolls the next |
| `duration` | String | e.g. "Width hours", "Instant", "Permanent" |
| `attunementRequired` | Boolean | Cast a temporary attunement spell first |
| `isAttunementSpell` | Boolean | This spell grants attunement, not an effect |
| `dodgeable` | Boolean | Targets may Dodge this attack spell |
| `parriable` | Boolean | Targets may Parry this attack spell |
| `armorBlocks` | Boolean | Target's AR applies against this spell |

### 4.2 Esoterica Schema Extended
**File:** `system/models.js`

`ReignCharacterData.esoterica` gains five new fields alongside the existing `sorcery`, `expert`, `master`, and `attunement` (which is preserved as the narrative notes field):

| Field | Type | Purpose |
|---|---|---|
| `schoolName` | String | e.g. "The Runewrights" |
| `schoolDomain` | String | e.g. "Metal & Permanence" |
| `schoolMethod` | String | e.g. "Inscription" |
| `schoolStat` | String | Attribute that pairs with Sorcery for this school |
| `attunementStatus` | String | `"none"` / `"temporary"` / `"partial"` / `"perfect"` |

### 4.3 Esoterica Tab — Full Redesign
**File:** `templates/actor/tab-esoterica.hbs`

The esoterica tab is rebuilt from the ground up. The single free-text attunement textarea becomes three structured panels in a redesigned left sidebar:

**Sorcery Panel** — unchanged mechanically; Sorcery score + Expert/Master dice toggles remain. The casting attributes quick-reference now highlights whichever attribute matches the character's school's associated stat.

**School Panel** — four structured fields: School Name, Domain, Method, and Associated Attribute (dropdown). Replaces the unstructured attunement textarea header. Feeds the casting attribute highlight.

**Attunement Status Panel** — four radio-button states in colour-coded badges (grey / amber / red / green), followed by a narrative notes textarea. States are: Not Attuned, Temporary, Partial, Perfect — each with a tooltip explaining the mechanical distinction from RAW.

The spell list is now grouped by school name (from each spell's `school` field). Each school group has a collapsible header showing the school name and spell count. Spell rows display:
- Rollable name with cast-spell icon
- Lock icon if `attunementRequired` is true and the character is not attuned
- Attunement-spell icon if `isAttunementSpell` is true
- Intensity badge — colour-coded by tier (1–2 smoke, 3–4 amber, 5–6 crimson, 7–10 purple)
- Slow badge with hourglass icon if `slow > 0`
- Duration column
- Effect summary

### 4.4 Spell Item Sheet — Enhanced Form
**File:** `templates/items/item-sheet.hbs`

The spell item form is reorganised from 6 fields to a full structured layout:

- **Row 1:** Intensity · Slow Rating · Casting Time · Page
- **Row 2:** Casting Stat · Pool · School · Duration
- **Row 3:** Damage Formula (full width)
- **Detection Radius:** Live-computed read-only display (e.g. "At Intensity 4, detectable within 50 feet") using the canonical RAW table
- **Spell Properties:** Checkbox row for all five flags (Attunement Required, Is Attunement Spell, Dodgeable, Parriable, Armor Blocks)
- **Effect textarea**

### 4.5 Detection Radius
**Files:** `sheets/character-sheet.js`, `sheets/item-sheet.js`

Detection radius is computed from Intensity using the canonical table from the rules (1st = none, 2nd = 5 ft, 3rd = 10 ft, 4th = 50 ft, 5th = 1,000 ft, 6th = 1 mile, 7th = 10 miles, 8th = 25 miles, 9th = 50 miles, 10th = 100 miles). It is displayed on the spell item sheet and passed to every spell in the esoterica tab context as a tooltip on the intensity badge.

### 4.6 Spell Grouping by School
**File:** `sheets/character-sheet.js`

`_prepareContext` now groups spells by their `system.school` field into `spellGroups`, sorted alphabetically with an "Other" group at the end for ungrouped spells. Each spell in context is annotated with `detectionRadius`, `intensityClass`, `isLocked`, `isAttunementSpell`, and `hasSlow` for template use without logic in HBS.

### 4.7 School Stat Highlighting
**File:** `sheets/character-sheet.js`

`schoolStat` is passed to context from `system.esoterica.schoolStat`. In the casting attributes quick-reference, the row matching the school's associated attribute receives a highlight class and a pip indicator (◆).

### 4.8 Spell Group Toggle
**File:** `sheets/character-sheet.js`

New `_onToggleSpellGroup` action handler and `toggleSpellGroup` registered action. Clicking a school group header toggles the `collapsed` class, which CSS uses to hide/show spell rows via the chevron animation.

### 4.9 Enhanced Spell-to-Chat
**File:** `sheets/character-sheet.js`

`_onItemToChat` is enhanced for spell items. Posting a spell to chat now includes: school, intensity, pool, duration, slow rating, and an attunement-required indicator — all as a formatted meta bar above the effect text.

### 4.10 Roll Dialog — School Stat Default
**File:** `helpers/character-roller.js`

When rolling Sorcery directly from the esoterica stat block (not via a spell item), the roll dialog now pre-selects `system.esoterica.schoolStat` as the attribute — instead of hardcoded `"knowledge"`. A generalist with no school set still defaults to Knowledge.

### 4.11 Spell Slow Cooldown
**File:** `helpers/character-roller.js`

Spell Slow is now wired into the combatant flag system, parallel to weapon Slow. A Slow N spell sets `flags.reign.spellSlowCooldown_{itemId}` to `currentRound + N`. The pre-roll check reads this flag and blocks casting if the cooldown has not expired. Per-item flags prevent multiple slow spells from overwriting each other's cooldowns.

### 4.12 Attunement Warning
**File:** `helpers/character-roller.js`

Before the roll dialog opens for a spell with `attunementRequired: true`, if the character's `attunementStatus` is `"none"`, a notification warns the player. The roll is not blocked — the GM retains authority — but the table is informed.

### 4.13 Roll Dialog — Spell Info Banner
**Files:** `helpers/character-roller.js`, `templates/dialogs/roll-character.hbs`

Spell rolls display a summary banner above the dialog form showing: the spell's Intensity as a Width difficulty ("Width of set must equal or exceed Intensity N"), Slow preparation rounds if applicable, and visual tags for Attunement Spell and Attunement Required status.

### 4.14 Chat Card — Spell Result Block
**Files:** `helpers/chat.js`, `templates/chat/ore-roll.hbs`

A new `{{#if isSpell}}` block appears on spell roll chat cards between the sets section and the waste section. It contains:

- **Intensity check result** — "Spell Fires" (green, Width of best set equals or exceeds Intensity) or "Spell Fizzled" (red, no set wide enough)
- **Detection radius tag** — shown for Intensity 2+ only, with an eye icon
- **Slow rating tag** — with hourglass icon if applicable
- **School name tag** — if the spell has a school
- **Duration tag** — if set
- **Interaction flags** — Dodgeable, Parriable, Armor Blocks shown as labelled tags
- **Attunement Spell marker** — if this is an attunement-granting spell

### 4.15 Spell Slow in Combat Chat
**File:** `helpers/chat.js`

`postOREChat` now handles spell Slow cooldown alongside weapon Slow. After a Slow spell is rolled in combat, the combatant's per-item flag is set and a notification posts to chat indicating when the spell is next available.

### 4.16 Spell Metadata in Chat Projection
**File:** `helpers/chat.js`

The slim `itemData` projection passed into ChatMessage flags is extended with all new spell fields: `slow`, `duration`, `school`, `attunementRequired`, `isAttunementSpell`, `dodgeable`, `parriable`, `armorBlocks`. These are used by `generateOREChatHTML` to populate the spell result block.

### 4.17 Numeric Coercion for New Fields
**Files:** `sheets/character-sheet.js`, `sheets/item-sheet.js`

`_processSubmitData` in both sheets now includes `.slow` and `.castingTime` in the numeric coercion list (empty string → 0, string integer → integer). `item-sheet.js` gains its own coercion pass for all three numeric spell fields.

### 4.18 CSS — Full Sorcery Visual Language
**File:** `styles/actor-sheet.css`

All new classes added — zero inline styles:

- Intensity badges (four tiers: low/mid/high/extreme)
- Attunement status badges (four states: none/temporary/partial/perfect)
- School panel with crimson header
- Attunement panel with dark header + grid radio layout
- Spell group headers with collapse chevron
- Spell row column layout (name/pool/intensity/duration/effect)
- Lock and attunement-spell icon styles
- Slow badge
- Spell detection row and spell flags box (item sheet)
- Spell result block styles for chat cards

### 4.19 Spell Dialog Banner CSS
**File:** `styles/dialogs.css`

New `.reign-spell-dialog-*` classes for the roll dialog spell info banner.

### 4.20 `.reign-hidden` Utility Class
**File:** `styles/base.css`

Added `.reign-hidden { display: none; }`. Used to replace two pre-existing inline `style="display: none;"` occurrences on the `#customKeyGroup` element in `character-sheet.js` and `item-sheet.js`. The JS toggle is updated to use `classList.add/remove("reign-hidden")`.

### 4.21 Locale Strings
**File:** `lang/en.json`

30+ new locale keys added covering:
- Attunement status labels and descriptions
- School panel field labels and placeholders
- Spell property flag labels
- Detection radius label
- Spell chat result strings (fired, fizzled, detection, slow)
- Charactermancer school picker labels, description, and fallback messages
- Empty-state messages

---

### Sprint 5 — Magic School System

### 5.1 Schools in the One-Roll Table JSON
**File:** `data/oneroll-default.json`

A new top-level `schools` array is added to the One-Roll Table JSON format, sitting between `sets` and `waste`. This means a world running a custom JSON (via the **Available One-Roll Tables** setting) automatically gets its own school list. If a JSON omits the `schools` key, the school picker gracefully hides itself.

Each school entry:
```json
{
  "id": "unique-id",
  "name": "Display Name",
  "domain": "What the magic influences",
  "method": "How spells are cast",
  "associatedStat": "knowledge",
  "description": "One or two sentences of flavour.",
  "attunementNote": "What physical or psychological changes attunement brings."
}
```

The default JSON ships with eight original Arthurian/high-fantasy schools: **The Runewrights** (Inscription / Knowledge), **The Stormcallers** (Chanting / Command), **The Veilwalkers** (Breath & Stillness / Sense), **The Greenmantle** (Speaking / Charm), **The Ashbinders** (Dance / Coordination), **The Ironwardens** (Ritual Scarification / Body), **The Moonspeakers** (Celestial Observation / Knowledge), **The Deepreaders** (Touch / Sense). These are original generic archetypes and contain no content reproduced from any published source.

### 5.2 School Picker in Charactermancer
**Files:** `generators/charactermancer.js`, `templates/apps/charactermancer.hbs`, `styles/charactermancer.css`

When a character has any Sorcery investment (`draft.sorcery.value > 0`), a school picker panel appears immediately below the sorcery box in both One-Roll and Point Buy creation paths.

The picker:
- Loads schools from the primary table JSON path (via the existing `oneRollTables` setting)
- Shows a responsive card grid — each card displays the school name, associated stat (highlighted in the school's colour), method, and domain
- Shows a selected-school summary strip with description and attunement note
- Clicking a selected school deselects it (enabling generalist sorcerers with no school)
- Degrades gracefully: if the JSON has no `schools` key, a message explains how to add one

### 5.3 School Applied on Character Creation
**File:** `generators/charactermancer.js`

`_onFinishCharacter` writes the chosen school's fields to the actor:
- `system.esoterica.schoolName`
- `system.esoterica.schoolDomain`
- `system.esoterica.schoolMethod`
- `system.esoterica.schoolStat`
- `system.esoterica.attunement` (pre-seeded with the school's `attunementNote` as a starting prompt)

### 5.4 School Cleared on Reset
**File:** `generators/charactermancer.js`

`draftCharacter.school` is reset to `null` in three places: when a one-roll character is re-rolled, when sorcery is decremented to zero in point buy, and when the one-roll state is fully reset.

---

## Earlier Versions

### Sprint 3 — Chat Message Optimization

### 3.1 Slimmed chat flag `itemData`
**File:** `helpers/chat.js`

Replaced `item.toObject()` (which serialized the entire item including notes HTML, description, and effect arrays) with a minimal projection containing only the fields actually consumed by chat cards and the damage applicator.

---

### Sprint 2 — DRY Extraction & Architecture

### 2.1 Centralized hit location constants
**File:** `helpers/config.js`

Added three frozen constants — `HIT_LOCATIONS`, `HIT_LOCATION_LABELS`, `HIT_LOCATION_SHORT_LABELS` — replacing 8 inline array literals across `character-sheet.js` and `damage.js`.

### 2.2 ScrollPreserveMixin
**File:** `helpers/scroll-mixin.js` *(new)*

Extracted the identical `_replaceHTML` scroll-preservation block into a single mixin applied to all 7 sheet/app classes.

### 2.3 Centralized effect dictionary
**File:** `helpers/config.js`

Added `getEffectDictionary()` and `getItemEffectExtras()`. Updated all consuming sheets.

### 2.4 Extracted `commitHealth()` utility
**File:** `combat/damage.js`

Shared health-commit function replacing 4 identical inline blocks.

### 2.5 Unified threat damage handling
**File:** `combat/damage.js`

Extracted `applyThreatDamageInternal()`, reducing ~100 lines of duplication.

### 2.H Faction dashboard instance tracking
**File:** `apps/faction-dashboard.js`

Replaced manual instance tracking with `static syncAll()` derived from `ui.windows`.

---

### Sprint 1 — Critical Bug Fixes

### 1.1 Company conquest reward uses pre-damage size
**File:** `combat/company-damage.js`

The `targetSize` calculation was running after the update call. Moved above the update so conquest reward tiers compare against pre-damage strength.

### 1.2 Shock recovery now respects preCombatShock snapshot
**File:** `sheets/character-sheet.js`

The Recover Shock button was halving all current shock. Fixed to delegate to `performPostCombatRecovery()`, which only heals shock sustained during the current fight.

### 1.3 Double-deletion bug in custom skills and moves
**File:** `sheets/character-sheet.js`

Both delete handlers were performing two sequential deletions. Removed the redundant `deepClone` + replace path; only the V14-correct `_del` / `-=` operator path remains.