import { generateWeeklyPlan } from "./generateWeeklyPlan";
import { sampleProfile } from "./__fixtures__/profile";
import { sampleRecipes } from "./__fixtures__/recipes";
import ingredientCatalog from "../../../data/out/ingredients.catalog.json";

export const runPlannerDemo = () => {
  const weekStartISO = new Date().toISOString().slice(0, 10);
  const dailyLogs = [
    { dateISO: weekStartISO, symptoms: ["cramps", "fatigue"] },
    { dateISO: new Date(Date.now() + 86400000).toISOString().slice(0, 10), symptoms: ["bloating"] },
  ];
  const plan = generateWeeklyPlan(
    sampleProfile,
    sampleRecipes,
    null,
    weekStartISO,
    dailyLogs,
    ingredientCatalog
  );
  // eslint-disable-next-line no-console
  console.info("Planner demo output:", plan);
};
