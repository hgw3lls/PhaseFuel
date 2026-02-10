const normalize = (value) => (value || "").toLowerCase().trim();

const fetchJson = async (path) => {
  const response = await fetch(path);
  if (!response.ok) {
    const base = import.meta.env.BASE_URL;
    throw new Error(`Failed to load dataset at ${path} (${response.status}). Check BASE_URL (${base}) and GitHub Pages path configuration.`);
  }
  return response.json();
};

const validateMinimalSchema = ({ recipes, ingredients, indexes, aliasMap }) => {
  if (!Array.isArray(recipes)) {
    throw new Error("Recipes payload is missing or invalid.");
  }
  if (!Array.isArray(ingredients)) {
    throw new Error("Ingredient catalog payload is missing or invalid.");
  }
  if (!indexes || !indexes.byMealType || !indexes.byDietFlag || !indexes.byIngredientId) {
    throw new Error("Recipe index payload is missing expected sections.");
  }
  if (!aliasMap || typeof aliasMap !== "object") {
    throw new Error("Ingredient alias map payload is missing or invalid.");
  }
};

const buildDataStore = ({ recipes, ingredients, indexes, aliasMap }) => {
  const recipeIdToIndex = new Map();
  recipes.forEach((recipe, index) => {
    if (recipe?.id) {
      recipeIdToIndex.set(recipe.id, index);
    }
  });

  const ingredientById = new Map();
  const ingredientIdByName = new Map();
  ingredients.forEach((ingredient) => {
    if (!ingredient?.id) return;
    ingredientById.set(ingredient.id, ingredient);
    if (ingredient.name) {
      ingredientIdByName.set(normalize(ingredient.name), ingredient.id);
    }
  });

  const aliasLookup = new Map();
  Object.entries(aliasMap).forEach(([key, value]) => {
    aliasLookup.set(normalize(key), value);
  });

  const mapIndices = (indices) =>
    Array.isArray(indices) ? indices.map((index) => recipes[index]).filter(Boolean) : [];

  const getByMealType = (mealType) => mapIndices(indexes.byMealType[mealType] || []);

  const getByDietFlag = (flag) => mapIndices(indexes.byDietFlag[flag] || []);

  const getByIngredientId = (ingredientId) =>
    mapIndices(indexes.byIngredientId[ingredientId] || []);

  const intersectIndices = (indexArrays) => {
    const arrays = indexArrays.filter((array) => Array.isArray(array) && array.length);
    if (!arrays.length) return [];

    arrays.sort((a, b) => a.length - b.length);
    let intersection = new Set(arrays[0]);

    for (let i = 1; i < arrays.length; i += 1) {
      const next = new Set();
      arrays[i].forEach((index) => {
        if (intersection.has(index)) {
          next.add(index);
        }
      });
      intersection = next;
      if (!intersection.size) {
        return [];
      }
    }

    return Array.from(intersection);
  };

  const getMatching = ({ mealType, dietFlags, ingredientIds } = {}) => {
    const indexArrays = [];

    if (mealType) {
      indexArrays.push(indexes.byMealType[mealType] || []);
    }

    if (dietFlags?.length) {
      dietFlags.forEach((flag) => {
        indexArrays.push(indexes.byDietFlag[flag] || []);
      });
    }

    if (ingredientIds?.length) {
      ingredientIds.forEach((ingredientId) => {
        indexArrays.push(indexes.byIngredientId[ingredientId] || []);
      });
    }

    if (!indexArrays.length) {
      return recipes;
    }

    const matches = intersectIndices(indexArrays);
    return matches.map((index) => recipes[index]).filter(Boolean);
  };

  const searchIngredients = (prefix, limit = 20) => {
    const normalized = normalize(prefix);
    if (!normalized) return [];

    const results = [];
    const seen = new Set();

    for (const ingredient of ingredients) {
      if (results.length >= limit) break;
      const name = normalize(ingredient?.name);
      const aliases = ingredient?.aliases || [];
      const nameMatch = name.startsWith(normalized);
      const aliasMatch = aliases.some((alias) => normalize(alias).startsWith(normalized));

      if (nameMatch || aliasMatch) {
        if (!seen.has(ingredient.id)) {
          results.push(ingredient);
          seen.add(ingredient.id);
        }
      }
    }

    return results;
  };

  const resolveIngredient = (input) => {
    const normalized = normalize(input);
    if (!normalized) return null;

    const aliasHit = aliasLookup.get(normalized);
    if (aliasHit?.canonicalId) {
      return aliasHit.canonicalId;
    }

    const directId = ingredientIdByName.get(normalized);
    if (directId) {
      return directId;
    }

    const fallback = searchIngredients(normalized, 1);
    return fallback[0]?.id || null;
  };

  const getIngredientCategory = (ingredientName) => {
    const ingredientId = resolveIngredient(ingredientName);
    if (!ingredientId) return null;
    return ingredientById.get(ingredientId)?.category || null;
  };

  return {
    recipes,
    ingredients,
    indexes,
    aliasMap,
    recipeIdToIndex,
    ingredientById,
    ingredientIdByName,
    getByMealType,
    getByDietFlag,
    getByIngredientId,
    intersectIndices,
    getMatching,
    resolveIngredient,
    searchIngredients,
    getIngredientCategory,
    dietFlags: Object.keys(indexes.byDietFlag || {}),
    mealTypes: Object.keys(indexes.byMealType || {}),
  };
};

let cachePromise;

export const loadPhaseFuelData = async () => {
  if (cachePromise) {
    return cachePromise;
  }

  const base = import.meta.env.BASE_URL;
  cachePromise = Promise.all([
    fetchJson(`${base}data/recipes.phasefuel.canonical.json`),
    fetchJson(`${base}data/ingredients.canonical.catalog.json`),
    fetchJson(`${base}data/recipes.indexes.json`),
    fetchJson(`${base}data/ingredient.alias.map.json`),
  ]).then(([recipes, ingredients, indexes, aliasMap]) => {
    const payload = { recipes, ingredients, indexes, aliasMap };
    validateMinimalSchema(payload);
    return buildDataStore(payload);
  });

  return cachePromise;
};


export const loadData = loadPhaseFuelData;
