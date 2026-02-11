import test from "node:test";
import assert from "node:assert/strict";
import { migrateIfNeeded } from "./migrate.js";
import { loadUserData } from "./storage.js";

const createLocalStorageMock = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] || null,
    get length() {
      return store.size;
    },
  };
};

test.beforeEach(() => {
  globalThis.localStorage = createLocalStorageMock();
});

test("migration runs once and sets flag", () => {
  localStorage.setItem(
    "phasefuel_meal_plans",
    JSON.stringify({
      alex: {
        cycle_day: 3,
        symptoms: "cramps",
        weekly_plan: {
          startDateISO: "2025-01-01",
          days: [{ dateISO: "2025-01-01", meals: { breakfast: { name: "Old oats" } } }],
        },
      },
    })
  );

  const first = migrateIfNeeded("alex");
  const second = migrateIfNeeded("alex");

  assert.equal(first.migrated, true);
  assert.equal(second.reason, "already-migrated");
});

test("legacy plan maps into v2 and strips key-like fields", () => {
  localStorage.setItem(
    "phasefuel_plans_alex",
    JSON.stringify({
      text: "Legacy notes",
      openaiApiKey: "should-not-survive",
      weekly_plan: {
        startDateISO: "2025-01-01",
        days: [{ dateISO: "2025-01-01", note: "freeform day", meals: { dinner: { name: "Stew" } } }],
      },
    })
  );

  migrateIfNeeded("alex");
  const loaded = loadUserData("alex");

  assert.equal(loaded.plans.length, 1);
  assert.equal(loaded.plans[0].version, 2);
  assert.equal(loaded.plans[0].days[0].meals.dinner.name, "Stew");
  assert.equal(loaded.plans[0].days[0].notes, "freeform day");
  assert.equal(loaded.profile.openaiApiKey, undefined);
});
