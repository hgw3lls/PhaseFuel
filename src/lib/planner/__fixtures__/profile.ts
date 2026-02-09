import type { UserProfile } from "../types";

export const sampleProfile: UserProfile = {
  id: "demo-user",
  dietPattern: "omnivore",
  glutenFree: false,
  lowFodmapMode: "moderate",
  avoidIngredients: ["shrimp"],
  preferTags: ["ginger", "comforting"],
  timeBudgetMin: 30,
  budgetLevel: "normal",
  maxRepeatsPerWeek: 2,
  cycleSettings: {
    lastPeriodStart: "2024-04-01",
    typicalCycleLength: 28,
    typicalLutealLength: 14,
    periodLength: 5,
    mode: "period_based",
  },
};
