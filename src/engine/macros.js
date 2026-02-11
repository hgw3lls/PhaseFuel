const round = (value) => Math.round(value);

const levelMultiplier = {
  low: 0.95,
  moderate: 1,
  high: 1.1,
};

const goalMultiplier = {
  cut: 0.92,
  maintain: 1,
  gain: 1.08,
};

const getBaseCalories = (profile = {}) => {
  const target = Number(profile.calorieTarget);
  if (Number.isFinite(target) && target > 0) {
    return target;
  }

  const byActivity = {
    low: 1800,
    moderate: 2050,
    high: 2300,
  };

  return byActivity[profile.activityLevel] || 2000;
};

const normalizeRange = (center, spreadLow = 0.95, spreadHigh = 1.05) => ({
  min: round(center * spreadLow),
  max: round(center * spreadHigh),
});

export const calcMacroRanges = (profile = {}, signals = {}) => {
  const activityFactor = levelMultiplier[profile.activityLevel] || 1;
  const goalFactor = goalMultiplier[profile.goal] || 1;

  let caloriesCenter = getBaseCalories(profile) * activityFactor * goalFactor;

  const appetiteSupport = Boolean(profile.appetiteSupport);
  if (signals.phase === "LUTEAL" && appetiteSupport) {
    caloriesCenter *= 1.075;
  }

  const calorieTargetRange = normalizeRange(caloriesCenter, 0.95, 1.05);

  const proteinBase = Number(profile.proteinTarget);
  const proteinCenter = Number.isFinite(proteinBase) && proteinBase > 0
    ? proteinBase
    : Math.max(90, round(calorieTargetRange.min * 0.2 / 4));

  const proteinRange = normalizeRange(proteinCenter, 0.9, 1.1);
  const carbsRange = normalizeRange((caloriesCenter * 0.45) / 4, 0.9, 1.1);
  const fatRange = normalizeRange((caloriesCenter * 0.3) / 9, 0.9, 1.1);

  return {
    caloriesRange: calorieTargetRange,
    proteinRange,
    carbsRange,
    fatRange,
  };
};
