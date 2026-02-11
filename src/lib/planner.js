import { PHASE_GUIDANCE, normalizeSymptomTags } from "./guidance.js";
import { compileAllowed, resolveIngredientTokens } from "./diet.ts";

const normalizeName = (value) => value.toLowerCase().trim();

const getRecipeIngredients = (recipe) => recipe?.ingredientTokens || recipe?.ingredients || [];

const DAILY_NUTRITION_TARGETS = {
  protein: 3,
  fiber: 3,
  micronutrient: 4,
  carb: 3,
  fat: 2,
};

const MEAL_NUTRITION_PRIORITIES = {
  breakfast: ["protein", "fiber"],
  lunch: ["protein", "fiber", "micronutrient"],
  dinner: ["protein", "fiber", "micronutrient"],
  snack: ["fiber", "protein"],
};

const hashString = (value = "") => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const buildCategoryLookup = (ingredientCatalog = []) => {
  const map = new Map();
  ingredientCatalog.forEach((ingredient) => {
    const category = ingredient?.category;
    if (!category) return;

    const name = normalizeName(ingredient?.name || "");
    if (name) map.set(name, category);

    (ingredient?.aliases || []).forEach((alias) => {
      const normalizedAlias = normalizeName(alias || "");
      if (normalizedAlias) map.set(normalizedAlias, category);
    });
  });
  return map;
};


const toReadableList = (items = []) => {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
};

const buildPlanReasoningNote = ({ phase, symptomTags, settings = {}, profile }) => {
  const symptomSummary = symptomTags.length
    ? `prioritizing symptom support for ${toReadableList(symptomTags.slice(0, 4))}`
    : "using cycle-phase guidance with no symptom tags provided";
  const inputSignals = [
    settings.preferLeftoverLunch ? "leftover-forward lunches" : null,
    settings.includeSnacks ? "daily snacks" : "snacks minimized",
    profile?.timeBudgetMin ? `a ${profile.timeBudgetMin} minute meal-time budget` : null,
    profile?.budgetLevel ? `${profile.budgetLevel} budget mode` : null,
    Number.isFinite(settings.maxRepeatsPerWeek)
      ? `max ${settings.maxRepeatsPerWeek} repeat(s) per recipe`
      : null,
  ].filter(Boolean);

  return `Menstrual-cycle-first planning for the ${phase} phase, ${symptomSummary}, and incorporating ${toReadableList(inputSignals)}.`;
};

const summarizeNutritionByCategory = (ingredients, ingredientCatalog, categoryLookup) => {
  const summary = { protein: 0, fiber: 0, micronutrient: 0, carb: 0, fat: 0 };
  const tokens = resolveIngredientTokens(ingredients, ingredientCatalog);
  tokens.forEach((token) => {
    const category = categoryLookup.get(normalizeName(token));
    if (category && summary[category] !== undefined) {
      summary[category] += 1;
    }
  });
  return summary;
};

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

const scoreNutritionFit = ({ mealType, nutritionSummary, dailyCategoryCounts }) => {
  const priorities = MEAL_NUTRITION_PRIORITIES[mealType] || [];
  let score = 0;
  const rationale = [];

  priorities.forEach((category) => {
    if ((nutritionSummary[category] || 0) > 0) {
      score += 1.2;
    } else {
      score -= 1.5;
    }
  });

  if (mealType === "snack" && (nutritionSummary.fiber || 0) === 0 && (nutritionSummary.protein || 0) === 0) {
    score -= 1;
    rationale.push("Snack is low in protein/fiber; may be less filling.");
  }

  if (dailyCategoryCounts) {
    Object.entries(DAILY_NUTRITION_TARGETS).forEach(([category, target]) => {
      if ((nutritionSummary[category] || 0) === 0) return;
      const current = dailyCategoryCounts.get(category) || 0;
      if (current < target) {
        score += 0.6;
      }
    });
  }

  const matched = priorities.filter((category) => (nutritionSummary[category] || 0) > 0);
  if (matched.length) {
    rationale.push(`Nutrition balance: includes ${matched.join(" & ")}.`);
  }

  return { score, rationale };
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
  dailyCategoryCounts,
  categoryLookup,
}) => {
  if (!recipe) return -999;
  const tokens = resolveIngredientTokens(getRecipeIngredients(recipe), ingredientCatalog);
  if (tokens.some((token) => forbiddenTokens.has(token))) {
    return -999;
  }

  const guidance = PHASE_GUIDANCE[phase] || { targetTags: [], avoidTags: [] };
  let score = 0;

  const nutritionSummary = summarizeNutritionByCategory(
    getRecipeIngredients(recipe),
    ingredientCatalog,
    categoryLookup
  );
  const nutritionFit = scoreNutritionFit({
    mealType: recipe.mealType,
    nutritionSummary,
    dailyCategoryCounts,
  });
  score += nutritionFit.score;

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

const buildRationale = ({
  recipe,
  phase,
  symptomTags,
  usedCount,
  ingredientCounts,
  profile,
  ingredientCatalog,
  categoryLookup,
  dailyCategoryCounts,
}) => {
  const guidance = PHASE_GUIDANCE[phase] || { targetTags: [] };
  const reasons = [];
  reasons.push(`Cycle-first choice: anchored to the ${phase} phase.`);
  if (symptomTags.length) {
    reasons.push(`Symptom priorities considered: ${toReadableList(symptomTags.slice(0, 4))}.`);
  }
  const hits = recipe.tags.filter((tag) => guidance.targetTags.includes(tag));
  if (hits.length) {
    reasons.push(`Supports ${phase} phase with ${hits.slice(0, 2).join(" & ")} tags.`);
  } else {
    reasons.push(`Phase-safe fit for ${phase} goals.`);
  }
  const symptomHits = recipe.tags.filter((tag) => symptomTags.includes(tag));
  if (symptomHits.length) {
    reasons.push(`Targets symptoms using ${symptomHits.slice(0, 2).join(" & ")}.`);
  } else if (symptomTags.length) {
    reasons.push("No direct symptom-tag match; selected for overall balance and constraints.");
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

  const nutritionSummary = summarizeNutritionByCategory(
    getRecipeIngredients(recipe),
    ingredientCatalog,
    categoryLookup
  );
  const nutritionFit = scoreNutritionFit({
    mealType: recipe.mealType,
    nutritionSummary,
    dailyCategoryCounts,
  });
  reasons.push(...nutritionFit.rationale);

  return reasons;
};

const selectRecipeCandidate = ({
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
  dailyCategoryCounts,
  categoryLookup,
  excludeIds = [],
  rng = Math.random,
}) => {
  const candidates = getByMealType
    ? getByMealType(mealType)
    : recipes.filter((recipe) => recipe.mealType === mealType);

  const scored = [];
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
      dailyCategoryCounts,
      categoryLookup,
    });
    if (Number.isFinite(score)) {
      scored.push({ recipe, score });
    }
  });

  if (!scored.length) {
    return null;
  }

  scored.sort((left, right) => right.score - left.score);
  const bestScore = scored[0].score;
  const shortlist = scored.filter((entry, index) => index < 5 && entry.score >= bestScore - 2.5);
  const pool = shortlist.length ? shortlist : scored.slice(0, 3);

  const weightedPool = pool.map((entry, index) => ({
    ...entry,
    weight: Math.max(0.1, 1 + (entry.score - bestScore) * 0.25 + (pool.length - index) * 0.2),
  }));
  const totalWeight = weightedPool.reduce((sum, entry) => sum + entry.weight, 0);

  let threshold = rng() * totalWeight;
  for (const entry of weightedPool) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry.recipe;
    }
  }

  return weightedPool[0].recipe;
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
  const categoryLookup = buildCategoryLookup(ingredientCatalog);
  const randomnessSeed = settings.planSeed ?? Date.now();
  const seedMaterial = JSON.stringify({
    userId: profile?.userId || "",
    phase,
    symptoms: symptomTags,
    days,
    startDateISO: startDateISO || "",
    randomnessSeed,
  });
  const rng = createRng(hashString(seedMaterial));

  const startDate = startDateISO ? new Date(startDateISO) : new Date();
  const planDays = [];
  const planReasoningNote = buildPlanReasoningNote({
    phase,
    symptomTags,
    settings,
    profile,
  });

  for (let index = 0; index < days; index += 1) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + index);
    const dateISO = dayDate.toISOString().slice(0, 10);

    const meals = {};
    const dailyCategoryCounts = new Map();

    const breakfast = selectRecipeCandidate({
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
      dailyCategoryCounts,
      categoryLookup,
      rng,
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
          ingredientCatalog,
          categoryLookup,
          dailyCategoryCounts,
        }),
      };
    }

    const dinner = selectRecipeCandidate({
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
      dailyCategoryCounts,
      categoryLookup,
      rng,
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
          ingredientCatalog,
          categoryLookup,
          dailyCategoryCounts,
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
      const lunch = selectRecipeCandidate({
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
        dailyCategoryCounts,
        categoryLookup,
        rng,
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
            ingredientCatalog,
            categoryLookup,
            dailyCategoryCounts,
          }),
        };
      }
    }

    if (settings.includeSnacks) {
      const snack = selectRecipeCandidate({
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
        dailyCategoryCounts,
        categoryLookup,
        rng,
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
            ingredientCatalog,
            categoryLookup,
            dailyCategoryCounts,
          }),
        };
      }
    }

    Object.values(meals).forEach((meal) => {
      usedRecipeCounts.set(meal.recipeId, (usedRecipeCounts.get(meal.recipeId) || 0) + 1);
      resolveIngredientTokens(meal.ingredients, ingredientCatalog).forEach((token) => {
        const key = normalizeName(token);
        ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
        const category = categoryLookup.get(key);
        if (category) {
          dailyCategoryCounts.set(category, (dailyCategoryCounts.get(category) || 0) + 1);
        }
      });
    });

    planDays.push({ dateISO, meals, notes: planReasoningNote });
  }

  return {
    startDateISO: startDate.toISOString().slice(0, 10),
    days: planDays,
    notes: [planReasoningNote],
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
  const categoryLookup = buildCategoryLookup(ingredientCatalog);
  const rng = createRng(hashString(JSON.stringify({ dayIndex, mealType, timestamp: Date.now() })));
  const currentMeal = plan.days[dayIndex].meals[mealType];
  const dailyCategoryCounts = new Map();

  plan.days.forEach((day, index) => {
    Object.values(day.meals || {}).forEach((meal) => {
      if (index === dayIndex && meal.mealType === mealType) return;
      usedRecipeCounts.set(meal.recipeId, (usedRecipeCounts.get(meal.recipeId) || 0) + 1);
      resolveIngredientTokens(meal.ingredients, ingredientCatalog).forEach((token) => {
        const key = normalizeName(token);
        ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
        if (index === dayIndex) {
          const category = categoryLookup.get(key);
          if (category) {
            dailyCategoryCounts.set(category, (dailyCategoryCounts.get(category) || 0) + 1);
          }
        }
      });
    });
  });

  const excludeIds = currentMeal?.recipeId ? [currentMeal.recipeId] : [];

  const replacement = selectRecipeCandidate({
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
    dailyCategoryCounts,
    categoryLookup,
    excludeIds,
    rng,
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
      ingredientCatalog,
      categoryLookup,
      dailyCategoryCounts,
    }),
  };

  return nextPlan;
};
