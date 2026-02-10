import { PHASE_GUIDANCE, normalizeSymptomTags } from "./guidance.js";
import { compileAllowed, resolveIngredientTokens } from "./diet.ts";

const normalizeName = (value) => value.toLowerCase().trim();

const getRecipeIngredients = (recipe) => recipe?.ingredientTokens || recipe?.ingredients || [];

const scoreIngredientRepetition = (ingredients, ingredientCounts) =>
  ingredients.reduce((penalty, ingredient) => {
    const count = ingredientCounts.get(normalizeName(ingredient)) || 0;
    return penalty + Math.max(0, count - 1) * 0.5;
  }, 0);

const scoreBudgetFit = (recipe, profile) => {
  if (!profile?.budgetLevel) return 0;
  const map = { tight: "budget", normal: "balanced", generous: "premium" };
  const desired = map[profile.budgetLevel] || "balanced";
  if (recipe.costLevel === desired) return 1.5;
  if (recipe.costLevel === "budget" && desired !== "premium") return 1;
  return -1;
};

export const scoreRecipe = ({
  recipe,
  phase,
  symptomTags,
  forbiddenTokens,
  usedRecipeCounts,
  ingredientCounts,
  profile,
  ingredientCatalog,
}) => {
  if (!recipe) return -999;
  const tokens = resolveIngredientTokens(getRecipeIngredients(recipe), ingredientCatalog);
  if (tokens.some((token) => forbiddenTokens.has(token))) {
    return -999;
  }

  const guidance = PHASE_GUIDANCE[phase] || { targetTags: [], avoidTags: [] };
  let score = 0;

  guidance.targetTags.forEach((tag) => {
    if (recipe.tags.includes(tag)) score += 2;
  });
  guidance.avoidTags.forEach((tag) => {
    if (recipe.tags.includes(tag)) score -= 2;
  });
  symptomTags.forEach((tag) => {
    if (recipe.tags.includes(tag)) score += 1.5;
  });

  profile?.preferTags?.forEach((tag) => {
    if (recipe.tags.includes(tag)) score += 1;
  });

  const usedCount = usedRecipeCounts.get(recipe.id) || 0;
  if (usedCount > 0) {
    score -= usedCount * 3;
  }

  score -= scoreIngredientRepetition(getRecipeIngredients(recipe), ingredientCounts);

  if (profile?.timeBudgetMin && recipe.timeMinutes > profile.timeBudgetMin) {
    score -= 2;
  }

  score += scoreBudgetFit(recipe, profile);

  return score;
};

const buildRationale = ({ recipe, phase, symptomTags, usedCount, ingredientCounts, profile }) => {
  const guidance = PHASE_GUIDANCE[phase] || { targetTags: [] };
  const reasons = [];
  const hits = recipe.tags.filter((tag) => guidance.targetTags.includes(tag));
  if (hits.length) {
    reasons.push(`Supports ${phase} phase with ${hits.slice(0, 2).join(" & ")} tags.`);
  }
  const symptomHits = recipe.tags.filter((tag) => symptomTags.includes(tag));
  if (symptomHits.length) {
    reasons.push(`Targets symptoms using ${symptomHits.slice(0, 2).join(" & ")}.`);
  }
  if (profile?.timeBudgetMin && recipe.timeMinutes <= profile.timeBudgetMin) {
    reasons.push(`Fits time budget at ${recipe.timeMinutes} minutes.`);
  }
  if (profile?.budgetLevel) {
    reasons.push(`Aligned with ${profile.budgetLevel} budget preference.`);
  }
  if (usedCount > 0) {
    reasons.push("Variety note: repeated recipe slot this week.");
  }
  const repeatedIngredients = getRecipeIngredients(recipe).filter(
    (ingredient) => (ingredientCounts.get(normalizeName(ingredient)) || 0) > 0
  );
  if (repeatedIngredients.length) {
    reasons.push("Variety note: overlaps with prior ingredients.");
  }
  if (recipe.batchable) {
    reasons.push("Batch-friendly for leftovers.");
  }
  if (recipe.timeMinutes <= 20) {
    reasons.push("Quick prep under 20 minutes.");
  }
  return reasons;
};

const selectBestRecipe = ({
  recipes,
  getByMealType,
  phase,
  symptomTags,
  forbiddenTokens,
  usedRecipeCounts,
  ingredientCounts,
  profile,
  mealType,
  maxRepeats,
  ingredientCatalog,
  excludeIds = [],
}) => {
  const candidates = getByMealType
    ? getByMealType(mealType)
    : recipes.filter((recipe) => recipe.mealType === mealType);
  let best = null;
  let bestScore = -Infinity;

  candidates.forEach((recipe) => {
    if (excludeIds.includes(recipe.id)) return;
    const usedCount = usedRecipeCounts.get(recipe.id) || 0;
    if (usedCount >= maxRepeats) return;
    const score = scoreRecipe({
      recipe,
      phase,
      symptomTags,
      forbiddenTokens,
      usedRecipeCounts,
      ingredientCounts,
      profile,
      ingredientCatalog,
    });
    if (score > bestScore) {
      bestScore = score;
      best = recipe;
    }
  });

  return best;
};

export const generateWeeklyPlan = ({
  recipes,
  getByMealType,
  profile,
  phase,
  symptoms = [],
  settings = {},
  startDateISO,
  days = 7,
}) => {
  const symptomTags = normalizeSymptomTags(symptoms);
  const { forbiddenTokens } = compileAllowed(
    profile,
    settings.ingredientCatalog || [],
    profile.lowFodmapMode || "off"
  );
  const usedRecipeCounts = new Map();
  const ingredientCounts = new Map();
  const maxRepeats = settings.maxRepeatsPerWeek ?? 2;
  const ingredientCatalog = settings.ingredientCatalog || [];

  const startDate = startDateISO ? new Date(startDateISO) : new Date();
  const planDays = [];

  for (let index = 0; index < days; index += 1) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + index);
    const dateISO = dayDate.toISOString().slice(0, 10);

    const meals = {};

    const breakfast = selectBestRecipe({
      recipes,
      getByMealType,
      phase,
      symptomTags,
      forbiddenTokens,
      usedRecipeCounts,
      ingredientCounts,
      profile,
      mealType: "breakfast",
      maxRepeats,
      ingredientCatalog,
    });
    if (breakfast) {
      const usedCount = usedRecipeCounts.get(breakfast.id) || 0;
      meals.breakfast = {
        recipeId: breakfast.id,
        name: breakfast.name,
        mealType: breakfast.mealType,
        ingredients: getRecipeIngredients(breakfast),
        tags: breakfast.tags,
        rationale: buildRationale({
          recipe: breakfast,
          phase,
          symptomTags,
          usedCount,
          ingredientCounts,
          profile,
        }),
      };
    }

    const dinner = selectBestRecipe({
      recipes,
      getByMealType,
      phase,
      symptomTags,
      forbiddenTokens,
      usedRecipeCounts,
      ingredientCounts,
      profile,
      mealType: "dinner",
      maxRepeats,
      ingredientCatalog,
    });
    if (dinner) {
      const usedCount = usedRecipeCounts.get(dinner.id) || 0;
      meals.dinner = {
        recipeId: dinner.id,
        name: dinner.name,
        mealType: dinner.mealType,
        ingredients: getRecipeIngredients(dinner),
        tags: dinner.tags,
        rationale: buildRationale({
          recipe: dinner,
          phase,
          symptomTags,
          usedCount,
          ingredientCounts,
          profile,
        }),
      };
    }

    if (settings.preferLeftoverLunch && dinner?.leftovers) {
      meals.lunch = {
        recipeId: dinner.id,
        name: `${dinner.name} leftovers`,
        mealType: "lunch",
        ingredients: getRecipeIngredients(dinner),
        tags: [...dinner.tags, "leftovers"],
        rationale: ["Uses batch-cooked leftovers to reduce prep."],
      };
    } else {
      const lunch = selectBestRecipe({
        recipes,
        getByMealType,
        phase,
        symptomTags,
        forbiddenTokens,
        usedRecipeCounts,
        ingredientCounts,
        profile,
        mealType: "lunch",
        maxRepeats,
        ingredientCatalog,
      });
      if (lunch) {
        const usedCount = usedRecipeCounts.get(lunch.id) || 0;
        meals.lunch = {
          recipeId: lunch.id,
          name: lunch.name,
          mealType: lunch.mealType,
          ingredients: getRecipeIngredients(lunch),
          tags: lunch.tags,
          rationale: buildRationale({
            recipe: lunch,
            phase,
            symptomTags,
            usedCount,
            ingredientCounts,
            profile,
          }),
        };
      }
    }

    if (settings.includeSnacks) {
      const snack = selectBestRecipe({
        recipes,
        getByMealType,
        phase,
        symptomTags,
        forbiddenTokens,
        usedRecipeCounts,
        ingredientCounts,
        profile,
        mealType: "snack",
        maxRepeats,
        ingredientCatalog,
      });
      if (snack) {
        const usedCount = usedRecipeCounts.get(snack.id) || 0;
        meals.snack = {
          recipeId: snack.id,
          name: snack.name,
          mealType: snack.mealType,
          ingredients: getRecipeIngredients(snack),
          tags: snack.tags,
          rationale: buildRationale({
            recipe: snack,
            phase,
            symptomTags,
            usedCount,
            ingredientCounts,
            profile,
          }),
        };
      }
    }

    Object.values(meals).forEach((meal) => {
      usedRecipeCounts.set(meal.recipeId, (usedRecipeCounts.get(meal.recipeId) || 0) + 1);
      resolveIngredientTokens(meal.ingredients, ingredientCatalog).forEach((token) => {
        const key = normalizeName(token);
        ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
      });
    });

    planDays.push({ dateISO, meals });
  }

  return {
    startDateISO: startDate.toISOString().slice(0, 10),
    days: planDays,
    notes: ["Deterministic plan based on cycle phase, symptoms, and constraints."],
  };
};

export const swapMealInPlan = ({
  plan,
  recipes,
  getByMealType,
  profile,
  phase,
  symptoms,
  settings,
  dayIndex,
  mealType,
}) => {
  if (!plan?.days?.[dayIndex]) return plan;
  const symptomTags = normalizeSymptomTags(symptoms);
  const ingredientCatalog = settings.ingredientCatalog || [];
  const { forbiddenTokens } = compileAllowed(
    profile,
    ingredientCatalog,
    profile.lowFodmapMode || "off"
  );
  const usedRecipeCounts = new Map();
  const ingredientCounts = new Map();
  const maxRepeats = settings.maxRepeatsPerWeek ?? 2;

  plan.days.forEach((day, index) => {
    Object.values(day.meals || {}).forEach((meal) => {
      if (index === dayIndex && meal.mealType === mealType) return;
      usedRecipeCounts.set(meal.recipeId, (usedRecipeCounts.get(meal.recipeId) || 0) + 1);
      resolveIngredientTokens(meal.ingredients, ingredientCatalog).forEach((token) => {
        const key = normalizeName(token);
        ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
      });
    });
  });

  const excludeIds = plan.days.flatMap((day) =>
    Object.values(day.meals || {}).map((meal) => meal.recipeId)
  );

  const replacement = selectBestRecipe({
    recipes,
    getByMealType,
    phase,
    symptomTags,
    forbiddenTokens,
    usedRecipeCounts,
    ingredientCounts,
    profile,
    mealType,
    maxRepeats,
    ingredientCatalog,
    excludeIds,
  });

  if (!replacement) return plan;

  const nextPlan = structuredClone(plan);
  const usedCount = usedRecipeCounts.get(replacement.id) || 0;
  nextPlan.days[dayIndex].meals[mealType] = {
    recipeId: replacement.id,
    name: replacement.name,
    mealType: replacement.mealType,
    ingredients: getRecipeIngredients(replacement),
    tags: replacement.tags,
    rationale: buildRationale({
      recipe: replacement,
      phase,
      symptomTags,
      usedCount,
      ingredientCounts,
      profile,
    }),
  };

  return nextPlan;
};
