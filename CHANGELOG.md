# Reign: Realities of Lords and Leaders — Changelog

---

## v3.2.0 — Declaration System & Combat Round Improvements

### ITEM-1 — Slow Weapon Ready Notification
**File:** `scripts/combat/ore-combat.js`

At the start of each round, `nextRound()` now calls `_notifySlowReady()` before advancing the round counter. This method iterates all combatants and checks:

- **Weapon slow** — `flags.reign.slowCooldown` on the combatant. If the value equals the outgoing round number, the weapon is unblocked in the new round. A private whisper is sent to all active owning users with the weapon name.
- **Spell slow** — all `flags.reign.spellSlowCooldown_<itemId>` flags on the combatant. If any value equals the outgoing round, the spell is ready to cast. Each matching spell is resolved by item ID to provide the spell name in the whisper.

Multiple ready items for the same actor are batched into one message. The whisper uses the `⚔ Combat` speaker alias and the `reign-chat-card` class for visual consistency with the shield coverage reminder.

Timing: `_notifySlowReady()` is called before `super.nextRound()` so that `this.round` still refers to the outgoing round at check time. The block condition in `character-roller.js` is `game.combat.round <= cooldownUntil`, so a weapon with `cooldownUntil === outgoingRound` is blocked this round and unblocked in the next — exactly when the notification fires.

---

### ITEM-8 — Declaration System
**Files:** `scripts/reign.mjs`, `scripts/combat/ore-combat.js`, `scripts/helpers/chat.js`, `templates/chat/ore-roll.hbs`, `scripts/helpers/character-roller.js`, `scripts/apps/gm-toolbar.js`

A full declaration phase system built around a world-level setting: `reign.declarationMode` (`"simple"` | `"advanced"`). Default is `"simple"` — all existing worlds are unaffected on update.

#### ITEM-8 — Setting
**File:** `scripts/reign.mjs`

`reign.declarationMode` registered as a world-scoped choice setting in the `init` hook alongside existing Reign settings. Appears in Foundry's Configure Settings panel under the Reign heading.

#### ITEM-8 — Auto-Declaration on Roll (Both Modes)
**File:** `scripts/helpers/chat.js`

A new block added to `postOREChat` after the combatant initiative write. If combat is active, the actor has combatants, and the current phase is `"declaration"`, any combatant belonging to the actor that is not yet marked `declared` is immediately set to `declared: true` via a batched `updateEmbeddedDocuments` call. This closes the gap where a player could roll during declaration phase and still appear undeclared in the tracker. Applies in both simple and advanced modes. A roll with no sets (a miss) is still a declaration — the character committed to an action.

#### ITEM-8 — Flag Clearing in nextRound()
**File:** `scripts/combat/ore-combat.js`

Two new fields added to the batch combatant update in `nextRound()`:
- `flags.reign.declarationText` — cleared to `""` each round
- `flags.reign.declarationAction` — cleared to `null` each round

These are no-ops in simple mode since the flags are never written.

#### ITEM-8 — Simple Mode (renderCombatTracker)
**File:** `scripts/reign.mjs`

When `declarationMode === "simple"`, the `renderCombatTracker` hook renders the existing toggle behaviour character-for-character. No change to simple mode behaviour.

#### ITEM-8 — Advanced Mode: Declaration Dialog
**File:** `scripts/reign.mjs`

`_openDeclarationDialog(combatant, combat)` — a module-level async function called when the Declare button is clicked in advanced mode.

**Actor-type branching:** Three flags are derived at open time — `isCharacter`, `isCreature` (threat + creatureMode), and `isMob` (threat, not creatureMode) — and gate all subsequent behaviour. Characters use item-based equipped weapons. Creatures use `system.creatureAttacks`. Mobs have no weapon selector.

**Action type options** are populated per actor type:
- All types: No Roll / Narrative
- All types (where applicable): Attack, Defense, Skill Roll
- Characters only: Multi-action, Ready Slow Weapon, Complete Slow Spell

**Skill selectors** for creatures use `system.creatureSkills` and `system.creatureAttributes` dropdowns rather than the character skill lists.

**Slow Weapon** — the option only appears if the character has a slow weapon currently in cooldown (the flag `slowCooldown` is still active). Confirming records the declaration without a roll — the round is being spent readying.

**Complete Slow Spell** — the option only appears if the combatant has an `activeCast` flag whose target round equals the current round. The spell name is pre-populated.

**Form data extraction** (`extractForm`) runs on both confirmation buttons, building an `actions` array and a `primaryDataset` for the roll router.

**On confirmation:** `declared`, `declarationText`, and `declarationAction` flags are written to the combatant in three sequential `setFlag` calls.

**Roll routing:**
- Character → `CharacterRoller.rollCharacter(actor, primaryDataset)`
- Creature → `actor.sheet._rollCreaturePool(actor, attrKey, skillKey, label, itemData)`
- Mob → `ThreatRoller.rollThreat(actor, {})`

#### ITEM-8a — Multi-action Pool Selector
**Files:** `scripts/reign.mjs`, `scripts/helpers/character-roller.js`

When a character confirms a multi-action declaration and clicks "Confirm + Roll", `_openPoolSelectorDialog(actor, actions, allSkillOpts, slotCount)` is called before the roll dialog opens.

The selector dialog shows each declared action alongside its computed base pool (attribute value + skill value = Nd, derived live from the actor document). The player picks one via radio buttons. The selected action is converted into a `rollCharacter`-compatible dataset and returned.

The returned dataset has `preMultiActions: slotCount` added before being passed to `CharacterRoller.rollCharacter`. Inside the roll dialog's render callback, a new block reads `dataset.preMultiActions`: if greater than 1 and the player is not immune to multi-action penalties, the Multi-Actions input is pre-set to `slotCount` before the initial `enforceExclusivity()` call. The pool preview then immediately reflects the correct penalty.

`rollCharacter` signature changed from `(actor, dataset)` to `(actor, dataset, options = {})` to fix a pre-existing latent bug where `options?.prefillContext` in the render callback referenced an undeclared variable. The bug was silently swallowed by Foundry's event dispatcher in normal sheet usage but surfaced when called from the async declaration dialog chain.

#### ITEM-8b — Per-Set Action Assignment
**Files:** `scripts/helpers/chat.js`, `templates/chat/ore-roll.hbs`, `scripts/reign.mjs`

After rolling a multi-action pool, each set on the chat card displays an assignment control so the player can record which declared action that set is resolving.

**Data flow:**

`postOREChat` reads `declarationAction` from the combatant (if combat is active and `flags.multiActions > 1`). If the declaration is type `"multi"` with a populated `actions` array, the labels are extracted as `declaredActions: [{ label, type }]`. These are injected into the flags passed to `generateOREChatHTML` alongside `setAssignments: {}`.

Both `declaredActions` and `setAssignments` are stored in `rollFlags` on the message document so the re-render path (triggered on each assignment) can read them.

`generateOREChatHTML` exposes three new template variables: `isMultiAction` (boolean — only true when `multiActions > 1` AND `declaredActions.length > 0`, preventing the UI from appearing on non-declaration-dialog rolls), `declaredActions`, and `setAssignments`.

**Template:** Inside `{{#each sets}}`, after the `reign-action-buttons` div closes, a new conditional block renders either:
- An assignment dropdown + Assign button (unassigned): `<select class="set-assign-select">` populated from `../declaredActions`, and a `<button class="set-assign-btn">`
- A read-only label (assigned): `Assigned: <strong>{{lookup ../setAssignments @index}}</strong>`

`{{lookup ../setAssignments @index}}` uses Handlebars' `lookup` helper; JavaScript property access coerces numeric `@index` to string keys (`"0"`, `"1"`) so string-keyed objects resolve correctly.

**Handler:** `assignSetToAction(message, setIndex, actionLabel)` — new export from `chat.js`, following the `assignGobbleSet` pattern exactly: deep-clones `rollFlags`, mutates `setAssignments[String(setIndex)]`, calls `generateOREChatHTML` with the updated flags, and calls `message.update()`. Imported into `reign.mjs` and wired to `.set-assign-btn` click in the `renderChatMessageHTML` hook. Only the message author or GM can assign.

---

### BUG — GM Toolbar Declaration Phase Sort
**File:** `scripts/apps/gm-toolbar.js`

The party vitals declaration-phase sort in `_getPartyVitals` was ordering combatants by undeclared-first then alphabetical. Updated to mirror the RAW declaration commitment order implemented in `_sortCombatants`: Sense ascending → GMC before PC (tied Sense) → Sight ascending. The toolbar now shows the same order as the combat tracker during declaration phase.

---

### BUG — Dialog Button Labels Rendering as Literal HTML
**File:** `scripts/reign.mjs`

Foundry's `DialogV2` button `label` field is treated as plain text, not innerHTML. The declaration dialog button labels included `<i class="fas fa-...">` tags which rendered as visible literal strings. Stripped to plain text: `"Confirm (No Roll)"` and `"Confirm + Roll"`.

---

### BUG — Weapon Detection Failing for Threat Actors
**File:** `scripts/reign.mjs`

The declaration dialog was filtering weapons with `i.system.equipped` which is a character-sheet concept — threat actors do not use the equipped flag. The filter now branches: characters filter by `equipped`, all other actor types return all weapons on the actor.

---

### BUG — CharacterRoller Crash on Non-Character Actors
**File:** `scripts/reign.mjs`

`CharacterRoller.rollCharacter` reads `system.health.head.killing` at line 104. This structure does not exist on threat actors, causing a crash when "Confirm + Roll" was used for a beast or mob in the declaration dialog. Added `actor.type === "character"` guard in the roll routing block. Non-character actors now route to their appropriate rollers (creature pool dialog or `ThreatRoller`).

---

## v3.1.x — Roll Dialog & Chat Card (Batches A–C)

### Batch A — Roll Dialog

#### ITEM-7 — Maneuver Live Rules Preview
**Files:** `templates/dialogs/roll-character.hbs`, `scripts/helpers/character-roller.js`, `styles/dialogs.css`

When a maneuver is selected in the roll dialog, a live preview panel below the dropdown shows the maneuver's category, pool modifier, difficulty, and the full rules text from the MANEUVERS definition. The panel clears when "None" is selected. Data comes entirely from the client-side MANEUVERS constant — no additional network requests.

#### ITEM-12 — Passion Text and Toggle Buttons
**Files:** `templates/dialogs/roll-character.hbs`, `scripts/helpers/character-roller.js`

The roll dialog exposes the character's Mission, Duty, and Craving alongside the passion bonus toggles. Each passion group shows the text from the character's biography tab so players can make an informed decision without switching tabs. Toggle buttons (Against / Neutral / Aligned) back hidden inputs and update the live pool preview.

---

### Batch B — Chat Card

#### ITEM-4 — Gobble Selection Promoted to Card Top
**Files:** `templates/chat/ore-roll.hbs`, `scripts/helpers/chat.js`, `styles/chat.css`

When a defense roll produces multiple sets, the gobble selection prompt is rendered immediately after the sets block rather than at the bottom of the card. This ensures the defender assigns their Gobble Dice before any attacker applies damage from the same round.

#### ITEM-2 — Pin Escape Roll Button
**Files:** `templates/chat/ore-roll.hbs`, `scripts/helpers/chat.js`, `styles/chat.css`

A "Attempt Escape (Pinned character)" button appears on Pin maneuver chat cards. The button is visible to the defending player and opens a pre-configured Body+Fight or Coordination+Grapple roll dialog with difficulty set to `max(attackerBody, attackerFight)` stamped from the attacker's stats at roll time.

#### ITEM-11 (Batch B) — Re-roll Button
**Files:** `templates/chat/ore-roll.hbs`, `scripts/helpers/chat.js`, `styles/chat.css`

A ↺ re-roll button appears in the header of every ORE chat card. Clicking it reads `lastRollContext` from the rolling actor's flags and re-rolls the identical dice pool without opening the roll dialog. The context is stamped by `postOREChat` on every successful roll.

---

### Batch C — postOREChat Handlers

#### ITEM-11 (Batch C) — lastRollContext Storage
**Files:** `scripts/helpers/character-roller.js`, `scripts/reign.mjs`, `styles/chat.css`

`CharacterRoller` stamps the rolled pool parameters as `lastRollContext` on the actor flags after every roll. The re-roll handler in `reign.mjs` reads this context and calls `CharacterRoller.reroll(actor, context)` which rebuilds the result array and posts a new chat card.

#### ITEM-2 (Batch C) — Pin Escape Click Handler
**Files:** `scripts/helpers/character-roller.js`, `scripts/reign.mjs`

The escape button click handler resolves the pinned character from the clicking user's assigned character or selected token and opens the escape roll dialog.

---

## v3.0.1 — Creature Sheet UX

### UX — Creature Skill Management
**Files:** `templates/actor/threat-sheet.hbs`, `scripts/sheets/threat-sheet.js`, `styles/actor-sheet.css`

The Skills section on creature mode threat sheets now supports full add/edit/delete from the sheet UI via dialogs. Skills support combined dice + ED/MD (e.g. Fight 3 + ED).

### DATA — Creature Skill Format Change
**Files:** `scripts/sheets/threat-sheet.js`, `scripts/helpers/migration.js`

Creature skills now stored as `{ value, expert, master }` objects. Migration step converts legacy flat-format skills. `normalizeCreatureSkill()` helper handles both formats for graceful rollback.

### UX — Creature Attack Editing
**Files:** `templates/actor/threat-sheet.hbs`, `scripts/sheets/threat-sheet.js`, `styles/actor-sheet.css`

Inline config panels per attack row for editing name, attribute, skill, damage formula, slow rating, and notes.

### BUG — ArrayField Form Submission Wipes Non-Form Fields
**Files:** `scripts/sheets/threat-sheet.js`, `templates/actor/threat-sheet.hbs`, `styles/actor-sheet.css`

Editing any field on the creature sheet via `submitOnChange` was resetting hit location Heights, Shock, and Killing to defaults. Root causes: expanded object mismatch in the merge function, and hidden config panel inputs participating in FormData. Fixed by rewriting the merge function to navigate nested structure directly and by disabling config panel inputs until the panel is opened.

### UX — Clickable Height Selector
**Files:** `templates/actor/threat-sheet.hbs`, `scripts/sheets/threat-sheet.js`, `styles/actor-sheet.css`

Hit location Heights replaced with 10 clickable d10 face toggle buttons per location, bypassing `submitOnChange` entirely.

### BUG — Movement, Trainability, Tricks, Special Rules Not Persisting
**Files:** `scripts/helpers/models.js`, `scripts/sheets/threat-sheet.js`

Four fields were missing from `ReignThreatData.defineSchema()` — Foundry's DataModel stripped them on validation. Added all four to the schema.

### FEATURE — Generic Area Damage Roller
**Files:** `templates/dialogs/hazard-roller.hbs`, `scripts/combat/hazards.js`

New "Area" tab in the Hazard Roller for rolling generic Area Damage from any source. Routes through `applyDamageToTarget` with the `areaDice` parameter.

---

## v3.0.0 — Creatures, Hazards & Poisons

Creature Mode added to the threat sheet — a full bestiary system with custom hit locations, creature-specific attributes and skills (including ED/MD support), named attacks, and special mechanics (free Gobble Dice, charge accumulation, constriction, morale attacks, venom). Hazard Roller with falling, fire, and poison tabs. Poisons as a dedicated item type. Bestiary and Poisons compendium packs.

---

## v2.8.0 — Quality of Life

Counterspell integration — gobble button on spell chat cards. Eerie detection prompt — Roll Sense + Eerie button on successful spell cards. One-Roll Table validation with structured error/warning cards. Quick Dice Roller — standalone ORE roller in the chat sidebar.

---

## v2.6.0 — Presentation Pass

Threat and company sheet CSS consistency audit. Dark mode sweep with semantic CSS variables. Charactermancer biography formatting rebuilt. Redirect maneuver accessible from Dodge roll dialog. Submission Hold restricted to limb locations.

---

## v2.5.0 — Combat Manoeuvre Automation

Fifteen maneuvers fully automated across two tiers. Positional maneuvers apply status effects to targeted tokens via chat card buttons. Damage-modifying maneuvers track state across rounds via combatant flags. Tier 2 maneuvers gain a GM resolution button.

---

## v2.4.0 — Active Effects Phase 2

Sorcery group added to the Active Effect dictionary. New AE paths: `forceHitLocation`, `shiftHitLocationUp`, `appendManeuvers`, `minHeight`, `squishLimit`, `bonusTiming`, `ignoreMultiPenaltySkills`. Attunement-to-Perfect transition offers automatic AE creation.

---

## v2.3.0 — Sorcery Elevation & School System

The magic system fully rebuilt. Spells track Intensity, Slow, duration, and interaction flags. Esoterica tab redesigned with structured school and attunement panels. Magical schools defined in One-Roll Table JSON. Charactermancer school picker added.

---

## v2.2.0 — Architecture & Chat Optimisation

DRY extraction of hit location constants, scroll mixin, effect dictionary, and damage commit utility. Slimmed chat flag projection. Faction dashboard instance tracking improved.

---

## v2.1.0 — Critical Bug Fixes

Company conquest reward pre-damage snapshot fix. Shock recovery respects preCombatShock flag. Double-deletion in custom skills/moves resolved.
