import phaseTargetsData from "../config/phaseTargets.v1.json";
import moonModifiersData from "../config/moonModifiers.v1.json";
import type { MenstrualPhase, MoonPhase } from "./phaseModels";

export type TargetCategory = "protein" | "carb" | "fat" | "fiber" | "micronutrient";

export type CategoryWeights = Record<TargetCategory, number>;

export type PhaseTarget = {
  emphasisCategories: CategoryWeights;
  avoidTags: string[];
  notes: string;
};

type MoonModifierSet = {
  new_full: Partial<Record<TargetCategory, number>>;
  quarter: Partial<Record<TargetCategory, number>>;
};

const DEFAULT_PHASE_TARGETS: Record<MenstrualPhase, PhaseTarget> = {
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

const DEFAULT_MOON_MODIFIERS: MoonModifierSet = {
  new_full: {
    carb: 0.03,
    fat: 0.02,
    fiber: -0.025,
    micronutrient: -0.025,
  },
  quarter: {
    fiber: 0.03,
    micronutrient: 0.02,
    carb: -0.025,
    fat: -0.025,
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

const isValidWeights = (weights: unknown): weights is CategoryWeights => {
  if (!weights || typeof weights !== "object") return false;
  const candidate = weights as Partial<CategoryWeights>;
  return [candidate.protein, candidate.carb, candidate.fat, candidate.fiber, candidate.micronutrient].every(
    (value) => typeof value === "number"
  );
};

const asPhaseTargets = (raw: unknown): Record<MenstrualPhase, PhaseTarget> => {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_PHASE_TARGETS;
  }

  const parsed = raw as Partial<Record<MenstrualPhase, PhaseTarget>>;
  const phases: MenstrualPhase[] = ["menstrual", "follicular", "ovulation", "luteal"];

  const valid = phases.every((phase) => {
    const item = parsed[phase];
    return (
      !!item &&
      isValidWeights(item.emphasisCategories) &&
      Array.isArray(item.avoidTags) &&
      item.avoidTags.every((tag) => typeof tag === "string") &&
      typeof item.notes === "string"
    );
  });

  return valid ? (parsed as Record<MenstrualPhase, PhaseTarget>) : DEFAULT_PHASE_TARGETS;
};

const asMoonModifiers = (raw: unknown): MoonModifierSet => {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_MOON_MODIFIERS;
  }
  const parsed = raw as Partial<MoonModifierSet>;
  if (!parsed.new_full || !parsed.quarter) {
    return DEFAULT_MOON_MODIFIERS;
  }
  return {
    new_full: parsed.new_full,
    quarter: parsed.quarter,
  };
};

export const PHASE_TARGETS = asPhaseTargets(phaseTargetsData);
const MOON_MODIFIERS = asMoonModifiers(moonModifiersData);

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
    return adjust(weights, MOON_MODIFIERS.new_full);
  }

  if (moonPhase === "first_quarter" || moonPhase === "last_quarter") {
    return adjust(weights, MOON_MODIFIERS.quarter);
  }

  return normalizeWeights(weights);
};

export const getTargetWeights = (menstrualPhase: MenstrualPhase, moonPhase: MoonPhase): CategoryWeights => {
  const base = PHASE_TARGETS[menstrualPhase].emphasisCategories;
  return applyMoonModifier(base, moonPhase);
};
