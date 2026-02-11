import test from "node:test";
import assert from "node:assert/strict";
import { createRecipeCache } from "./cache.js";

test("cache returns values before TTL and expires after TTL", async () => {
  let nowValue = 1000;
  const cache = createRecipeCache({
    ttlMs: 100,
    now: () => nowValue,
    indexedDB: null,
  });

  await cache.set("mealdb", "1", { id: "1", name: "Test" });
  const immediate = await cache.get("mealdb", "1");
  assert.deepEqual(immediate, { id: "1", name: "Test" });

  nowValue = 1050;
  const withinTtl = await cache.get("mealdb", "1");
  assert.deepEqual(withinTtl, { id: "1", name: "Test" });

  nowValue = 1201;
  const expired = await cache.get("mealdb", "1");
  assert.equal(expired, null);
});
