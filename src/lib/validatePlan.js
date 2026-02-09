import { resolveIngredientTokens } from "./diet.ts";

export const validatePlan = (weeklyPlan, forbiddenTokens = new Set(), ingredientCatalog = []) => {
  if (!weeklyPlan?.days?.length) {
    return { valid: false, errors: ["Plan has no days."] };
  }

  const errors = [];
  weeklyPlan.days.forEach((day, dayIndex) => {
    Object.entries(day.meals || {}).forEach(([mealType, meal]) => {
      const tokens = resolveIngredientTokens(meal.ingredients || [], ingredientCatalog);
      const invalid = tokens.filter((token) => forbiddenTokens.has(token));
      if (invalid?.length) {
        errors.push(
          `Day ${dayIndex + 1} ${mealType} uses forbidden ingredients: ${invalid.join(", ")}.`
        );
      }
    });
  });

  return { valid: errors.length === 0, errors };
};
