import test from "node:test";
import assert from "node:assert/strict";
import { planWeekSolved } from "./weekPlanner.js";

const baseProfile = {
  userId: "user-1",
  lastPeriodStart: "2025-01-01",
  cycleLength: 28,
  periodLength: 5,
  ovulationOffset: 14,
  activityLevel: "moderate",
  goal: "maintain",
  calorieTarget: 2100,
  proteinTarget: 110,
  appetiteSupport: false,
  sleepSensitive: false,
  symptoms: {},
  constraints: {
    diet: "omnivore",
    noRepeatWindowDays: { dinner: 3 },
    maxPrepMinutesPerDay: 120,
    budgetTier: "moderate",
  },
  leftovers: {
    enabled: true,
    dinnerBatchThreshold: 3,
    lunchFraction: 0.65,
  },
  solver: {
    topK: 3,
  },
};

const c = (id, slot, partial = {}) => ({
  id,
  name: id,
  source: "recipe",
  slot,
  prepMinutes: 25,
  macros: { calories: 520, protein: 30, carbs: 55, fat: 18 },
  diets: ["omnivore"],
  allergens: [],
  ingredients: ["rice", "spinach"],
  budgetTier: "cheap",
  phaseFit: ["FOLLICULAR", "LUTEAL", "MENSTRUAL", "OVULATORY"],
  warmth: "WARM",
  digestion: "GENTLE",
  tags: ["comforting"],
  protein: "chicken",
  cuisine: "fusion",
  texture: "soft",
  batchServings: slot === "dinner" ? 4 : 1,
  ...partial,
});

const makeCandidates = () => ({
  breakfast: [
    c("b-1", "breakfast", { prepMinutes: 10, macros: { calories: 350, protein: 20, carbs: 35, fat: 12 } }),
    c("b-2", "breakfast", { prepMinutes: 12, macros: { calories: 360, protein: 22, carbs: 30, fat: 13 } }),
  ],
  lunch: [
    c("l-1", "lunch", { source: "template", prepMinutes: 12, protein: "tofu", cuisine: "mediterranean" }),
    c("l-2", "lunch", { source: "recipe", prepMinutes: 20, protein: "bean", cuisine: "latin" }),
  ],
  dinner: [
    c("d-1", "dinner", { protein: "salmon", cuisine: "japanese", texture: "brothy" }),
    c("d-2", "dinner", { protein: "turkey", cuisine: "american", texture: "hearty" }),
    c("d-3", "dinner", { protein: "tofu", cuisine: "thai", texture: "saucy" }),
    c("d-cold", "dinner", { warmth: "COLD", digestion: "HEAVY", tags: ["high-salt"], prepMinutes: 35 }),
  ],
  snacks: [
    c("s-1", "snack", { prepMinutes: 5, macros: { calories: 220, protein: 9, carbs: 24, fat: 8 }, source: "template" }),
    c("s-2", "snack", { prepMinutes: 4, macros: { calories: 240, protein: 10, carbs: 26, fat: 9 }, source: "template" }),
  ],
});

test("solver produces 7 days", () => {
  const plan = planWeekSolved(baseProfile, "2025-01-08", { candidatesByMealSlot: makeCandidates() });
  assert.equal(plan.days.length, 7);
  plan.days.forEach((day) => {
    assert.ok(day.meals.breakfast);
    assert.ok(day.meals.lunch);
    assert.ok(day.meals.dinner);
    assert.ok(Array.isArray(day.meals.snacks));
    assert.ok(day.meals.snacks.length >= 1);
  });
});

test("repeat avoidance works for dinner within window", () => {
  const plan = planWeekSolved(baseProfile, "2025-01-08", { candidatesByMealSlot: makeCandidates() });
  const dinners = plan.days.map((day) => day.meals.dinner.id);

  for (let i = 0; i < dinners.length; i += 1) {
    for (let j = i + 1; j < dinners.length; j += 1) {
      if (dinners[i] === dinners[j]) {
        assert.ok(j - i > 3, `Dinner repeat window violated: ${dinners[i]} at ${i} and ${j}`);
      }
    }
  }
});

test("menstrual + cramps yields warm/gentle bias", () => {
  const profile = {
    ...baseProfile,
    symptoms: { cramps: true },
    lastPeriodStart: "2025-01-08",
  };
  const plan = planWeekSolved(profile, "2025-01-08", { candidatesByMealSlot: makeCandidates() });
  const firstDinner = plan.days[0].meals.dinner;

  assert.notEqual(firstDinner.id, "d-cold");
  assert.equal(firstDinner.warmth, "WARM");
  assert.equal(firstDinner.digestion, "GENTLE");
});

test("luteal appetiteSupport adds second snack slot", () => {
  const profile = {
    ...baseProfile,
    appetiteSupport: true,
    lastPeriodStart: "2025-01-01",
  };

  const lutealStart = "2025-01-21";
  const plan = planWeekSolved(profile, lutealStart, { candidatesByMealSlot: makeCandidates() });
  const lutealDay = plan.days.find((day) => day.phase === "LUTEAL");

  assert.ok(lutealDay);
  assert.ok(lutealDay.meals.snacks.length >= 2);
});

test("determinism: same inputs => identical outputs", () => {
  const args = [baseProfile, "2025-01-08", { candidatesByMealSlot: makeCandidates() }];
  const planA = planWeekSolved(...args);
  const planB = planWeekSolved(...args);

  assert.deepEqual(planA, planB);
});
