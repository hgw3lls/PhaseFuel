const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const toIngredientNames = (candidate) =>
  (candidate?.ingredients || [])
    .map((item) => (typeof item === "string" ? item : item?.name || ""))
    .map((item) => normalize(item))
    .filter(Boolean);

const toAllergens = (candidate) => (candidate?.allergens || []).map(normalize).filter(Boolean);

const getNoRepeatWindow = (constraints, slot) => {
  const configured = constraints?.noRepeatWindowDays;
  if (typeof configured === "number") return configured;
  if (configured && typeof configured === "object") {
    return Number(configured[slot] ?? configured.default ?? 0);
  }
  return 0;
};

export const enforceConstraints = (candidate, constraints = {}) => {
  const reasons = [];
  if (!candidate) {
    reasons.push("missing candidate");
    return { ok: false, reasons };
  }

  const diet = normalize(constraints.diet);
  const diets = new Set((candidate.diets || []).map(normalize));
  if (diet && diets.size && !diets.has(diet)) {
    reasons.push(`diet mismatch: ${diet}`);
  }

  const excludedIngredients = new Set((constraints.excludedIngredients || []).map(normalize).filter(Boolean));
  const ingredients = toIngredientNames(candidate);
  const blockedIngredient = ingredients.find((item) => excludedIngredients.has(item));
  if (blockedIngredient) {
    reasons.push(`excluded ingredient: ${blockedIngredient}`);
  }

  const allergenSet = new Set((constraints.allergens || []).map(normalize).filter(Boolean));
  const matchingAllergen = toAllergens(candidate).find((item) => allergenSet.has(item));
  if (matchingAllergen) {
    reasons.push(`allergen conflict: ${matchingAllergen}`);
  }

  const maxPrepMinutesPerDay = Number(constraints.maxPrepMinutesPerDay);
  const prepMinutes = Number(candidate.prepMinutes || 0);
  const dayPrepUsed = Number(constraints.context?.dayPrepUsed || 0);
  if (Number.isFinite(maxPrepMinutesPerDay) && maxPrepMinutesPerDay > 0) {
    if (dayPrepUsed + prepMinutes > maxPrepMinutesPerDay) {
      reasons.push(`prep minutes exceeded: ${dayPrepUsed + prepMinutes}/${maxPrepMinutesPerDay}`);
    }
  }

  const budgetTier = normalize(constraints.budgetTier);
  if (budgetTier) {
    const candidateTier = normalize(candidate.budgetTier || "moderate");
    const tierRank = { cheap: 0, moderate: 1, premium: 2 };
    if (Number.isFinite(tierRank[budgetTier]) && Number.isFinite(tierRank[candidateTier])) {
      if (tierRank[candidateTier] > tierRank[budgetTier]) {
        reasons.push(`budget tier exceeded: ${candidateTier}`);
      }
    }
  }

  const slot = constraints.context?.slot;
  const dayIndex = Number(constraints.context?.dayIndex ?? -1);
  const noRepeatWindow = getNoRepeatWindow(constraints, slot);
  const recentBySlot = constraints.context?.recentBySlot?.[slot] || [];
  if (slot && dayIndex >= 0 && noRepeatWindow > 0) {
    const repeated = recentBySlot.some((entry) => {
      if (entry?.id !== candidate.id) return false;
      const delta = dayIndex - Number(entry.dayIndex);
      return delta > 0 && delta <= noRepeatWindow;
    });
    if (repeated) {
      reasons.push(`repeat within ${noRepeatWindow} day window`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
};
