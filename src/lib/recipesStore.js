import recipes from "../../data/out/recipes.normalized.json";
import ingredientCatalog from "../../data/out/ingredients.catalog.json";
import ingredientCategories from "../../data/out/ingredient.categories.json";

export const loadRecipes = () => recipes;

export const loadIngredientCatalog = () => ingredientCatalog;

export const loadIngredientCategories = () => ingredientCategories;
