export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type CyclePhase = "menstrual" | "follicular" | "ovulatory" | "luteal";

export interface Recipe {
  id: string;
  name: string;
  mealType: MealType;
  ingredients: string[];
  tags: string[];
  timeMinutes: number;
  costLevel: "budget" | "balanced" | "premium";
}

export interface CycleSettings {
  lastPeriodStart: string;
  typicalCycleLength: number;
  typicalLutealLength: number;
  periodLength: number;
  lastOvulation?: string;
  mode?: "period_based" | "ovulation_aware" | "moon_only" | "symptom_only";
}

export interface UserProfile {
  id: string;
  dietPattern: "omnivore" | "pescatarian" | "vegetarian" | "vegan";
  glutenFree: boolean;
  lowFodmapMode: "off" | "moderate" | "strict";
  avoidIngredients: string[];
  preferTags: string[];
  timeBudgetMin: number;
  budgetLevel: "tight" | "normal" | "generous";
  maxRepeatsPerWeek: number;
  cycleSettings: CycleSettings;
}

export interface PlannedMeal {
  recipeId: string;
  name: string;
  mealType: MealType;
  ingredients: string[];
  tags: string[];
  rationale: string[];
}

export interface WeeklyPlanDay {
  dateISO: string;
  phase: CyclePhase;
  meals: Record<MealType, PlannedMeal | undefined>;
}

export interface WeeklyPlan {
  weekStartISO: string;
  days: WeeklyPlanDay[];
}

export interface DailyLog {
  dateISO: string;
  symptoms: string[];
}
