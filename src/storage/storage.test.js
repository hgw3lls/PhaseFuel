import test from "node:test";
import assert from "node:assert/strict";
import {
  exportUserData,
  importUserData,
  loadUserData,
  resetUserData,
  saveUserData,
} from "./storage.js";

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

test("export/import roundtrip retains plans", () => {
  saveUserData("alex", {
    profile: { cycleLength: 28 },
    plans: [{ version: 2, startDate: "2025-01-01", days: [] }],
  });

  const exported = exportUserData("alex");
  resetUserData("alex");
  importUserData("alex", exported);

  const loaded = loadUserData("alex");
  assert.equal(loaded.plans.length, 1);
  assert.equal(loaded.profile.cycleLength, 28);
});

test("import merge keeps existing profile values by default", () => {
  saveUserData("alex", {
    profile: { cycleLength: 28, goal: "maintain" },
    plans: [],
  });

  importUserData("alex", {
    profile: { cycleLength: 30, goal: null, appetiteSupport: true },
    plans: [],
  });

  const loaded = loadUserData("alex");
  assert.equal(loaded.profile.cycleLength, 30);
  assert.equal(loaded.profile.goal, "maintain");
  assert.equal(loaded.profile.appetiteSupport, true);
});
