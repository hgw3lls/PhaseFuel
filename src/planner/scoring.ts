import { recipeMatchesDiet, type DietProfile, type IngredientCatalogRecord, type RecipeLike } from "./constraints";
import { getTargetWeights, type CategoryWeights, type TargetCategory } from "./targets";
import type { MenstrualPhase, MoonPhase } from "./phaseModels";

type ScoreContext = {
  menstrualPhase: MenstrualPhase;
  moonPhase: MoonPhase;
};

type ScoreBreakdown = {
  dietOk: boolean;
  dietReasons: string[];
  targetWeights: CategoryWeights;
  categoryCounts: Record<TargetCategory, number>;
  categoryDistribution: CategoryWeights;
  categoryBalanceScore: number;
  sugarPenalty: number;
  varietyBonus: number;
  moonAdjustment: number;
  finalRawScore: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const CATEGORY_TO_TARGET: Record<string, TargetCategory> = {
  protein: "protein",
  proteins: "protein",
  legume: "protein",
  legumes: "protein",
  bean: "protein",
  beans: "protein",
  lentil: "protein",
  lentils: "protein",
  fish: "protein",
  seafood: "protein",
  dairy: "protein",

  grain: "carb",
  grains: "carb",
  starch: "carb",
  starches: "carb",
  rice: "carb",
  pasta: "carb",
  tuber: "carb",
  potato: "carb",

  fat: "fat",
  fats: "fat",
  oil: "fat",
  oils: "fat",
  nut: "fat",
  nuts: "fat",
  seed: "fat",
  seeds: "fat",

  vegetable: "fiber",
  vegetables: "fiber",
  greens: "fiber",
  fruit: "fiber",
  fruits: "fiber",

  spice: "micronutrient",
  spices: "micronutrient",
  herb: "micronutrient",
  herbs: "micronutrient",
  fermented: "micronutrient",
};

const SUGAR_TOKENS = [
  "sugar",
  "brown sugar",
  "white sugar",
  "cane sugar",
  "powdered sugar",
  "maple syrup",
  "corn syrup",
  "honey",
];

const normalize = (value: string): string => value.toLowerCase().trim();

const getCatalogIndex = (ingredientCatalog: IngredientCatalogRecord[]): Map<string, IngredientCatalogRecord> =>
  new Map((ingredientCatalog || []).filter((item) => item?.id).map((item) => [item.id, item]));

const resolveTargetCategory = (categoryValue?: string): TargetCategory | null => {
  if (!categoryValue) return null;
  const normalized = normalize(categoryValue);
  if (CATEGORY_TO_TARGET[normalized]) return CATEGORY_TO_TARGET[normalized];

  const partial = Object.keys(CATEGORY_TO_TARGET).find((key) => normalized.includes(key));
  return partial ? CATEGORY_TO_TARGET[partial] : null;
};

const emptyCategoryCounts = (): Record<TargetCategory, number> => ({
  protein: 0,
  carb: 0,
  fat: 0,
  fiber: 0,
  micronutrient: 0,
});

const toDistribution = (counts: Record<TargetCategory, number>): CategoryWeights => {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (!total) {
    return {
      protein: 0.2,
      carb: 0.2,
      fat: 0.2,
      fiber: 0.2,
      micronutrient: 0.2,
    };
  }

  return {
    protein: counts.protein / total,
    carb: counts.carb / total,
    fat: counts.fat / total,
    fiber: counts.fiber / total,
    micronutrient: counts.micronutrient / total,
  };
};

const scoreCategoryBalance = (actual: CategoryWeights, target: CategoryWeights): number => {
  const distance =
    Math.abs(actual.protein - target.protein) +
    Math.abs(actual.carb - target.carb) +
    Math.abs(actual.fat - target.fat) +
    Math.abs(actual.fiber - target.fiber) +
    Math.abs(actual.micronutrient - target.micronutrient);

  const normalizedDistance = clamp(distance / 2, 0, 1);
  return (1 - normalizedDistance) * 100;
};

const computeSugarPenalty = (recipe: RecipeLike, menstrualPhase: MenstrualPhase): number => {
  const tokens = (recipe.ingredientTokens || []).map(normalize);
  const sugarHits = tokens.filter((token) => SUGAR_TOKENS.some((hint) => token.includes(hint))).length;

  if (!sugarHits) {
    return 0;
  }

  const perHitPenalty = menstrualPhase === "luteal" ? 6 : 3;
  return sugarHits * perHitPenalty;
};

const computeVarietyBonus = (counts: Record<TargetCategory, number>): number => {
  const uniqueCategoryCount = Object.values(counts).filter((count) => count > 0).length;
  return clamp((uniqueCategoryCount - 1) * 2, 0, 8);
};

const computeMoonAdjustment = (context: ScoreContext, categoryBalanceScore: number): number => {
  if (context.moonPhase === "new" || context.moonPhase === "full") {
    return categoryBalanceScore * 0.02;
  }

  if (context.moonPhase === "first_quarter" || context.moonPhase === "last_quarter") {
    return categoryBalanceScore * 0.015;
  }

  return 0;
};

const countRecipeCategories = (
  recipe: RecipeLike,
  ingredientCatalog: IngredientCatalogRecord[]
): Record<TargetCategory, number> => {
  const counts = emptyCategoryCounts();
  const catalogIndex = getCatalogIndex(ingredientCatalog);

  (recipe.ingredientIds || []).forEach((ingredientId) => {
    const ingredient = catalogIndex.get(ingredientId);
    const targetCategory = resolveTargetCategory(ingredient?.category);
    if (targetCategory) {
      counts[targetCategory] += 1;
    }
  });

  return counts;
};

export const scoreRecipe = (
  recipe: RecipeLike,
  context: ScoreContext,
  dietProfile: DietProfile,
  ingredientCatalog: IngredientCatalogRecord[]
): { score: number; breakdown: ScoreBreakdown } => {
  const dietCheck = recipeMatchesDiet(recipe, dietProfile, ingredientCatalog);

  if (!dietCheck.ok) {
    return {
      score: 0,
      breakdown: {
        dietOk: false,
        dietReasons: dietCheck.reasons,
        targetWeights: getTargetWeights(context.menstrualPhase, context.moonPhase),
        categoryCounts: emptyCategoryCounts(),
        categoryDistribution: toDistribution(emptyCategoryCounts()),
        categoryBalanceScore: 0,
        sugarPenalty: 0,
        varietyBonus: 0,
        moonAdjustment: 0,
        finalRawScore: 0,
      },
    };
  }

  const targetWeights = getTargetWeights(context.menstrualPhase, context.moonPhase);
  const categoryCounts = countRecipeCategories(recipe, ingredientCatalog);
  const categoryDistribution = toDistribution(categoryCounts);

  const categoryBalanceScore = scoreCategoryBalance(categoryDistribution, targetWeights);
  const sugarPenalty = computeSugarPenalty(recipe, context.menstrualPhase);
  const varietyBonus = computeVarietyBonus(categoryCounts);
  const moonAdjustment = computeMoonAdjustment(context, categoryBalanceScore);

  const rawScore = categoryBalanceScore - sugarPenalty + varietyBonus + moonAdjustment;
  const score = clamp(rawScore, 0, 100);

  return {
    score,
    breakdown: {
      dietOk: true,
      dietReasons: [],
      targetWeights,
      categoryCounts,
      categoryDistribution,
      categoryBalanceScore,
      sugarPenalty,
      varietyBonus,
      moonAdjustment,
      finalRawScore: rawScore,
    },
  };
};
