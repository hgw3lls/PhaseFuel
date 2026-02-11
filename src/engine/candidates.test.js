import test from "node:test";
import assert from "node:assert/strict";
import { getCandidatesByMealSlot } from "./candidates.js";

test("provider failure falls back to templates", async () => {
  const provider = {
    name: "broken-provider",
    async random() {
      throw new Error("network down");
    },
  };

  const result = await getCandidatesByMealSlot(
    { userId: "u-1", enableRecipeProvider: true },
    "2025-01-08",
    { enableRecipeProvider: true, provider }
  );

  assert.ok(result.breakfast.length > 0);
  assert.ok(result.lunch.length > 0);
  assert.ok(result.dinner.length > 0);
  assert.ok(result.snacks.length > 0);
  assert.equal(result.meta.usedProvider, false);
  assert.equal(result.meta.fallbackReason, "provider failure");
});
