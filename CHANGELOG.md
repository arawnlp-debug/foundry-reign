# Reign: Realities of Lords and Leaders — Changelog

---

## Sprint 4 — Sorcery Elevation

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

## Sprint 5 — Magic School System

A setting-configurable magical school registry. Schools are defined in the One-Roll Table JSON file, not in code — different worlds load different schools automatically.

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

## Sprints 1–3

See the Sprint 1–3 section below for earlier changes covering critical bug fixes, DRY extraction, and chat message optimisation.

---

## Sprint 3 — Chat Message Optimization

### 3.1 Slimmed chat flag `itemData`
**File:** `helpers/chat.js`

Replaced `item.toObject()` (which serialized the entire item including notes HTML, description, and effect arrays) with a minimal projection containing only the fields actually consumed by chat cards and the damage applicator.

---

## Sprint 2 — DRY Extraction & Architecture

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

## Sprint 1 — Critical Bug Fixes

### 1.1 Company conquest reward uses pre-damage size
**File:** `combat/company-damage.js`

The `targetSize` calculation was running after the update call. Moved above the update so conquest reward tiers compare against pre-damage strength.

### 1.2 Shock recovery now respects preCombatShock snapshot
**File:** `sheets/character-sheet.js`

The Recover Shock button was halving all current shock. Fixed to delegate to `performPostCombatRecovery()`, which only heals shock sustained during the current fight.

### 1.3 Double-deletion bug in custom skills and moves
**File:** `sheets/character-sheet.js`

Both delete handlers were performing two sequential deletions. Removed the redundant `deepClone` + replace path; only the V14-correct `_del` / `-=` operator path remains.
