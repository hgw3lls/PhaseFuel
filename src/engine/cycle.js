const MS_PER_DAY = 24 * 60 * 60 * 1000;

const normalizeDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date input.");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const dedupe = (values) => Array.from(new Set(values));

export const daysBetween = (dateA, dateB) => {
  const a = normalizeDate(dateA);
  const b = normalizeDate(dateB);
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
};

export const getCycleDay = ({ lastPeriodStart, cycleLength }, today = new Date()) => {
  if (!Number.isInteger(cycleLength) || cycleLength < 1) {
    throw new Error("cycleLength must be a positive integer.");
  }

  const elapsed = daysBetween(lastPeriodStart, today);
  const wrapped = ((elapsed % cycleLength) + cycleLength) % cycleLength;
  return wrapped + 1;
};

export const getPhase = ({
  cycleDay,
  cycleLength,
  periodLength,
  ovulationOffset = 14,
}) => {
  if (!Number.isInteger(cycleDay) || cycleDay < 1 || cycleDay > cycleLength) {
    throw new Error("cycleDay must be between 1 and cycleLength.");
  }

  if (!Number.isInteger(cycleLength) || cycleLength < 1) {
    throw new Error("cycleLength must be a positive integer.");
  }

  const safePeriodLength = Math.max(1, Number.parseInt(periodLength, 10) || 5);
  const ovulationDayEstimate = Math.max(1, Math.min(cycleLength, cycleLength - ovulationOffset));
  const ovulatoryWindow = [
    Math.max(1, ovulationDayEstimate - 1),
    ovulationDayEstimate,
    Math.min(cycleLength, ovulationDayEstimate + 1),
  ];

  if (cycleDay <= safePeriodLength) {
    return "MENSTRUAL";
  }

  if (ovulatoryWindow.includes(cycleDay)) {
    return "OVULATORY";
  }

  if (cycleDay < ovulatoryWindow[0]) {
    return "FOLLICULAR";
  }

  return "LUTEAL";
};

export const getPhaseNutritionEmphasis = (phase) => {
  const guidanceByPhase = {
    MENSTRUAL: {
      emphasize: ["iron", "hydration", "omega-3", "magnesium"],
      limit: ["very salty"],
      mealStyle: ["warm", "easy-digest"],
    },
    FOLLICULAR: {
      emphasize: ["lean protein", "complex carbs", "fiber", "hydration"],
      limit: [],
      mealStyle: ["fresh", "balanced"],
    },
    OVULATORY: {
      emphasize: ["lean protein", "hydration", "fiber", "colorful produce"],
      limit: ["added sugar"],
      mealStyle: ["lighter", "prep-friendly"],
    },
    LUTEAL: {
      emphasize: ["magnesium", "complex carbs", "high-satiety", "hydration"],
      limit: ["very salty"],
      mealStyle: ["high-satiety", "warm"],
    },
  };

  const result = guidanceByPhase[phase];
  if (!result) {
    throw new Error("Unknown phase.");
  }

  return {
    emphasize: [...result.emphasize],
    limit: [...result.limit],
    mealStyle: [...result.mealStyle],
  };
};

export const applySymptomOverrides = (baseGuidance, symptoms = {}) => {
  const next = {
    emphasize: [...(baseGuidance?.emphasize || [])],
    limit: [...(baseGuidance?.limit || [])],
    mealStyle: [...(baseGuidance?.mealStyle || [])],
  };

  if (symptoms.bloating) {
    next.emphasize.push("lower sodium", "potassium foods", "gentle fiber");
    next.limit.push("very salty");
  }

  if (symptoms.constipation) {
    next.emphasize.push("cooked veg", "fiber", "hydration");
    next.limit.push("low-fiber day");
  }

  if (symptoms.cramps) {
    next.emphasize.push("warm meals", "ginger");
    next.limit.push("very cold/raw");
  }

  if (symptoms.lowEnergy) {
    next.emphasize.push("easy carbs at breakfast/lunch");
    next.mealStyle.push("extra snack slot");
  }

  return {
    emphasize: dedupe(next.emphasize),
    limit: dedupe(next.limit),
    mealStyle: dedupe(next.mealStyle),
  };
};
