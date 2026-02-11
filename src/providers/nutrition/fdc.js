import { createThrottledRequester } from "../http.js";

const nutrientValue = (nutrients, labels) => {
  if (!Array.isArray(nutrients)) return 0;
  const target = nutrients.find((item) => labels.includes(String(item.nutrientName || "").toLowerCase()));
  return Number(target?.value || 0);
};

const normalizeNutrients = (nutrients, amountScale = 1) => ({
  calories: nutrientValue(nutrients, ["energy", "energy (kcal)"]) * amountScale,
  protein: nutrientValue(nutrients, ["protein"]) * amountScale,
  carbs: nutrientValue(nutrients, ["carbohydrate, by difference", "carbohydrate"]) * amountScale,
  fat: nutrientValue(nutrients, ["total lipid (fat)", "fat"]) * amountScale,
  micros: undefined,
});

export const createFdcProvider = ({
  baseUrl = "/api/fdc",
  fetchImpl = globalThis.fetch,
  minIntervalMs = 1200,
} = {}) => {
  const requester = createThrottledRequester({ minIntervalMs, fetchImpl });

  const getJson = async (path) => {
    const url = `${baseUrl}${path}`;
    const response = await requester.request(url, (fetcher) =>
      fetcher(url, { headers: { Accept: "application/json" } })
    );
    if (!response.ok) throw new Error(`FDC request failed: ${response.status}`);
    return response.json();
  };

  const searchFoods = async (query) => {
    if (!query?.trim()) return [];
    const payload = await getJson(`/search?query=${encodeURIComponent(query.trim())}`);
    const foods = Array.isArray(payload?.foods) ? payload.foods : [];
    return foods.map((food) => ({
      id: String(food.fdcId),
      source: "fdc",
      name: food.description,
      servingSize: food.servingSize ? `${food.servingSize} ${food.servingSizeUnit || ""}`.trim() : "100 g",
      nutrients: normalizeNutrients(food.foodNutrients || [], 1),
    }));
  };

  const getNutrition = async (foodId, amount = { value: 100, unit: "g" }) => {
    const payload = await getJson(`/food/${encodeURIComponent(foodId)}`);
    const nutrients = normalizeNutrients(payload?.foodNutrients || [], 1);
    const grams = Number(amount.value || 100);
    const scale = Number.isFinite(grams) && grams > 0 ? grams / 100 : 1;
    return {
      calories: nutrients.calories * scale,
      protein: nutrients.protein * scale,
      carbs: nutrients.carbs * scale,
      fat: nutrients.fat * scale,
      micros: undefined,
    };
  };

  return {
    name: "fdc",
    searchFoods,
    getNutrition,
  };
};
