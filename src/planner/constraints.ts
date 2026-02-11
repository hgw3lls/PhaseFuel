import dietHintsData from "../config/dietHints.v1.json";

export type IngredientCatalogRecord = {
  id: string;
  name?: string;
  category?: string;
};

export type DietProfile = {
  glutenFree?: boolean;
  lowFodmap?: boolean;
  vegetarian?: boolean;
  pescatarian?: boolean;
  omnivore?: boolean;
  excludedIngredientIds?: string[];
  requiredIngredientIds?: string[];
};

export type RecipeLike = {
  id: string;
  ingredientIds?: string[];
  ingredientTokens?: string[];
  dietFlags?: string[];
  tags?: string[];
};

const DEFAULT_HIGH_FODMAP_HINTS = ["garlic", "onion", "shallot", "wheat", "rye", "barley", "cauliflower", "apple", "honey"];
const DEFAULT_MEAT_CATEGORY_HINTS = ["meat", "poultry", "beef", "pork", "lamb"];
const DEFAULT_FISH_CATEGORY_HINTS = ["fish", "seafood", "shellfish"];

const asHintArray = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;

const HIGH_FODMAP_HINTS = asHintArray(dietHintsData?.highFodmapHints, DEFAULT_HIGH_FODMAP_HINTS);
const MEAT_CATEGORY_HINTS = asHintArray(dietHintsData?.meatCategoryHints, DEFAULT_MEAT_CATEGORY_HINTS);
const FISH_CATEGORY_HINTS = asHintArray(dietHintsData?.fishCategoryHints, DEFAULT_FISH_CATEGORY_HINTS);

const normalize = (value: string): string => value.toLowerCase().trim();

const getCatalogIndex = (ingredientCatalog: IngredientCatalogRecord[]): Map<string, IngredientCatalogRecord> =>
  new Map((ingredientCatalog || []).filter((item) => item?.id).map((item) => [item.id, item]));

const includesAnyHint = (value: string, hints: string[]): boolean => {
  const normalized = normalize(value);
  return hints.some((hint) => normalized.includes(hint));
};

const ingredientLooksHighFodmap = (ingredient?: IngredientCatalogRecord): boolean => {
  if (!ingredient?.name) return false;
  return includesAnyHint(ingredient.name, HIGH_FODMAP_HINTS);
};

const ingredientLooksMeat = (ingredient?: IngredientCatalogRecord): boolean => {
  if (!ingredient) return false;
  return includesAnyHint(ingredient.category || "", MEAT_CATEGORY_HINTS) || includesAnyHint(ingredient.name || "", MEAT_CATEGORY_HINTS);
};

const ingredientLooksFish = (ingredient?: IngredientCatalogRecord): boolean => {
  if (!ingredient) return false;
  return includesAnyHint(ingredient.category || "", FISH_CATEGORY_HINTS) || includesAnyHint(ingredient.name || "", FISH_CATEGORY_HINTS);
};

export const recipeMatchesDiet = (
  recipe: RecipeLike,
  dietProfile: DietProfile,
  ingredientCatalog: IngredientCatalogRecord[]
): { ok: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const ingredientIds = recipe.ingredientIds || [];
  const dietFlags = recipe.dietFlags || [];
  const excludedIds = new Set(dietProfile.excludedIngredientIds || []);
  const requiredIds = new Set(dietProfile.requiredIngredientIds || []);
  const catalogIndex = getCatalogIndex(ingredientCatalog);

  if (dietProfile.glutenFree && dietFlags.includes("contains_gluten_candidate")) {
    reasons.push("contains_gluten_candidate");
  }

  const hasExcludedIngredient = ingredientIds.some((ingredientId) => excludedIds.has(ingredientId));
  if (hasExcludedIngredient) {
    reasons.push("contains_excluded_ingredient");
  }

  const missingRequired = Array.from(requiredIds).filter((ingredientId) => !ingredientIds.includes(ingredientId));
  if (missingRequired.length) {
    reasons.push(`missing_required_ingredients:${missingRequired.join(",")}`);
  }

  if (dietProfile.lowFodmap) {
    const highFodmapFound = ingredientIds.some((ingredientId) => ingredientLooksHighFodmap(catalogIndex.get(ingredientId)));
    if (highFodmapFound) {
      reasons.push("contains_high_fodmap_known");
    }
  }

  const containsMeat = ingredientIds.some((ingredientId) => ingredientLooksMeat(catalogIndex.get(ingredientId)));
  const containsFish = ingredientIds.some((ingredientId) => ingredientLooksFish(catalogIndex.get(ingredientId)));

  if (dietProfile.vegetarian && (containsMeat || containsFish)) {
    reasons.push("not_vegetarian");
  }

  if (dietProfile.pescatarian && containsMeat) {
    reasons.push("not_pescatarian");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
};
