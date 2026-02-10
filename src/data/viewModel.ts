import type { Recipe } from "./query";

export type RecipeCardViewModel = {
  id: string;
  title: string;
  mealTypes: string[];
  ingredientPreview: string;
  source?: string;
};

export const toRecipeCard = (recipe: Recipe): RecipeCardViewModel => {
  const ingredients = recipe.ingredientTokens || [];

  return {
    id: recipe.id,
    title: recipe.name,
    mealTypes: recipe.mealType ? [recipe.mealType] : [],
    ingredientPreview: ingredients.slice(0, 3).join(", "),
    source: (recipe as { source?: string }).source,
  };
};
