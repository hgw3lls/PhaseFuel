import { MEAL_TEMPLATES } from "./templates.js";
import { createMealDbProvider } from "../providers/recipes/mealdb.js";
import { createFdcProvider } from "../providers/nutrition/fdc.js";
import { createOffProvider } from "../providers/nutrition/off.js";
import { estimateCandidateNutrition } from "./nutritionBridge.js";

const ROTATION_CUISINES = ["Italian", "Mexican", "Japanese", "Greek", "French", "Thai", "Indian"];

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const macroByBias = {
  BALANCED: { calories: 520, protein: 30, carbs: 52, fat: 17 },
  HIGH_PROTEIN: { calories: 520, protein: 40, carbs: 35, fat: 16 },
  HIGH_CARB: { calories: 520, protein: 22, carbs: 66, fat: 13 },
  HIGH_FAT: { calories: 430, protein: 16, carbs: 28, fat: 26 },
};

const slotByTemplate = (template) => {
  if (template.tags.includes("snack")) return "snacks";
  if (template.prep === "ASSEMBLE") return "lunch";
  if (template.tags.includes("quick")) return "breakfast";
  return "dinner";
};

const toTemplateCandidate = (template) => ({
  ...template,
  source: "template",
  prepMinutes: template.prep === "BATCH" ? 45 : template.prep === "QUICK" ? 20 : 10,
  macros: macroByBias[template.macroBias] || macroByBias.BALANCED,
  diets: ["omnivore"],
  allergens: [],
  ingredients: [],
  budgetTier: "cheap",
  protein: template.tags.includes("high-protein") ? "mixed" : "plant",
  cuisine: template.tags.includes("comforting") ? "comfort" : "mixed",
  texture: template.digestion === "GENTLE" ? "soft" : "mixed",
  batchServings: template.prep === "BATCH" ? 4 : 1,
});

const pickCuisineRotation = (profile, startDate) => {
  const seed = hashString(`${profile?.userId || profile?.id || "anon"}:${startDate || ""}`);
  const startIndex = seed % ROTATION_CUISINES.length;
  return Array.from({ length: 3 }, (_, idx) => ROTATION_CUISINES[(startIndex + idx) % ROTATION_CUISINES.length]);
};

const toRecipeCandidate = (recipe, slotHint = "dinner") => ({
  id: `${recipe.source}-${recipe.id}`,
  name: recipe.name,
  source: "recipe",
  provider: recipe.source,
  providerRecipeId: recipe.id,
  image: recipe.image,
  url: recipe.url,
  ingredients: recipe.ingredients || [],
  tags: recipe.tags || [],
  cuisine: recipe.cuisine,
  category: recipe.category,
  warmth: slotHint === "snacks" ? "ROOM" : "WARM",
  digestion: slotHint === "dinner" ? "MODERATE" : "GENTLE",
  prepMinutes: slotHint === "dinner" ? 35 : 20,
  nutrition: recipe.nutrition,
  macros: recipe.nutrition || undefined,
  diets: ["omnivore"],
  allergens: [],
  budgetTier: "moderate",
  phaseFit: ["MENSTRUAL", "FOLLICULAR", "OVULATORY", "LUTEAL"],
  texture: slotHint === "dinner" ? "hearty" : "soft",
  protein: "mixed",
  batchServings: slotHint === "dinner" ? 3 : 1,
  sourceAttribution: recipe.sourceAttribution,
});

export const getTemplateCandidatesByMealSlot = (items = MEAL_TEMPLATES) => ({
  breakfast: items.filter((item) => slotByTemplate(item) === "breakfast").map(toTemplateCandidate),
  lunch: items.filter((item) => slotByTemplate(item) === "lunch").map(toTemplateCandidate),
  dinner: items.filter((item) => slotByTemplate(item) === "dinner").map(toTemplateCandidate),
  snacks: items.filter((item) => slotByTemplate(item) === "snacks").map(toTemplateCandidate),
});

export const getCandidatesByMealSlot = async (
  profile,
  startDate,
  {
    enableRecipeProvider = true,
    provider = createMealDbProvider(),
    nutritionSources = { fdc: true, off: true },
    lowDataMode = false,
    fdcProvider = createFdcProvider(),
    offProvider = createOffProvider(),
  } = {}
) => {
  const templateCandidates = getTemplateCandidatesByMealSlot(MEAL_TEMPLATES);
  if (!enableRecipeProvider) {
    return {
      ...templateCandidates,
      meta: { usedProvider: false, fallbackReason: "provider disabled" },
    };
  }

  try {
    const cuisines = pickCuisineRotation(profile, startDate);
    const recipeGroups = await Promise.all(
      cuisines.map((cuisine) => provider.random({ cuisine, limit: 2 }))
    );
    const recipes = recipeGroups.flat();

    const recipeCandidates = await Promise.all(recipes.map(async (recipe, idx) => {
      const candidate = toRecipeCandidate(recipe, idx % 2 === 0 ? "dinner" : "lunch");
      if (!candidate.macros && !candidate.nutrition) {
        candidate.estimatedNutrition = await estimateCandidateNutrition(candidate, {
          fdcProvider,
          offProvider,
          nutritionSources,
          lowDataMode,
        });
      }
      return candidate;
    }));

    return {
      breakfast: templateCandidates.breakfast,
      lunch: [...templateCandidates.lunch, ...recipeCandidates.filter((item) => item.prepMinutes <= 25)],
      dinner: [...templateCandidates.dinner, ...recipeCandidates],
      snacks: templateCandidates.snacks,
      meta: {
        usedProvider: recipeCandidates.length > 0,
        provider: provider.name,
        cuisines,
      },
    };
  } catch (error) {
    return {
      ...templateCandidates,
      meta: { usedProvider: false, fallbackReason: "provider failure", error: error.message },
    };
  }
};
