import type { PlannerHistory } from "./planTypes";

export const recipeRepeatHardBlock = (recipeId: string, history: PlannerHistory): boolean => {
  const prior = history.recipeCounts.get(recipeId) || 0;
  return prior > 0;
};

export const ingredientRepeatPenalty = (ingredientId: string, count: number): number => {
  if (!ingredientId || count <= 0) {
    return 0;
  }

  if (count === 1) {
    return 3;
  }

  return 3 + (count - 1) * 2;
};

export const computeIngredientDiversityPenalty = (
  ingredientIds: string[] | undefined,
  history: PlannerHistory
): number => {
  if (!ingredientIds?.length) {
    return 0;
  }

  return ingredientIds.reduce((total, ingredientId) => {
    const count = history.ingredientCounts.get(ingredientId) || 0;
    return total + ingredientRepeatPenalty(ingredientId, count);
  }, 0);
};

export const createEmptyHistory = (): PlannerHistory => ({
  recipeCounts: new Map(),
  ingredientCounts: new Map(),
});

export const applyMealToHistory = (history: PlannerHistory, recipeId: string, ingredientIds: string[]): void => {
  history.recipeCounts.set(recipeId, (history.recipeCounts.get(recipeId) || 0) + 1);

  ingredientIds.forEach((ingredientId) => {
    history.ingredientCounts.set(ingredientId, (history.ingredientCounts.get(ingredientId) || 0) + 1);
  });
};
