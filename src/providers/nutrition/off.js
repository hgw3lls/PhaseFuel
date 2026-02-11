import { createRecipeCache } from "../cache.js";
import { createThrottledRequester } from "../http.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OFF_TTL_MS = 30 * DAY_MS;
const OFF_BASE_URL = "https://world.openfoodfacts.org";
const OFF_USER_AGENT = "PhaseFuel/1.0 (contact: support@phasefuel.local)";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapProduct = (product) => {
  const nutrients = product?.nutriments || {};
  return {
    id: String(product?.id || product?._id || product?.code || ""),
    source: "off",
    name: product?.product_name || product?.generic_name || "Unknown product",
    servingSize: product?.serving_size || "100 g",
    barcode: product?.code || undefined,
    nutrients: {
      calories: toNumber(nutrients["energy-kcal_100g"] || nutrients["energy-kcal"]),
      protein: toNumber(nutrients.proteins_100g || nutrients.proteins),
      carbs: toNumber(nutrients.carbohydrates_100g || nutrients.carbohydrates),
      fat: toNumber(nutrients.fat_100g || nutrients.fat),
      micros: undefined,
    },
  };
};

export const createOffProvider = ({
  fetchImpl = globalThis.fetch,
  cache = createRecipeCache({ ttlMs: OFF_TTL_MS }),
  minIntervalMs = 500,
} = {}) => {
  const requester = createThrottledRequester({ minIntervalMs, fetchImpl });

  const getJson = async (url) => {
    const response = await requester.request(url, (fetcher) =>
      fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": OFF_USER_AGENT,
        },
      })
    );
    if (!response.ok) throw new Error(`OFF request failed: ${response.status}`);
    return response.json();
  };

  const lookupBarcode = async (barcode) => {
    const key = `barcode:${barcode}`;
    const cached = await cache.get("off", key);
    if (cached) return cached;

    const payload = await getJson(`${OFF_BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}.json`);
    const product = payload?.product;
    if (!product) return null;
    const mapped = mapProduct(product);
    await cache.set("off", key, mapped);
    return mapped;
  };

  const searchFoods = async (query) => {
    if (!query?.trim()) return [];
    const payload = await getJson(
      `${OFF_BASE_URL}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10`
    );
    const products = Array.isArray(payload?.products) ? payload.products : [];
    return products.map(mapProduct).filter((item) => item.id);
  };

  const getNutrition = async (foodId, amount = { value: 100, unit: "g" }) => {
    const barcode = String(foodId).replace(/^barcode:/, "");
    const hit = await lookupBarcode(barcode);
    if (!hit) throw new Error("OFF product not found");
    const scale = Number(amount.value || 100) / 100;
    return {
      calories: hit.nutrients.calories * scale,
      protein: hit.nutrients.protein * scale,
      carbs: hit.nutrients.carbs * scale,
      fat: hit.nutrients.fat * scale,
      micros: undefined,
    };
  };

  return {
    name: "off",
    searchFoods,
    getNutrition,
    lookupBarcode,
  };
};

export { OFF_TTL_MS, OFF_USER_AGENT };
