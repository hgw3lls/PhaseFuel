import type { Recipe, UserProfile } from "./types";
import { PHASE_GUIDANCE } from "./guidance";
import type { IngredientRecord } from "../diet";
import { resolveIngredientTokens } from "../diet";

const normalizeName = (value: string) => value.toLowerCase().trim();

const getRecipeIngredients = (recipe: Recipe) => recipe.ingredientTokens || recipe.ingredients || [];

const scoreIngredientRepetition = (
  ingredients: string[],
  ingredientCounts: Map<string, number>
) =>
  ingredients.reduce((penalty, ingredient) => {
    const count = ingredientCounts.get(normalizeName(ingredient)) || 0;
    return penalty + Math.max(0, count - 1) * 0.5;
  }, 0);

const scoreBudgetFit = (recipe: Recipe, profile: UserProfile) => {
  const map = { tight: "budget", normal: "balanced", generous: "premium" } as const;
  const desired = map[profile.budgetLevel] || "balanced";
  if (recipe.costLevel === desired) return 1.5;
  if (recipe.costLevel === "budget" && desired !== "premium") return 1;
  return -1;
};

export const scoreRecipe = ({
  recipe,
  phase,
  symptomTags,
  usedRecipeCounts,
  ingredientCounts,
  profile,
  maxRepeats,
  forbiddenTokens,
  ingredientCatalog,
}: {
  recipe: Recipe;
  phase: keyof typeof PHASE_GUIDANCE;
  symptomTags: string[];
  usedRecipeCounts: Map<string, number>;
  ingredientCounts: Map<string, number>;
  profile: UserProfile;
  maxRepeats: number;
  forbiddenTokens: Set<string>;
  ingredientCatalog: IngredientRecord[];
}) => {
  const rationale: string[] = [];
  let score = 0;

  const recipeIngredients = getRecipeIngredients(recipe);
  const recipeTokens = resolveIngredientTokens(recipeIngredients, ingredientCatalog);
  if (recipeTokens.some((token) => forbiddenTokens.has(token))) {
    return { score: -999, rationale: ["Excluded for diet constraints."] };
  }
  if (
    profile.avoidIngredients.some((ingredient) =>
      recipeIngredients.join(" ").toLowerCase().includes(ingredient.toLowerCase())
    )
  ) {
    return { score: -999, rationale: ["Excluded for avoid list."] };
  }

  const guidance = PHASE_GUIDANCE[phase];
  guidance.targetTags.forEach((tag) => {
    if (recipe.tags.includes(tag)) {
      score += 2;
    }
  });
  guidance.avoidTags.forEach((tag) => {
    if (recipe.tags.includes(tag)) {
      score -= 2;
    }
  });
  const phaseHits = recipe.tags.filter((tag) => guidance.targetTags.includes(tag));
  if (phaseHits.length) {
    rationale.push(`Supports ${phase} phase with ${phaseHits.slice(0, 2).join(" & ")} tags.`);
  }

  const symptomHits = recipe.tags.filter((tag) => symptomTags.includes(tag));
  if (symptomHits.length) {
    score += symptomHits.length * 1.5;
    rationale.push(`Targets symptoms with ${symptomHits.slice(0, 2).join(" & ")}.`);
  }

  profile.preferTags.forEach((tag) => {
    if (recipe.tags.includes(tag)) {
      score += 1;
    }
  });

  if (profile.timeBudgetMin && recipe.timeMinutes > profile.timeBudgetMin) {
    score -= 2;
    rationale.push("Exceeds time budget.");
  }

  score += scoreBudgetFit(recipe, profile);

  const usedCount = usedRecipeCounts.get(recipe.id) || 0;
  if (usedCount >= maxRepeats) {
    return { score: -999, rationale: ["Exceeded max repeats."] };
  }
  if (usedCount > 0) {
    score -= usedCount * 3;
  }

  score -= scoreIngredientRepetition(recipeIngredients, ingredientCounts);

  if (!rationale.length) {
    rationale.push("Balanced fit for the week.");
  }

  return { score, rationale };
};
