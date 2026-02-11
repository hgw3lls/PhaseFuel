const normalizeName = (value) => String(value || "").trim().toLowerCase();

const sumMacros = (a, b) => ({
  calories: (a.calories || 0) + (b.calories || 0),
  protein: (a.protein || 0) + (b.protein || 0),
  carbs: (a.carbs || 0) + (b.carbs || 0),
  fat: (a.fat || 0) + (b.fat || 0),
  micros: undefined,
});

const getIngredientFields = (ingredient) => {
  if (typeof ingredient === "string") {
    return { name: ingredient, measure: "", barcode: "" };
  }
  return {
    name: ingredient?.name || "",
    measure: ingredient?.measure || "",
    barcode: ingredient?.barcode || "",
  };
};

const guessAmount = (measure) => {
  const match = String(measure || "").match(/(\d+(?:\.\d+)?)/);
  const value = match ? Number(match[1]) : 100;
  if (String(measure || "").toLowerCase().includes("oz")) return value * 28.35;
  if (String(measure || "").toLowerCase().includes("lb")) return value * 453.6;
  if (String(measure || "").toLowerCase().includes("kg")) return value * 1000;
  return value;
};

export const estimateCandidateNutrition = async (
  candidate,
  {
    fdcProvider,
    offProvider,
    nutritionSources = { fdc: true, off: true },
    lowDataMode = false,
    cache = new Map(),
  } = {}
) => {
  if (!candidate) return { calories: 0, protein: 0, carbs: 0, fat: 0, micros: undefined };
  if (candidate.nutrition) return candidate.nutrition;
  if (candidate.macros) return candidate.macros;

  const ingredients = Array.isArray(candidate.ingredients) ? candidate.ingredients : [];
  let total = { calories: 0, protein: 0, carbs: 0, fat: 0, micros: undefined };

  for (const ingredient of ingredients) {
    const { name, measure, barcode } = getIngredientFields(ingredient);
    const grams = guessAmount(measure);

    try {
      if (nutritionSources.off && barcode && offProvider) {
        const cacheKey = `off:${barcode}:${grams}`;
        const cached = cache.get(cacheKey);
        const macros = cached || (await offProvider.getNutrition(barcode, { value: grams, unit: "g" }));
        if (!cached) cache.set(cacheKey, macros);
        total = sumMacros(total, macros);
        continue;
      }

      if (nutritionSources.fdc && fdcProvider) {
        const query = normalizeName(name);
        if (!query) continue;
        const cacheKey = `fdc-search:${query}`;
        const hits = cache.get(cacheKey) || (await fdcProvider.searchFoods(query));
        if (!cache.has(cacheKey)) cache.set(cacheKey, hits);
        const firstHit = hits[0];
        if (!firstHit) continue;

        const detailKey = `fdc-nutrition:${firstHit.id}:${grams}`;
        const macros = cache.get(detailKey) ||
          (await fdcProvider.getNutrition(firstHit.id, { value: grams, unit: "g" }));
        if (!cache.has(detailKey)) cache.set(detailKey, macros);
        total = sumMacros(total, macros);
      }
    } catch (error) {
      if (!lowDataMode) {
        continue;
      }
      break;
    }
  }

  return total;
};
