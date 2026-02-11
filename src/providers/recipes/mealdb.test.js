import test from "node:test";
import assert from "node:assert/strict";
import { mapMealDbMeal, createMealDbProvider } from "./mealdb.js";

const sampleMeal = {
  idMeal: "52772",
  strMeal: "Teriyaki Chicken Casserole",
  strCategory: "Chicken",
  strArea: "Japanese",
  strInstructions: "Bake and serve.",
  strMealThumb: "https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg",
  strTags: "Meat,Casserole",
  strYoutube: "https://www.youtube.com/watch?v=4aZr5hZXP_s",
  strIngredient1: "soy sauce",
  strMeasure1: "3/4 cup",
  strIngredient2: "water",
  strMeasure2: "1/2 cup",
  strIngredient3: "",
  strMeasure3: "",
};

test("mapMealDbMeal maps payload to normalized model", () => {
  const mapped = mapMealDbMeal(sampleMeal);
  assert.equal(mapped.id, "52772");
  assert.equal(mapped.source, "mealdb");
  assert.equal(mapped.name, "Teriyaki Chicken Casserole");
  assert.equal(mapped.cuisine, "Japanese");
  assert.equal(mapped.category, "Chicken");
  assert.deepEqual(mapped.tags, ["meat", "casserole"]);
  assert.deepEqual(mapped.ingredients, [
    { name: "soy sauce", measure: "3/4 cup" },
    { name: "water", measure: "1/2 cup" },
  ]);
  assert.deepEqual(mapped.sourceAttribution, {
    name: "TheMealDB",
    link: "https://www.themealdb.com/",
  });
});

test("provider getById uses cache after first lookup", async () => {
  let calls = 0;
  const provider = createMealDbProvider({
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { meals: [sampleMeal] };
        },
      };
    },
    cache: {
      async get() {
        return null;
      },
      async set() {
        return null;
      },
    },
  });

  const meal = await provider.getById("52772");
  assert.equal(meal?.id, "52772");
  assert.equal(calls, 1);
});
