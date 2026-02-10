import { loadPhaseFuelData } from "../lib/recipesStore.js";
import {
  indicesByDietFlag,
  indicesByMealType,
  initializeQueryEngine,
} from "./query";
import { initializeIngredientResolver } from "./ingredients";

type IdleScheduler = (cb: () => void) => void;

const scheduleIdle: IdleScheduler =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (cb) => {
        window.requestIdleCallback(() => cb(), { timeout: 350 });
      }
    : (cb) => {
        setTimeout(cb, 0);
      };

let warmupPromise: Promise<Awaited<ReturnType<typeof loadPhaseFuelData>>> | null = null;

const warmCommonIndexes = () => {
  scheduleIdle(() => {
    indicesByMealType("breakfast");
    indicesByMealType("lunch");
    indicesByMealType("dinner");
    indicesByDietFlag("vegetarian_candidate");
    indicesByDietFlag("pescatarian_candidate");
  });
};

export const warmPhaseFuelData = async () => {
  if (warmupPromise) return warmupPromise;

  warmupPromise = loadPhaseFuelData().then((data) => {
    initializeQueryEngine({ recipes: data.recipes, indexes: data.indexes });
    initializeIngredientResolver({
      ingredients: data.ingredients,
      aliasMap: data.aliasMap,
    });
    warmCommonIndexes();
    return data;
  });

  return warmupPromise;
};
