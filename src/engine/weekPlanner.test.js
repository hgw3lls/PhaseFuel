import test from "node:test";
import assert from "node:assert/strict";
import { getMoonPhaseFraction, getMoonPhaseName } from "./moon.js";
import { planWeek } from "./weekPlanner.js";

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
  sleepSensitive: false,
  enableMoonCadence: true,
  symptoms: {},
};

const findDateForMoonPhase = (targetPhase, startDate = "2025-01-01", searchDays = 90) => {
  const start = new Date(startDate);
  for (let offset = 0; offset < searchDays; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    const phase = getMoonPhaseName(getMoonPhaseFraction(date));
    if (phase === targetPhase) {
      return date;
    }
  }
  throw new Error(`Unable to find ${targetPhase} in search window`);
};

const collectMealIds = (weekPlan) =>
  weekPlan.days.flatMap((day) => [
    day.meals.breakfast?.id,
    day.meals.lunch?.id,
    day.meals.dinner?.id,
    ...day.meals.snacks.map((snack) => snack?.id),
  ]).filter(Boolean);

test("new moon week allows more novelty than waning week", () => {
  const newMoonStart = findDateForMoonPhase("NEW");
  const waningStart = findDateForMoonPhase("WANING_CRESCENT");

  const newMoonWeek = planWeek(baseProfile, newMoonStart);
  const waningWeek = planWeek(baseProfile, waningStart);

  const newUnique = new Set(collectMealIds(newMoonWeek)).size;
  const waningUnique = new Set(collectMealIds(waningWeek)).size;

  assert.ok(newUnique >= waningUnique);

  const newPrepTasks = new Set(newMoonWeek.days.flatMap((day) => day.prepTasks));
  const waningPrepTasks = new Set(waningWeek.days.flatMap((day) => day.prepTasks));

  assert.ok(newPrepTasks.has("pantry audit"));
  assert.ok(newPrepTasks.has("batch cook 2 bases"));
  assert.ok(waningPrepTasks.has("simple soup night"));
});
