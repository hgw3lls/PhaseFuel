import test from "node:test";
import assert from "node:assert/strict";
import { estimateCandidateNutrition } from "./nutritionBridge.js";

test("macro estimation produces stable outputs", async () => {
  const candidate = {
    id: "r1",
    ingredients: [
      { name: "rice", measure: "100 g" },
      { name: "chicken", measure: "100 g" },
    ],
  };

  const fdcProvider = {
    async searchFoods(query) {
      return [{ id: query, source: "fdc", name: query }];
    },
    async getNutrition(foodId) {
      if (foodId === "rice") return { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 };
      return { calories: 165, protein: 31, carbs: 0, fat: 3.6 };
    },
  };

  const macrosA = await estimateCandidateNutrition(candidate, { fdcProvider, nutritionSources: { fdc: true, off: false } });
  const macrosB = await estimateCandidateNutrition(candidate, { fdcProvider, nutritionSources: { fdc: true, off: false } });

  assert.deepEqual(macrosA, macrosB);
  assert.equal(Math.round(macrosA.calories), 295);
  assert.equal(Math.round(macrosA.protein), 34);
});
