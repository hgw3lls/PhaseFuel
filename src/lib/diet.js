const GLUTEN_GRAINS = ["wheat", "barley", "rye"];

const DIET_EXCLUSIONS = {
  pescatarian: ["beef", "pork", "chicken", "turkey", "lamb"],
  vegetarian: ["beef", "pork", "chicken", "turkey", "lamb", "fish", "shrimp"],
  vegan: ["beef", "pork", "chicken", "turkey", "lamb", "fish", "shrimp", "egg", "dairy"],
};

const normalizeName = (value) => value.toLowerCase().trim();

const buildLookup = (catalog) => {
  const lookup = new Map();
  catalog.forEach((record) => {
    const token = normalizeName(record.token || record.name || "");
    if (!token) return;
    lookup.set(token, record);
    (record.aliases || []).forEach((alias) => {
      lookup.set(normalizeName(alias), record);
    });
  });
  return lookup;
};

export const resolveIngredientTokens = (ingredients, catalog = []) => {
  const lookup = buildLookup(catalog);
  return ingredients.map((ingredient) => {
    const key = normalizeName(ingredient);
    const record = lookup.get(key);
    return normalizeName(record?.token || record?.name || "") || key;
  });
};

export const compileAllowed = (profile, ingredientCatalog = []) => {
  const allowedIngredients = new Set();
  const forbiddenIngredients = new Set();
  const cautionIngredients = new Set();

  const strictness = Number.isFinite(profile?.fodmapStrictness)
    ? profile.fodmapStrictness
    : 0.6;
  const includeCaution = strictness < 0.6;

  ingredientCatalog.forEach((ingredient) => {
    const name = normalizeName(ingredient.name || ingredient.token || "");
    if (!name) return;
    const fodmap = ingredient.fodmap || ingredient.fodmapLevel || "low";
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
      const glutenSafe = ingredient.glutenFreeSafe === true;
      const hasUnsafeOats = name.includes("oats") && !glutenSafe;
      const gluten = Boolean(ingredient.gluten);
      if (gluten || GLUTEN_GRAINS.some((grain) => name.includes(grain)) || hasUnsafeOats) {
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
