import type { PhaseContext } from "./phaseModels";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type PlannedMeal = {
  recipeId: string;
  title: string;
  score: number;
  breakdown: unknown;
  ingredientIds: string[];
  mealType: string;
};

export type DayPlan = {
  dateISO: string;
  context: PhaseContext;
  meals: Record<MealSlot, PlannedMeal[]>;
};

export type WeekPlan = DayPlan[];

export type PlannerHistory = {
  recipeCounts: Map<string, number>;
  ingredientCounts: Map<string, number>;
};
