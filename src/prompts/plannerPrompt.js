import { MEAL_PLAN_SCHEMA } from "../mealPlan.js";

const buildPlannerPrompt = ({
  cycleDay,
  symptoms,
  settings,
  cycleInfo,
  moonInfo,
  pantryItems,
  budgetNotes,
  priceMemory,
  history,
  transformationLibrary,
  useWhatYouHaveMode,
}) => {
  const preferences = [];
  const features = [];
  const constraints = [];

  if (settings.preferLeftoverLunch) {
    constraints.push(
      "Every dinner must intentionally produce at least one next-day lunch via leftovers."
    );
  } else {
    constraints.push(
      "Lunches can be fresh; leftoversGraph may be empty if leftovers are not used."
    );
  }

  if (settings.preferBatchCooking) {
    constraints.push(
      "Prefer cook-once bases (stew, tray-roast, protein-base, grain-base, sauce-base)."
    );
  } else {
    constraints.push("BatchTags can be empty and batch-cooking should be minimal.");
  }

  constraints.push("Lunch should require minimal extra ingredients when using leftovers.");

  if (settings.preferLeftoverLunch) {
    preferences.push("Prefer leftover-based lunches where possible.");
  }
  if (settings.preferBatchCooking) {
    preferences.push("Favor batch cooking and reusable components.");
  }

  if (settings.featureFlags.enablePantryTracking) {
    features.push("Include pantry tracking prompts.");
  }
  if (settings.featureFlags.enableLeftoverFatiguePrevention) {
    features.push("Rotate leftovers to prevent fatigue.");
  }
  if (settings.featureFlags.enableBatchDay) {
    features.push("Designate a batch day prep block.");
  }
  if (settings.featureFlags.enableFreezerTags) {
    features.push("Tag freezer-friendly items.");
  }
  if (settings.featureFlags.enableBudgetOptimizer) {
    features.push("Optimize for budget-friendly ingredients.");
  }
  if (settings.featureFlags.enableUseWhatYouHaveMode) {
    features.push("Prioritize use-what-you-have mode.");
  }

  if (useWhatYouHaveMode) {
    features.push("Session override: use-what-you-have mode is mandatory.");
  }

  const context = [
    cycleInfo?.phase
      ? `Cycle phase today: ${cycleInfo.phase}. Next phase ${cycleInfo.nextPhase} on ${new Date(
          cycleInfo.nextPhaseDate
        ).toLocaleDateString()}.`
      : "Cycle phase today: unknown (missing last period start).",
    moonInfo?.phase
      ? `Moon phase today: ${moonInfo.name}. Next phase ${moonInfo.nextPhaseName} on ${new Date(
          moonInfo.nextPhaseDate
        ).toLocaleDateString()}.`
      : "Moon phase today: unknown.",
  ];

  const pantryLine =
    settings.featureFlags.enablePantryTracking && pantryItems
      ? `Pantry items to use first: ${pantryItems}.`
      : "";

  const budgetLine =
    settings.featureFlags.enableBudgetOptimizer && (budgetNotes || settings.weeklyBudget)
      ? `Budget constraints: ${budgetNotes || "Noted weekly budget."} Weekly budget ${
          settings.weeklyBudget || "unspecified"
        }. Cost mode: ${settings.costMode}. Provide estimatedCost with a range.`
      : "";

  const priceLine =
    settings.featureFlags.enableBudgetOptimizer && priceMemory
      ? `Price memory: ${priceMemory}.`
      : "";

  const historyLine =
    settings.featureFlags.enableLeftoverFatiguePrevention && history?.length
      ? `Recent leftover transformations to avoid repeating: ${history.join(", ")}.`
      : "";

  const transformationLine = transformationLibrary?.length
    ? `Transformation library: ${transformationLibrary.join(", ")}.`
    : "";

  const batchDayLine = settings.featureFlags.enableBatchDay
    ? `Batch day is ${settings.batchDayOfWeek} with ${settings.batchTimeBudgetMin} minutes. Generate two bases on batch day and reuse across dinners.`
    : "";

  return [
    `Planner pass: generate a strict JSON plan for cycle day ${cycleDay} with symptoms: ${symptoms}.`,
    `Context: ${context.join(" ")}`,
    pantryLine,
    priceLine,
    budgetLine,
    batchDayLine,
    historyLine,
    transformationLine,
    constraints.length ? `Constraints: ${constraints.join(" ")}` : "",
    preferences.length ? `Preferences: ${preferences.join(" ")}` : "",
    features.length ? `Advanced features: ${features.join(" ")}` : "",
    "Include groceryList items with qty, unit, category, estCost (when possible), and substitutions if over budget.",
    "Include prepSteps for batching and leftovers.",
    settings.featureFlags.enableBudgetOptimizer
      ? "Include estimatedCost range with currency."
      : "estimatedCost can be null if not optimizing budget.",
    MEAL_PLAN_SCHEMA,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export { buildPlannerPrompt };
