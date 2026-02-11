import { createRecipeCache } from "../cache.js";

const MEAL_DB_BASE_URL = "https://www.themealdb.com/api/json/v1/1";
// The public test key "1" is for development/education only.
// Public release distribution should use a supporter key per TheMealDB docs.
const MEAL_DB_DEV_KEY = "1";

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const parseTags = (meal) => {
  const raw = trim(meal.strTags);
  if (!raw) return [];
  return raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
};

const extractIngredients = (meal) => {
  const ingredients = [];
  for (let i = 1; i <= 20; i += 1) {
    const name = trim(meal[`strIngredient${i}`]);
    if (!name) continue;
    ingredients.push({
      name,
      measure: trim(meal[`strMeasure${i}`]),
    });
  }
  return ingredients;
};

export const mapMealDbMeal = (meal) => {
  if (!meal) return null;
  return {
    id: String(meal.idMeal),
    source: "mealdb",
    name: trim(meal.strMeal),
    image: trim(meal.strMealThumb) || null,
    url: trim(meal.strSource) || trim(meal.strYoutube) || undefined,
    ingredients: extractIngredients(meal),
    instructions: trim(meal.strInstructions) || undefined,
    tags: parseTags(meal),
    cuisine: trim(meal.strArea) || undefined,
    category: trim(meal.strCategory) || undefined,
    nutrition: undefined,
    sourceAttribution: {
      name: "TheMealDB",
      link: "https://www.themealdb.com/",
    },
  };
};

const withQuery = (path) => `${MEAL_DB_BASE_URL}/${MEAL_DB_DEV_KEY}/${path}`;

const toMealArray = (payload) => (Array.isArray(payload?.meals) ? payload.meals : []);

export const createMealDbProvider = ({
  fetchImpl = globalThis.fetch,
  cache = createRecipeCache(),
} = {}) => {
  if (!fetchImpl) {
    throw new Error("Fetch is not available for mealdb provider");
  }

  const getJson = async (path) => {
    const response = await fetchImpl(withQuery(path));
    if (!response.ok) {
      throw new Error(`MealDB request failed: ${response.status}`);
    }
    return response.json();
  };

  const getById = async (id) => {
    const cached = await cache.get("mealdb", id);
    if (cached) return cached;

    const payload = await getJson(`lookup.php?i=${encodeURIComponent(id)}`);
    const meal = toMealArray(payload)[0];
    if (!meal) return null;

    const mapped = mapMealDbMeal(meal);
    await cache.set("mealdb", mapped.id, mapped);
    return mapped;
  };

  const search = async (query, filters = {}) => {
    const term = trim(query);
    if (!term) return [];

    const payload = await getJson(`search.php?s=${encodeURIComponent(term)}`);
    const meals = toMealArray(payload)
      .map(mapMealDbMeal)
      .filter(Boolean)
      .filter((meal) => {
        if (filters.cuisine && meal.cuisine !== filters.cuisine) return false;
        if (filters.category && meal.category !== filters.category) return false;
        return true;
      });

    const limit = Number(filters.limit || 0);
    if (limit > 0) return meals.slice(0, limit);
    return meals;
  };

  const random = async (filters = {}) => {
    const limit = Math.max(1, Number(filters.limit || 3));

    if (filters.cuisine) {
      const payload = await getJson(`filter.php?a=${encodeURIComponent(filters.cuisine)}`);
      const meals = toMealArray(payload);
      return meals.slice(0, limit).map((meal) => ({
        id: String(meal.idMeal),
        source: "mealdb",
        name: trim(meal.strMeal),
        image: trim(meal.strMealThumb) || null,
        url: undefined,
        ingredients: [],
        tags: [],
        cuisine: filters.cuisine,
        category: undefined,
        nutrition: undefined,
        sourceAttribution: {
          name: "TheMealDB",
          link: "https://www.themealdb.com/",
        },
      }));
    }

    const batches = await Promise.all(
      Array.from({ length: limit }, () => getJson("random.php"))
    );

    return batches
      .flatMap((payload) => toMealArray(payload))
      .map(mapMealDbMeal)
      .filter(Boolean);
  };

  return {
    name: "mealdb",
    search,
    getById,
    random,
    sourceAttribution: {
      name: "TheMealDB",
      link: "https://www.themealdb.com/",
    },
  };
};

export { MEAL_DB_DEV_KEY };
