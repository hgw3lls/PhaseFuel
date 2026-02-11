const DEFAULT_WEIGHTS = {
  macroDistanceScore: -6,
  phaseFitScore: 3,
  symptomFitScore: 4,
  varietyBonus: 2,
  repeatPenalty: -12,
  wastePenalty: -2,
  prepPenalty: -2,
};

const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const getMacros = (candidate) => {
  if (candidate?.macros) return candidate.macros;
  if (candidate?.nutrition) return candidate.nutrition;
  if (candidate?.estimatedNutrition) return candidate.estimatedNutrition;
  return {
    calories: Number(candidate?.calories || 0),
    protein: Number(candidate?.protein || 0),
    carbs: Number(candidate?.carbs || 0),
    fat: Number(candidate?.fat || 0),
  };
};

const rangePenalty = (value, range) => {
  if (!range) return 0;
  if (value < range.min) return (range.min - value) / Math.max(range.min, 1);
  if (value > range.max) return (value - range.max) / Math.max(range.max, 1);
  return 0;
};

const inRangeBonus = (value, range) => {
  if (!range) return 0;
  return value >= range.min && value <= range.max ? 1 : 0;
};

const getIngredientNames = (candidate) =>
  (candidate?.ingredients || [])
    .map((item) => (typeof item === "string" ? item : item?.name || ""))
    .map((item) => normalize(item))
    .filter(Boolean);

const hasTag = (candidate, tag) => (candidate?.tags || []).map(normalize).includes(normalize(tag));

export const scoreCandidate = (candidate, targets = {}, constraints = {}, history = {}) => {
  if (!candidate) return Number.NEGATIVE_INFINITY;
  const weights = { ...DEFAULT_WEIGHTS, ...(constraints?.weights || {}) };

  const macros = getMacros(candidate);
  const macroPenalty =
    rangePenalty(macros.calories, targets.caloriesRange) +
    rangePenalty(macros.protein, targets.proteinRange) +
    rangePenalty(macros.carbs, targets.carbsRange) +
    rangePenalty(macros.fat, targets.fatRange);
  const macroInsideBoost =
    inRangeBonus(macros.calories, targets.caloriesRange) +
    inRangeBonus(macros.protein, targets.proteinRange) +
    inRangeBonus(macros.carbs, targets.carbsRange) +
    inRangeBonus(macros.fat, targets.fatRange);
  const macroDistanceScore = (macroInsideBoost - macroPenalty) * Math.abs(weights.macroDistanceScore);

  const phase = targets.phase;
  const phaseFitScore = Array.isArray(candidate.phaseFit) && phase && candidate.phaseFit.includes(phase) ? 1 : 0;

  const symptoms = targets.symptoms || {};
  let symptomFitScore = 0;
  if (symptoms.cramps) {
    if (normalize(candidate.warmth) === "warm") symptomFitScore += 1;
    if (normalize(candidate.digestion) === "gentle" || hasTag(candidate, "easy-digest")) symptomFitScore += 1;
    if (normalize(candidate.warmth) === "cold") symptomFitScore -= 1;
  }
  if (symptoms.bloating) {
    if (normalize(candidate.digestion) === "heavy") symptomFitScore -= 1;
    if (hasTag(candidate, "high-salt")) symptomFitScore -= 1;
    if (normalize(candidate.digestion) === "gentle") symptomFitScore += 0.5;
  }

  const recent = history.recent || [];
  const recentProteins = new Set(recent.map((item) => normalize(item.protein)).filter(Boolean));
  const recentCuisines = new Set(recent.map((item) => normalize(item.cuisine)).filter(Boolean));
  const recentTextures = new Set(recent.map((item) => normalize(item.texture)).filter(Boolean));

  let varietyBonus = 0;
  if (candidate.protein && !recentProteins.has(normalize(candidate.protein))) varietyBonus += 1;
  if (candidate.cuisine && !recentCuisines.has(normalize(candidate.cuisine))) varietyBonus += 1;
  if (candidate.texture && !recentTextures.has(normalize(candidate.texture))) varietyBonus += 1;

  const repeatWindow = Number(constraints.noRepeatWindowDays?.[history.slot] ?? constraints.noRepeatWindowDays ?? 0);
  let repeatPenalty = 0;
  if (repeatWindow > 0) {
    const repeated = recent.some((item) => item.id === candidate.id && item.dayDelta <= repeatWindow);
    if (repeated) repeatPenalty = 1;
  }

  const ingredientUsage = history.ingredientUsage || new Map();
  let wastePenalty = 0;
  getIngredientNames(candidate).forEach((ingredient) => {
    const seen = Number(ingredientUsage.get(ingredient) || 0);
    wastePenalty += seen > 0 ? -0.5 : 0.5;
  });

  const cadence = normalize(targets.cadence);
  const simplifyDay = cadence === "waning" || cadence === "simplify";
  const prepMinutes = Number(candidate.prepMinutes || 0);
  const prepPenalty = simplifyDay && prepMinutes > 30 ? (prepMinutes - 30) / 10 : 0;

  return (
    macroDistanceScore +
    phaseFitScore * weights.phaseFitScore +
    symptomFitScore * weights.symptomFitScore +
    varietyBonus * weights.varietyBonus +
    repeatPenalty * weights.repeatPenalty +
    wastePenalty * weights.wastePenalty +
    prepPenalty * weights.prepPenalty
  );
};
