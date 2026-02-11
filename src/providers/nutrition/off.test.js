import test from "node:test";
import assert from "node:assert/strict";
import { createOffProvider, OFF_USER_AGENT } from "./off.js";

test("OFF provider uses cache to reduce repeated calls and sets User-Agent", async () => {
  let calls = 0;
  let seenUserAgent = "";
  const provider = createOffProvider({
    fetchImpl: async (_url, options = {}) => {
      calls += 1;
      seenUserAgent = options.headers?.["User-Agent"] || "";
      return {
        ok: true,
        async json() {
          return {
            product: {
              code: "3017620422003",
              product_name: "Hazelnut Spread",
              nutriments: {
                "energy-kcal_100g": 539,
                proteins_100g: 6.3,
                carbohydrates_100g: 57.5,
                fat_100g: 30.9,
              },
            },
          };
        },
      };
    },
    minIntervalMs: 0,
  });

  const a = await provider.lookupBarcode("3017620422003");
  const b = await provider.lookupBarcode("3017620422003");
  assert.equal(a?.name, "Hazelnut Spread");
  assert.equal(b?.name, "Hazelnut Spread");
  assert.equal(calls, 1);
  assert.equal(seenUserAgent, OFF_USER_AGENT);
});
