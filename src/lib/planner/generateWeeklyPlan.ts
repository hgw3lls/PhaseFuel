import type { DailyLog, MealType, PlannedMeal, Recipe, WeeklyPlan } from "./types";
import { estimatePhase } from "../cycle";
import type { IngredientRecord } from "../diet";
import { compileAllowed, resolveIngredientTokens } from "../diet";
import { normalizeSymptomTags } from "./guidance";
import { scoreRecipe } from "./scoring";

const addDays = (dateISO: string, offset: number) => {
  const date = new Date(dateISO);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const getRecipeIngredients = (recipe: Recipe) => recipe.ingredientTokens || recipe.ingredients || [];

const buildMeal = (recipe: Recipe, rationale: string[]): PlannedMeal => ({
  recipeId: recipe.id,
  name: recipe.name,
  mealType: recipe.mealType,
  ingredients: getRecipeIngredients(recipe),
  tags: recipe.tags,
  rationale,
});

export const generateWeeklyPlan = (
  profile: {
    maxRepeatsPerWeek: number;
    cycleSettings: {
      lastPeriodStart: string;
      typicalCycleLength: number;
      typicalLutealLength: number;
      periodLength: number;
      lastOvulation?: string;
      mode?: "period_based" | "ovulation_aware" | "moon_only" | "symptom_only";
    };
    lowFodmapMode: "off" | "moderate" | "strict";
  } & Parameters<typeof scoreRecipe>[0]["profile"],
  recipes: Recipe[],
  getByMealType: ((mealType: MealType) => Recipe[]) | null,
  weekStartISO: string,
  dailyLogs: DailyLog[],
  ingredientCatalog: IngredientRecord[]
): WeeklyPlan => {
  const usedRecipeCounts = new Map<string, number>();
  const ingredientCounts = new Map<string, number>();
  const maxRepeats = profile.maxRepeatsPerWeek || 2;
  const { forbiddenTokens } = compileAllowed(
    { dietPattern: profile.dietPattern, glutenFree: profile.glutenFree },
    ingredientCatalog,
    profile.lowFodmapMode
  );

  const days = Array.from({ length: 7 }, (_, index) => {
    const dateISO = addDays(weekStartISO, index);
    const dailyLog = dailyLogs.find((log) => log.dateISO === dateISO);
    const symptoms = dailyLog?.symptoms || [];
    const symptomTags = normalizeSymptomTags(symptoms);
    const phaseResult = estimatePhase(
      dateISO,
      profile.cycleSettings,
      profile.cycleSettings.mode || "period_based"
    );

    const meals: Record<MealType, PlannedMeal | undefined> = {
      breakfast: undefined,
      lunch: undefined,
      dinner: undefined,
      snack: undefined,
    };

    mealTypes.forEach((mealType) => {
      const candidates = getByMealType ? getByMealType(mealType) : recipes.filter((recipe) => recipe.mealType === mealType);
      let bestScore = -Infinity;
      let bestRecipe: Recipe | null = null;
      let bestRationale: string[] = [];

      candidates.forEach((recipe) => {
        const { score, rationale } = scoreRecipe({
          recipe,
          phase: phaseResult.phase,
          symptomTags,
          usedRecipeCounts,
          ingredientCounts,
          profile,
          maxRepeats,
          forbiddenTokens,
          ingredientCatalog,
        });
        if (score > bestScore) {
          bestScore = score;
          bestRecipe = recipe;
          bestRationale = rationale;
        }
      });

      if (bestRecipe) {
        meals[mealType] = buildMeal(bestRecipe, bestRationale);
        usedRecipeCounts.set(bestRecipe.id, (usedRecipeCounts.get(bestRecipe.id) || 0) + 1);
        resolveIngredientTokens(getRecipeIngredients(bestRecipe), ingredientCatalog).forEach((token) => {
          const key = token.toLowerCase().trim();
          ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
        });
      }
    });

    return {
      dateISO,
      phase: phaseResult.phase,
      meals,
    };
  });

  return {
    weekStartISO,
    days,
  };
};
