const GLUTEN_GRAINS = ["wheat", "barley", "rye"];

const DIET_EXCLUSIONS = {
  pescatarian: ["beef", "pork", "chicken", "turkey", "lamb"],
  vegetarian: ["beef", "pork", "chicken", "turkey", "lamb", "fish", "shrimp"],
  vegan: ["beef", "pork", "chicken", "turkey", "lamb", "fish", "shrimp", "egg", "dairy"],
};

const normalizeName = (value) => value.toLowerCase().trim();

export const compileAllowed = (profile, ingredientCatalog = []) => {
  const allowedIngredients = new Set();
  const forbiddenIngredients = new Set();
  const cautionIngredients = new Set();

  const strictness = Number.isFinite(profile?.fodmapStrictness)
    ? profile.fodmapStrictness
    : 0.6;
  const includeCaution = strictness < 0.6;

  ingredientCatalog.forEach((ingredient) => {
    const name = normalizeName(ingredient.name);
    const fodmap = ingredient.fodmapLevel || "low";
    const isCaution = fodmap === "caution";
    const isHigh = fodmap === "high";

    if (profile?.lowFodmap && (isHigh || (isCaution && !includeCaution))) {
      forbiddenIngredients.add(name);
      if (isCaution) {
        cautionIngredients.add(name);
      }
      return;
    }

    if (profile?.glutenFree) {
      const hasUnsafeOats = name.includes("oats") && ingredient.glutenFreeSafe !== true;
      if (GLUTEN_GRAINS.some((grain) => name.includes(grain)) || hasUnsafeOats) {
        forbiddenIngredients.add(name);
        return;
      }
    }

    const exclusions = DIET_EXCLUSIONS[profile?.dietPattern] || [];
    if (exclusions.some((excluded) => name.includes(excluded))) {
      forbiddenIngredients.add(name);
      return;
    }

    allowedIngredients.add(name);
    if (isCaution) {
      cautionIngredients.add(name);
    }
  });

  (profile?.avoidIngredients || []).forEach((ingredient) => {
    forbiddenIngredients.add(normalizeName(ingredient));
  });

  return {
    allowedIngredients: Array.from(allowedIngredients),
    forbiddenIngredients: Array.from(forbiddenIngredients),
    cautionIngredients: Array.from(cautionIngredients),
  };
};

export const isIngredientForbidden = (ingredientName, forbiddenIngredients) => {
  const name = normalizeName(ingredientName);
  return forbiddenIngredients.some((forbidden) => name.includes(forbidden));
};
