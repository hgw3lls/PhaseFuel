import { getMatchingRecipes } from "../data/query";
import { getPhaseContext } from "./phaseMapper";
import { recipeMatchesDiet, type DietProfile, type IngredientCatalogRecord, type RecipeLike } from "./constraints";
import { scoreRecipe } from "./scoring";
import {
  applyMealToHistory,
  computeIngredientDiversityPenalty,
  createEmptyHistory,
  recipeRepeatHardBlock,
} from "./diversity";
import type { MealSlot, DayPlan, PlannedMeal, PlannerHistory, WeekPlan } from "./planTypes";
import type { MenstrualPhase, MoonPhase, PlannerUserProfile } from "./phaseModels";

type CandidateRecipe = RecipeLike & {
  name?: string;
  mealType?: string;
};

type IngredientFilters = {
  ingredientIds?: string[];
};

const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
const CANDIDATE_LIMIT = 80;

const normalizeISODate = (date: Date): string =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();

const getDietFlagsFromProfile = (dietProfile: DietProfile): string[] => {
  const flags: string[] = [];

  if (dietProfile.glutenFree) flags.push("gluten_free_candidate");
  if (dietProfile.vegetarian) flags.push("vegetarian_candidate");
  if (dietProfile.pescatarian) flags.push("pescatarian_candidate");
  if (dietProfile.lowFodmap) flags.push("low_fodmap_candidate");

  return flags;
};

export const getCandidatesForSlot = (
  slot: MealSlot,
  dietProfile: DietProfile,
  optionalIngredientFilters?: IngredientFilters
): CandidateRecipe[] => {
  const filters = {
    mealType: slot,
    dietFlags: getDietFlagsFromProfile(dietProfile),
    ingredientIds: optionalIngredientFilters?.ingredientIds,
  };

  const indexedCandidates = getMatchingRecipes(filters) as CandidateRecipe[];

  return indexedCandidates
    .slice()
    .sort((a, b) => (a.id || "").localeCompare(b.id || ""))
    .slice(0, CANDIDATE_LIMIT);
};

export const selectTopMeals = (
  candidates: CandidateRecipe[],
  context: { menstrualPhase: MenstrualPhase; moonPhase: MoonPhase },
  dietProfile: DietProfile,
  ingredientCatalog: IngredientCatalogRecord[],
  history: PlannerHistory,
  mealCount = 1,
  excludedRecipeIds: Set<string> = new Set()
): PlannedMeal[] => {
  const scored = candidates
    .filter((candidate) => !!candidate?.id)
    .filter((candidate) => !excludedRecipeIds.has(candidate.id))
    .filter((candidate) => !recipeRepeatHardBlock(candidate.id, history))
    .filter((candidate) => recipeMatchesDiet(candidate, dietProfile, ingredientCatalog).ok)
    .map((candidate) => {
      const base = scoreRecipe(
        candidate,
        {
          menstrualPhase: context.menstrualPhase,
          moonPhase: context.moonPhase,
        },
        dietProfile,
        ingredientCatalog
      );

      const diversityPenalty = computeIngredientDiversityPenalty(candidate.ingredientIds || [], history);
      const adjusted = Math.max(0, base.score - diversityPenalty);

      return {
        candidate,
        adjusted,
        base,
        diversityPenalty,
      };
    })
    .sort((left, right) => right.adjusted - left.adjusted);

  const selected: PlannedMeal[] = [];

  for (const entry of scored) {
    if (selected.length >= mealCount) break;

    const ingredientIds = entry.candidate.ingredientIds || [];

    selected.push({
      recipeId: entry.candidate.id,
      title: entry.candidate.name || entry.candidate.id,
      score: entry.adjusted,
      breakdown: {
        ...entry.base.breakdown,
        diversityPenalty: entry.diversityPenalty,
      },
      ingredientIds,
      mealType: entry.candidate.mealType || "unknown",
    });
  }

  return selected;
};

export const generateDayPlan = (
  date: Date,
  userProfile: PlannerUserProfile,
  dietProfile: DietProfile,
  ingredientCatalog: IngredientCatalogRecord[],
  history: PlannerHistory = createEmptyHistory(),
  ingredientFilters?: IngredientFilters
): DayPlan => {
  const context = getPhaseContext(userProfile, date);
  const meals: DayPlan["meals"] = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };

  const daySelectedRecipeIds = new Set<string>();

  SLOT_ORDER.forEach((slot) => {
    const candidates = getCandidatesForSlot(slot, dietProfile, ingredientFilters);
    const selected = selectTopMeals(candidates, context, dietProfile, ingredientCatalog, history, 1, daySelectedRecipeIds);

    if (selected.length) {
      const meal = selected[0];
      meals[slot] = [meal];
      daySelectedRecipeIds.add(meal.recipeId);
      applyMealToHistory(history, meal.recipeId, meal.ingredientIds);
    }
  });

  return {
    dateISO: normalizeISODate(date),
    context,
    meals,
  };
};

export const generateWeekPlan = (
  startDate: Date,
  userProfile: PlannerUserProfile,
  dietProfile: DietProfile,
  ingredientCatalog: IngredientCatalogRecord[],
  ingredientFilters?: IngredientFilters
): WeekPlan => {
  const history = createEmptyHistory();
  const week: WeekPlan = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const current = new Date(startDate);
    current.setUTCDate(startDate.getUTCDate() + offset);
    week.push(generateDayPlan(current, userProfile, dietProfile, ingredientCatalog, history, ingredientFilters));
  }

  return week;
};

export const generateCyclePlan = (
  userProfile: PlannerUserProfile,
  dietProfile: DietProfile,
  ingredientCatalog: IngredientCatalogRecord[],
  days = 28,
  startDate: Date = new Date(),
  ingredientFilters?: IngredientFilters
): DayPlan[] => {
  const history = createEmptyHistory();
  const plan: DayPlan[] = [];
  const totalDays = Math.max(1, Math.floor(days));

  for (let offset = 0; offset < totalDays; offset += 1) {
    const current = new Date(startDate);
    current.setUTCDate(startDate.getUTCDate() + offset);
    plan.push(generateDayPlan(current, userProfile, dietProfile, ingredientCatalog, history, ingredientFilters));
  }

  return plan;
};
