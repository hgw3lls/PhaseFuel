# PhaseFuel Logic & Usability Review

This review focuses on the deterministic planner, filtering/query logic, and UI flow in `App.jsx`, with concrete recommendations to improve user trust, plan quality, and day-to-day usability.

## What is working well

1. **Deterministic core with bounded randomness**
   - Plan generation uses a seeded RNG (`createRng` + `hashString`) and weighted candidate selection, which balances repeatability and variety. This is a strong foundation for user trust and debugging.
2. **Constraint-first planning path**
   - Forbidden ingredient filtering is applied during scoring/selection and then validated again (`validatePlan`), reducing the chance of unsafe output.
3. **Indexed recipe querying**
   - `getMatchingRecipes` uses precomputed indexes and intersection, which scales better than scanning all recipes per filter change.
4. **Practical pantry/freezer/price modules**
   - Local modules for pantry/freezer/price memory are already aligned with practical meal-planning behavior.

## Key logic gaps affecting usability

### 1) "Deterministic" generation is currently unstable by default
- `generateWeeklyPlan` seeds randomness from `settings.planSeed ?? Date.now()`, which means plans vary unless a seed is explicitly provided.
- Impact: users can feel the app is inconsistent even with the same profile + inputs.

**Recommendation**
- Default seed should be stable (e.g., based on `userId + startDateISO + phase + symptoms`) and only change on explicit "reroll".
- Add a visible **Reroll Plan** action that increments a `planSeed` counter.

### 2) Plan swap is always time-based random
- `swapMealInPlan` seeds with `{ dayIndex, mealType, timestamp: Date.now() }`, ensuring non-repeatable swaps.
- Impact: hard to explain or recover previous swap behavior.

**Recommendation**
- Persist a `swapNonce` per day/meal in plan metadata and increment only when user taps swap.
- This preserves deterministic replay while still allowing alternate options.

### 3) Grocery list currently treats ingredient strings as count-only tokens
- `buildGroceryList` counts ingredient string occurrences and sets `qty` to count when >1.
- Impact: low usability for shopping (no normalization of units, no dedupe by canonical ingredient id beyond simple name matching).

**Recommendation**
- Move grocery building to canonical ingredient IDs first, with display names second.
- Add optional quantity estimation rules (even coarse defaults) and merge compatible units.
- Preserve manual overrides by storing user-adjusted quantities keyed by ingredient ID.

### 4) Nutrition scoring is category-presence based, not meal/portion aware
- `scoreNutritionFit` rewards category presence and daily target gaps, but no portion weighting.
- Impact: recipes with tiny amounts of category tokens may score similarly to robust meals.

**Recommendation**
- Introduce lightweight nutrient-weight proxy: per-ingredient category weights (e.g., protein-dense vs protein-supporting).
- Keep this symbolic (no medical claim) but distinguish major vs minor contributions.

### 5) Filter UX can produce empty results without clear recovery guidance
- Query intersection is strict AND across all selected flags/ingredients.
- Impact: users can get zero matches and may not know which filter is too restrictive.

**Recommendation**
- Show "why empty" diagnostics:
  - count impact per selected filter,
  - one-click suggestions to relax the strictest filter,
  - fallback "include close matches" toggle (OR-mode for ingredient filters).

### 6) Rationale quality is good but not ranked by user priorities
- `buildRationale` appends multiple reasons, but priority ordering is static.
- Impact: users may miss the most personally relevant reason (e.g., budget vs symptom alignment).

**Recommendation**
- Rank rationale bullets according to active profile settings and current user action context.
- Example: if user has tight budget, show budget fit reason first.

### 7) Repeat-penalty is linear and can over-penalize ingredient families
- Ingredient repetition penalty counts token repeats uniformly.
- Impact: benign staples (e.g., onion/garlic alternatives, rice) may be penalized too similarly to same-main-protein repetition.

**Recommendation**
- Split repetition into tiers:
  - major ingredients (main protein / primary carb) high penalty,
  - aromatics/staples low penalty,
  - configurable tolerance by user preference.

### 8) Missing explicit confidence/explainability summary in UI
- The planner has rationale internally, but no top-level "why this week" confidence panel.
- Impact: reduced trust for new users.

**Recommendation**
- Add a compact weekly explanation card:
  - `% meals aligned with phase tags`,
  - `% within time budget`,
  - forbidden-token compliance status,
  - diversity score.

## Prioritized improvement roadmap

### P0 (High user impact, low-medium implementation)
1. Stable default seed + explicit reroll control.
2. Deterministic swap nonce model.
3. Empty-filter diagnostics with relax suggestions.
4. Weekly confidence/explainability card.

### P1 (Medium impact)
1. Grocery list canonicalization by ingredient ID + quantity merge rules.
2. Priority-ranked rationale ordering.
3. Tiered repetition penalties.

### P2 (Strategic quality)
1. Weighted nutrient proxy model.
2. Optional user-personalized scoring weights (budget/time/symptoms).

## Suggested acceptance criteria

1. **Determinism test**: same input snapshot yields identical plan IDs and meals.
2. **Reroll test**: changing reroll seed changes at least one meal in >80% of runs.
3. **Swap replay test**: same swap nonce sequence reproduces same replacements.
4. **Filter empty-state test**: when zero results, UI shows at least one actionable relax suggestion.
5. **Grocery merge test**: duplicate ingredient aliases collapse to one line item.

## Notes for implementation

- Most improvements can be layered without changing the current data schema drastically.
- Preserve symbolic/disclaimer messaging; avoid any framing that implies clinical nutrition guidance.
