# Reign System — Sprint 1–3 Changes

## New File

- **`helpers/scroll-mixin.js`** — `ScrollPreserveMixin` that preserves scroll positions across V14 re-renders. Replaces identical `_replaceHTML` blocks that were copy-pasted across 7 files.

---

## Sprint 1 — Critical Bug Fixes

### 1.1 Company conquest reward uses pre-damage size
**File:** `combat/company-damage.js`

The `targetSize` calculation loop was running *after* `await targetActor.update(updates)`, meaning conquest reward tiers compared against post-damage strength (making the conquered company look smaller and reducing rewards).

**Fix:** Moved the size-summing and zero-checking loop above the update call. The loop now reads original `q.value` for undamaged qualities and uses the pre-calculated `newValue` for the targeted quality.

### 1.2 Shock recovery now respects preCombatShock snapshot
**File:** `sheets/character-sheet.js`

The sheet's "Recover Shock" button was halving *all* current shock, ignoring the `preCombatShock` flag that tracks how much shock existed before combat. This caused over-healing of pre-existing injuries.

**Fix:** Replaced the inline halving logic in `_onRecoverShock` with a delegation to `performPostCombatRecovery()` from `damage.js`, which only heals shock sustained during the current fight. Added `performPostCombatRecovery` to the import.

### 1.3 Double-deletion bug in custom skills and moves
**File:** `sheets/character-sheet.js`

Both `_onDeleteCustomSkill` and `_onDeleteCustomMove` performed two sequential deletions: first a `deepClone` + full object replacement with `diff: false`, then a V14-correct `_del`/`-=` operator deletion. The second deletion would error or no-op since the key was already gone.

**Fix:** Removed the redundant `deepClone` + replace approach from both methods. Only the V14-correct `_del` / `-=` operator path remains.

---

## Sprint 2 — DRY Extraction & Architecture

### 2.1 Centralized hit location constants
**File:** `helpers/config.js`

Added three frozen constants:
- `HIT_LOCATIONS` — `["head", "torso", "armR", "armL", "legR", "legL"]`
- `HIT_LOCATION_LABELS` — with die-face ranges (e.g. `"Head (10)"`)
- `HIT_LOCATION_SHORT_LABELS` — without ranges (e.g. `"Head"`)

Replaced all 8 inline array literals across `character-sheet.js` (2) and `damage.js` (6).

### 2.2 ScrollPreserveMixin
**File:** `helpers/scroll-mixin.js` (new)

Extracted the identical `_replaceHTML` scroll-preservation block into a single mixin. Updated all 7 consuming files:

| File | Old base class | New base class |
|------|---------------|----------------|
| `character-sheet.js` | `HandlebarsApplicationMixin(ActorSheetV2)` | `HandlebarsApplicationMixin(ScrollPreserveMixin(ActorSheetV2))` |
| `company-sheet.js` | same pattern | same pattern |
| `item-sheet.js` | `HandlebarsApplicationMixin(ItemSheetV2)` | `HandlebarsApplicationMixin(ScrollPreserveMixin(ItemSheetV2))` |
| `threat-sheet.js` | `HandlebarsApplicationMixin(ActorSheetV2)` | `HandlebarsApplicationMixin(ScrollPreserveMixin(ActorSheetV2))` |
| `faction-dashboard.js` | `HandlebarsApplicationMixin(ApplicationV2)` | `HandlebarsApplicationMixin(ScrollPreserveMixin(ApplicationV2))` |
| `charactermancer.js` | `HandlebarsApplicationMixin(ApplicationV2)` | `HandlebarsApplicationMixin(ScrollPreserveMixin(ApplicationV2))` |
| `companymancer.js` | `HandlebarsApplicationMixin(ApplicationV2)` | `HandlebarsApplicationMixin(ScrollPreserveMixin(ApplicationV2))` |

### 2.3 Centralized effect dictionary
**File:** `helpers/config.js`

Added two exported functions:
- `getEffectDictionary()` — the master dictionary shared by character and item sheets
- `getItemEffectExtras()` — the Company Qualities entries unique to item sheets

Updated consumers:
- `character-sheet.js` → `_getEffectDictionary()` delegates to `getEffectDictionary()`
- `item-sheet.js` → `_getEffectDictionary()` returns `[...getEffectDictionary(), ...getItemEffectExtras()]`

The company-sheet's dictionary was left as-is (it's small and structurally different).

### 2.4 Extracted `commitHealth()` utility
**File:** `combat/damage.js`

Created a `commitHealth(actor, localHealth)` function that diffs a local health object against `actor.system.health`, writes only changed fields, and ensures `syncCharacterStatusEffects` is always called. Replaced all 4 identical inline commit blocks.

### 2.5 Unified threat damage handling
**File:** `combat/damage.js`

Extracted `applyThreatDamageInternal(targetActor, magDmg, headerText, options)` — a shared handler for magnitude damage, morale checks, chat output, and optional parent-company notification. Both `applyDamageToTarget` and `applyScatteredDamageToTarget` now delegate to it, reducing ~100 lines of duplication to ~10.

### H. Faction dashboard instance tracking
**File:** `apps/faction-dashboard.js`

Replaced `static activeInstances = new Set()` (with manual add/delete in `_onRender`/`_onClose`) with a `static syncAll()` method that derives live instances from `ui.windows`. Eliminates the leak risk if a window is destroyed without firing `_onClose`.

---

## Sprint 3 — Chat Message Optimization

### 3.1 Slimmed chat flag `itemData`
**File:** `helpers/chat.js`

Replaced `item.toObject()` (which serialized the entire item including notes HTML, description, and effect arrays) with a minimal projection containing only the ~10 fields actually consumed by chat cards and the damage applicator:

`uuid`, `name`, `type`, `hasEffects`, `system.damageFormula`, `system.damage`, `system.range`, `system.intensity`, `system.pool`, `system.castingStat`, `system.qualities`

---

## File Map

```
reign-sprint1-3/
├── CHANGES.md              ← this file
├── apps/
│   └── faction-dashboard.js
├── combat/
│   ├── company-damage.js
│   └── damage.js
├── generators/
│   ├── charactermancer.js
│   └── companymancer.js
├── helpers/
│   ├── chat.js
│   ├── config.js
│   └── scroll-mixin.js     ← NEW
└── sheets/
    ├── character-sheet.js
    ├── company-sheet.js
    ├── item-sheet.js
    └── threat-sheet.js
```
