import test from "node:test";
import assert from "node:assert/strict";
import { buildDaySignals, planDay } from "./planner.js";

const baseProfile = {
  lastPeriodStart: "2025-01-01",
  cycleLength: 28,
  periodLength: 5,
  ovulationOffset: 14,
  activityLevel: "moderate",
  goal: "maintain",
  calorieTarget: 2100,
  proteinTarget: 110,
  appetiteSupport: false,
  symptoms: {},
};

test("planDay is stable for same inputs", () => {
  const today = new Date("2025-01-03T12:00:00Z");
  const signals = buildDaySignals(baseProfile, today);
  const planA = planDay(baseProfile, signals);
  const planB = planDay(baseProfile, signals);

  assert.deepEqual(planA, planB);
});

test("menstrual + cramps prefer warm and gentle templates", () => {
  const profile = {
    ...baseProfile,
    symptoms: { cramps: true },
  };
  const today = new Date("2025-01-02T12:00:00Z");

  const signals = buildDaySignals(profile, today);
  assert.equal(signals.phase, "MENSTRUAL");

  const plan = planDay(profile, signals);
  const coreMeals = [plan.meals.breakfast, plan.meals.lunch, plan.meals.dinner];

  coreMeals.forEach((meal) => {
    assert.equal(meal.warmth, "WARM");
    assert.equal(meal.digestion, "GENTLE");
  });
});

test("luteal appetiteSupport adds snack or higher calorie range", () => {
  const lutealDate = new Date("2025-01-21T12:00:00Z");

  const baselineSignals = buildDaySignals(baseProfile, lutealDate);
  const baselinePlan = planDay(baseProfile, baselineSignals);

  const supportProfile = {
    ...baseProfile,
    appetiteSupport: true,
  };
  const supportSignals = buildDaySignals(supportProfile, lutealDate);
  const supportPlan = planDay(supportProfile, supportSignals);

  assert.equal(supportSignals.phase, "LUTEAL");
  assert.ok(
    supportPlan.meals.snacks.length > baselinePlan.meals.snacks.length ||
      supportPlan.macroRanges.caloriesRange.max > baselinePlan.macroRanges.caloriesRange.max
  );
});
