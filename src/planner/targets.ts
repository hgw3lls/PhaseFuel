import type { MenstrualPhase, MoonPhase } from "./phaseModels";

export type TargetCategory = "protein" | "carb" | "fat" | "fiber" | "micronutrient";

export type CategoryWeights = Record<TargetCategory, number>;

export type PhaseTarget = {
  emphasisCategories: CategoryWeights;
  avoidTags: string[];
  notes: string;
};

export const PHASE_TARGETS: Record<MenstrualPhase, PhaseTarget> = {
  menstrual: {
    emphasisCategories: {
      protein: 0.28,
      carb: 0.2,
      fat: 0.12,
      fiber: 0.14,
      micronutrient: 0.26,
    },
    avoidTags: ["high_added_sugar"],
    notes: "Emphasize iron-supportive protein and micronutrients with warm, easy digestion.",
  },
  follicular: {
    emphasisCategories: {
      protein: 0.2,
      carb: 0.2,
      fat: 0.1,
      fiber: 0.25,
      micronutrient: 0.25,
    },
    avoidTags: ["heavy_fried"],
    notes: "Lighter meals with higher fiber and micronutrient density and moderate protein.",
  },
  ovulation: {
    emphasisCategories: {
      protein: 0.24,
      carb: 0.18,
      fat: 0.12,
      fiber: 0.23,
      micronutrient: 0.23,
    },
    avoidTags: ["high_added_sugar"],
    notes: "Balanced with anti-inflammatory bias toward fiber, micronutrients, and protein.",
  },
  luteal: {
    emphasisCategories: {
      protein: 0.26,
      carb: 0.22,
      fat: 0.12,
      fiber: 0.24,
      micronutrient: 0.16,
    },
    avoidTags: ["high_added_sugar"],
    notes: "Support cravings and steady blood sugar with protein, fiber, and complex carbs.",
  },
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const normalizeWeights = (weights: CategoryWeights): CategoryWeights => {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!total) {
    return { protein: 0.2, carb: 0.2, fat: 0.2, fiber: 0.2, micronutrient: 0.2 };
  }

  return {
    protein: weights.protein / total,
    carb: weights.carb / total,
    fat: weights.fat / total,
    fiber: weights.fiber / total,
    micronutrient: weights.micronutrient / total,
  };
};

const adjust = (
  base: CategoryWeights,
  deltas: Partial<Record<TargetCategory, number>>
): CategoryWeights => {
  const adjusted: CategoryWeights = {
    protein: base.protein + (deltas.protein || 0),
    carb: base.carb + (deltas.carb || 0),
    fat: base.fat + (deltas.fat || 0),
    fiber: base.fiber + (deltas.fiber || 0),
    micronutrient: base.micronutrient + (deltas.micronutrient || 0),
  };

  return normalizeWeights({
    protein: clamp(adjusted.protein, 0.01, 1),
    carb: clamp(adjusted.carb, 0.01, 1),
    fat: clamp(adjusted.fat, 0.01, 1),
    fiber: clamp(adjusted.fiber, 0.01, 1),
    micronutrient: clamp(adjusted.micronutrient, 0.01, 1),
  });
};

export const applyMoonModifier = (weights: CategoryWeights, moonPhase: MoonPhase): CategoryWeights => {
  if (moonPhase === "new" || moonPhase === "full") {
    return adjust(weights, {
      carb: 0.03,
      fat: 0.02,
      fiber: -0.025,
      micronutrient: -0.025,
    });
  }

  if (moonPhase === "first_quarter" || moonPhase === "last_quarter") {
    return adjust(weights, {
      fiber: 0.03,
      micronutrient: 0.02,
      carb: -0.025,
      fat: -0.025,
    });
  }

  return normalizeWeights(weights);
};

export const getTargetWeights = (menstrualPhase: MenstrualPhase, moonPhase: MoonPhase): CategoryWeights => {
  const base = PHASE_TARGETS[menstrualPhase].emphasisCategories;
  return applyMoonModifier(base, moonPhase);
};
