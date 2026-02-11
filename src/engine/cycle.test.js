import test from "node:test";
import assert from "node:assert/strict";
import {
  applySymptomOverrides,
  getCycleDay,
  getPhase,
  getPhaseNutritionEmphasis,
} from "./cycle.js";

test("getCycleDay wraps around cycle length", () => {
  const day1 = getCycleDay(
    { lastPeriodStart: "2025-01-01", cycleLength: 28 },
    new Date("2025-01-01")
  );
  const day28 = getCycleDay(
    { lastPeriodStart: "2025-01-01", cycleLength: 28 },
    new Date("2025-01-28")
  );
  const wrapped = getCycleDay(
    { lastPeriodStart: "2025-01-01", cycleLength: 28 },
    new Date("2025-01-29")
  );

  assert.equal(day1, 1);
  assert.equal(day28, 28);
  assert.equal(wrapped, 1);
});

test("getPhase classifies boundaries correctly", () => {
  const base = { cycleLength: 28, periodLength: 5, ovulationOffset: 14 };

  assert.equal(getPhase({ ...base, cycleDay: 1 }), "MENSTRUAL");
  assert.equal(getPhase({ ...base, cycleDay: 5 }), "MENSTRUAL");
  assert.equal(getPhase({ ...base, cycleDay: 6 }), "FOLLICULAR");
  assert.equal(getPhase({ ...base, cycleDay: 13 }), "OVULATORY");
  assert.equal(getPhase({ ...base, cycleDay: 14 }), "OVULATORY");
  assert.equal(getPhase({ ...base, cycleDay: 15 }), "OVULATORY");
  assert.equal(getPhase({ ...base, cycleDay: 16 }), "LUTEAL");
  assert.equal(getPhase({ ...base, cycleDay: 28 }), "LUTEAL");
});

test("applySymptomOverrides adds expected planning tags", () => {
  const base = getPhaseNutritionEmphasis("LUTEAL");
  const result = applySymptomOverrides(base, {
    bloating: true,
    cramps: true,
    constipation: true,
    lowEnergy: true,
    acne: false,
  });

  assert.ok(result.emphasize.includes("lower sodium"));
  assert.ok(result.emphasize.includes("potassium foods"));
  assert.ok(result.emphasize.includes("gentle fiber"));
  assert.ok(result.emphasize.includes("cooked veg"));
  assert.ok(result.emphasize.includes("warm meals"));
  assert.ok(result.emphasize.includes("easy carbs at breakfast/lunch"));

  assert.ok(result.limit.includes("very salty"));
  assert.ok(result.limit.includes("low-fiber day"));
  assert.ok(result.limit.includes("very cold/raw"));

  assert.ok(result.mealStyle.includes("extra snack slot"));
});
