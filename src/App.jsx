import { useEffect, useMemo, useState } from "react";
import { useSettings, DEFAULT_SETTINGS } from "./settings.jsx";
import { estimatePhase } from "./lib/cycle.js";
import { getMoonPhaseBucket } from "./lib/moon.js";
import { computeSyncScore } from "./lib/sync.js";
import {
  getIngredient,
  resolveIngredientId,
  searchIngredients,
} from "./data/ingredients";
import { getMatchingRecipes } from "./data/query";
import { warmPhaseFuelData } from "./data/warmup";
import { toRecipeCard } from "./data/viewModel";
import DatasetDiagnostics from "./dev/DatasetDiagnostics";
import { generateWeeklyPlan, swapMealInPlan } from "./lib/planner.js";
import { buildFallbackNarrative, requestPlanNarrative } from "./lib/ai.js";
import { validatePlan } from "./lib/validatePlan.js";
import { compileAllowed } from "./lib/diet.ts";
import {
  adjustGroceryListForPantry,
  loadPantry,
  removePantryItem,
  savePantry,
  upsertPantryItem,
} from "./modules/pantry.js";
import {
  addFreezerItem,
  loadFreezer,
  removeFreezerItem,
  saveFreezer,
} from "./modules/freezer.js";
import {
  loadPrices,
  removePriceItem,
  savePrices,
  upsertPriceItem,
} from "./modules/priceMemory.js";
import { loadHistory, MAX_HISTORY, saveHistory } from "./modules/leftoverHistory.js";

const PLAN_STORAGE_KEY = "phasefuel_meal_plans";
const GROCERY_CHECK_KEY = "phasefuel_grocery_checks";

const VIEW_LABELS = {
  today: "Period",
  plan: "PLAN",
  grocery: "GROCERY",
  profile: "Profile",
  privacy: "Privacy",
  settings: "Settings",
};

const ENERGY_BY_PHASE = {
  menstrual: "Low",
  follicular: "Rising",
  ovulatory: "High",
  luteal: "Steady",
};

const FOCUS_BY_PHASE = {
  menstrual: "Restorative",
  follicular: "Creative",
  ovulatory: "Social",
  luteal: "Grounded",
};

const getStoredPlans = () => {
  const raw = localStorage.getItem(PLAN_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const getStoredChecks = () => {
  const raw = localStorage.getItem(GROCERY_CHECK_KEY);
  return raw ? JSON.parse(raw) : {};
};

const formatPhase = (value) => (value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Unknown");
const formatCategory = (value) =>
  value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Other";

const buildWeekdayLabels = (count) => {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(today);
    next.setDate(today.getDate() + index);
    return next.toLocaleDateString(undefined, { weekday: "short" });
  });
};

const formatDuration = (totalSeconds) => {
  const safeSeconds = Math.max(0, totalSeconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};


const groupGroceries = (items) =>
  items.reduce((acc, item) => {
    const category = item.category || "Other";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {});

const buildGroceryList = (plan) => {
  const counts = new Map();

  plan?.days?.forEach((day) => {
    Object.values(day.meals || {}).forEach((meal) => {
      meal.ingredients.forEach((ingredient) => {
        const key = ingredient.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
  });

  return Array.from(counts.entries()).map(([name, count]) => ({
    name,
    qty: count > 1 ? String(count) : "",
    unit: "",
    category: (() => {
      const ingredientId = resolveIngredientId(name);
      const category = ingredientId ? getIngredient(ingredientId)?.category : null;
      return formatCategory(category);
    })(),
  }));
};

export default function App() {
  const [userId, setUserId] = useState("");
  const [cycleDay, setCycleDay] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [dataState, setDataState] = useState({ status: "loading", data: null, error: null });
  const [pantryItems, setPantryItems] = useState(() =>
    typeof loadPantry === "function" ? loadPantry() : []
  );
  const [freezerItems, setFreezerItems] = useState(() => loadFreezer());
  const [priceItems, setPriceItems] = useState(() => loadPrices());
  const [historyItems, setHistoryItems] = useState(() => loadHistory());
  const [pantryInput, setPantryInput] = useState({ name: "", qty: "", unit: "", expiresOn: "" });
  const [freezerInput, setFreezerInput] = useState({ name: "", portions: "" });
  const [priceInput, setPriceInput] = useState({ name: "", unit: "", price: "" });
  const [budgetNotes, setBudgetNotes] = useState("");
  const [generationState, setGenerationState] = useState("idle");
  const [status, setStatus] = useState("Ready.");
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [plannerError, setPlannerError] = useState("");
  const [planNarrative, setPlanNarrative] = useState(null);
  const [groceryList, setGroceryList] = useState([]);
  const [prepSteps, setPrepSteps] = useState([]);
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [lookupUserId, setLookupUserId] = useState("");
  const [savedPlan, setSavedPlan] = useState("No saved plan loaded.");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState(null);
  const [loadingElapsedMs, setLoadingElapsedMs] = useState(0);
  const [estimatedGenerationMs, setEstimatedGenerationMs] = useState(20000);
  const [useWhatYouHaveOverride, setUseWhatYouHaveOverride] = useState(false);
  const [activeView, setActiveView] = useState("today");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePlanDay, setActivePlanDay] = useState(null);
  const [activeRecipeMealType, setActiveRecipeMealType] = useState(null);
  const [planDays, setPlanDays] = useState(7);
  const [dietaryPreferences, setDietaryPreferences] = useState("");
  const [cuisinePreferences, setCuisinePreferences] = useState("");
  const [foodAvoidances, setFoodAvoidances] = useState("");
  const [filterMealType, setFilterMealType] = useState("");
  const [filterDietFlags, setFilterDietFlags] = useState([]);
  const [filterIngredientQuery, setFilterIngredientQuery] = useState("");
  const [filterIngredientSuggestions, setFilterIngredientSuggestions] = useState([]);
  const [filterIngredientIds, setFilterIngredientIds] = useState([]);
  const [filterError, setFilterError] = useState("");
  const [groceryChecks, setGroceryChecks] = useState(() => getStoredChecks());
  const { settings, setSettings, updateSettings } = useSettings();

  const data = dataState.data;
  const recipes = data?.recipes || [];
  const recipeById = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes]);
  const ingredientCatalog = data?.ingredients || [];
  const dietFlagOptions = data?.dietFlags || [];
  const mealTypeOptions = data?.mealTypes || ["breakfast", "lunch", "dinner", "snack"];
  const isDataReady = dataState.status === "ready";

  const plansByUser = useMemo(() => getStoredPlans(), [weeklyPlan, savedPlan]);
  const selectedIngredients = useMemo(
    () =>
      filterIngredientIds
        .map((id) => getIngredient(id))
        .filter((ingredient) => Boolean(ingredient)),
    [filterIngredientIds, isDataReady]
  );
  const filteredRecipes = useMemo(() => {
    if (!isDataReady) {
      return { total: 0, items: [] };
    }

    const matches = getMatchingRecipes({
      mealType: filterMealType || undefined,
      dietFlags: filterDietFlags.length ? filterDietFlags : undefined,
      ingredientIds: filterIngredientIds.length ? filterIngredientIds : undefined,
    });

    return {
      total: matches.length,
      items: matches.slice(0, 20).map((recipe) => toRecipeCard(recipe)),
    };
  }, [isDataReady, filterMealType, filterDietFlags, filterIngredientIds]);
  const pantryFirst = settings.featureFlags.enableUseWhatYouHaveMode || useWhatYouHaveOverride;
  const cycleInfo = useMemo(
    () => estimatePhase(new Date().toISOString(), settings.cyclePreferences, settings.cycleMode),
    [settings.cyclePreferences, settings.cycleMode]
  );
  const moonInfo = useMemo(() => getMoonPhaseBucket(new Date()), []);
  const syncScore = useMemo(
    () => computeSyncScore(cycleInfo.phase, Math.floor((moonInfo.age / 29.53) * 8)),
    [cycleInfo.phase, moonInfo.age]
  );

  useEffect(() => {
    let isActive = true;
    warmPhaseFuelData()
      .then((loaded) => {
        if (isActive) {
          setDataState({ status: "ready", data: loaded, error: null });
        }
      })
      .catch((error) => {
        if (isActive) {
          setDataState({ status: "error", data: null, error });
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (dataState.status === "error" && dataState.error) {
      setStatus(`Failed to load datasets: ${dataState.error.message}`);
    }
  }, [dataState.status, dataState.error]);

  useEffect(() => {
    if (!isDataReady || !filterIngredientQuery.trim()) {
      setFilterIngredientSuggestions([]);
      return;
    }

    setFilterIngredientSuggestions(searchIngredients(filterIngredientQuery, 8));
  }, [isDataReady, filterIngredientQuery]);

  useEffect(() => {
    savePantry(pantryItems);
  }, [pantryItems]);

  useEffect(() => {
    saveFreezer(freezerItems);
  }, [freezerItems]);

  useEffect(() => {
    savePrices(priceItems);
  }, [priceItems]);

  useEffect(() => {
    saveHistory(historyItems);
  }, [historyItems]);

  useEffect(() => {
    localStorage.setItem(GROCERY_CHECK_KEY, JSON.stringify(groceryChecks));
  }, [groceryChecks]);

  useEffect(() => {
    if (weeklyPlan?.days?.length) {
      setActivePlanDay((current) => (current ?? 0));
    }
  }, [weeklyPlan]);

  useEffect(() => {
    setActiveRecipeMealType(null);
  }, [activePlanDay, weeklyPlan]);


  useEffect(() => {
    if (!isLoading || !loadingStartedAt) {
      return undefined;
    }

    const timer = setInterval(() => {
      setLoadingElapsedMs(Date.now() - loadingStartedAt);
    }, 200);

    return () => {
      clearInterval(timer);
    };
  }, [isLoading, loadingStartedAt]);

  const handleSettingsChange = (key, value) => {
    updateSettings({ [key]: value });
  };

  const handleCyclePreferenceChange = (key, value) => {
    updateSettings({
      cyclePreferences: {
        ...settings.cyclePreferences,
        [key]: value,
      },
    });
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  const addPantryItem = (event) => {
    event.preventDefault();
    setPantryItems((items) => upsertPantryItem(items, pantryInput));
    setPantryInput({ name: "", qty: "", unit: "", expiresOn: "" });
  };

  const addFreezerEntry = (event) => {
    event.preventDefault();
    if (!freezerInput.name?.trim()) {
      return;
    }
    setFreezerItems((items) => addFreezerItem(items, freezerInput));
    setFreezerInput({ name: "", portions: "" });
  };

  const addPriceEntry = (event) => {
    event.preventDefault();
    setPriceItems((items) => upsertPriceItem(items, priceInput));
    setPriceInput({ name: "", unit: "", price: "" });
  };

  const buildProfile = () => {
    const avoidList = foodAvoidances
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const preferTags = dietaryPreferences
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    return {
      id: userId.trim(),
      dietPattern: settings.dietPattern,
      glutenFree: settings.glutenFree,
      lowFodmapMode: settings.lowFodmapMode,
      avoidIngredients: avoidList,
      preferTags,
      timeBudgetMin: settings.timeBudgetMin,
      budgetLevel: settings.costMode,
    };
  };

  const buildPlanSettings = () => ({
    preferLeftoverLunch: settings.preferLeftoverLunch,
    includeSnacks: settings.includeSnacks,
    maxRepeatsPerWeek: settings.maxRepeatsPerWeek,
    ingredientCatalog,
  });

  const toggleDietFlag = (flag) => {
    setFilterDietFlags((current) =>
      current.includes(flag) ? current.filter((item) => item !== flag) : [...current, flag]
    );
  };

  const addIngredientFilter = (ingredient) => {
    if (!ingredient?.id) return;
    setFilterIngredientIds((current) =>
      current.includes(ingredient.id) ? current : [...current, ingredient.id]
    );
    setFilterIngredientQuery("");
    setFilterIngredientSuggestions([]);
    setFilterError("");
  };

  const handleAddIngredientFilter = () => {
    if (!isDataReady) return;
    const ingredientId = resolveIngredientId(filterIngredientQuery);
    if (!ingredientId) {
      setFilterError("No ingredient match found.");
      return;
    }

    const ingredient = getIngredient(ingredientId);
    addIngredientFilter(ingredient || { id: ingredientId });
  };

  const removeIngredientFilter = (ingredientId) => {
    setFilterIngredientIds((current) => current.filter((id) => id !== ingredientId));
  };

  const handleUseWhatYouHave = () => {
    if (settings.featureFlags.enablePantryTracking && pantryItems.length < 5) {
      setStatus("Add at least 5 pantry items to use this override.");
      setUseWhatYouHaveOverride(false);
      return;
    }
    setUseWhatYouHaveOverride(true);
    setStatus("Pantry-first plan override enabled for this run.");
  };

  const generatePlan = async () => {
    if (!userId.trim()) {
      setStatus("Please enter a user ID.");
      return;
    }
    if (!data) {
      setStatus("Datasets are still loading. Please wait a moment.");
      return;
    }
    const generationStartedAt = Date.now();
    setIsLoading(true);
    setLoadingStartedAt(generationStartedAt);
    setLoadingElapsedMs(0);
    setGenerationState("generating");
    setStatus("Generating deterministic plan...");
    setPlannerError("");

    const useWhatYouHaveMode =
      settings.featureFlags.enableUseWhatYouHaveMode || useWhatYouHaveOverride;

    try {
      if (!cycleDay || !symptoms.trim()) {
        setStatus("Enter your cycle day and symptoms to generate a plan.");
        setGenerationState("error");
        return;
      }

      const symptomList = symptoms
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const profile = buildProfile();
      const planSettings = buildPlanSettings();

      let nextPlan = generateWeeklyPlan({
        recipes,
        getByMealType: data.getByMealType,
        profile,
        phase: cycleInfo.phase,
        symptoms: symptomList,
        settings: planSettings,
        days: planDays,
      });

      const { forbiddenTokens } = compileAllowed(
        profile,
        ingredientCatalog,
        settings.lowFodmapMode
      );
      const validation = validatePlan(nextPlan, forbiddenTokens, ingredientCatalog);
      if (!validation.valid) {
        nextPlan = generateWeeklyPlan({
          recipes,
          getByMealType: data.getByMealType,
          profile,
          phase: cycleInfo.phase,
          symptoms: symptomList,
          settings: { ...planSettings, includeSnacks: false },
          days: planDays,
        });
      }

      const nextGrocery = buildGroceryList(nextPlan);
      const pantryAdjusted = useWhatYouHaveMode
        ? adjustGroceryListForPantry(nextGrocery, pantryItems)
        : nextGrocery;

      setWeeklyPlan(nextPlan);
      setGroceryList(pantryAdjusted);
      setPrepSteps([]);
      setEstimatedCost(null);
      setGenerationState("success");

      const profileSummary = `${settings.dietPattern} diet, gluten-free: ${
        settings.glutenFree ? "yes" : "no"
      }, low-FODMAP: ${settings.lowFodmapMode}`;
      const { allowedTokens } = compileAllowed(
        profile,
        ingredientCatalog,
        settings.lowFodmapMode
      );
      const fallbackNarrative = buildFallbackNarrative({
        weeklyPlan: nextPlan,
        profileSummary,
      });

      const narrative = await requestPlanNarrative({
        profileSummary,
        weekStartISO: nextPlan.startDateISO || nextPlan.weekStartISO || "",
        weeklyPlanJson: nextPlan,
        allowedTokens: Array.from(allowedTokens),
        fallback: fallbackNarrative,
      });
      setPlanNarrative(narrative);

      const updatedPlans = {
        ...plansByUser,
        [userId.trim()]: {
          cycle_day: Number(cycleDay),
          symptoms: symptoms.trim(),
          weekly_plan: nextPlan,
          settings_snapshot: settings,
        },
      };
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(updatedPlans));
      setStatus("Meal plan saved locally.");
    } catch (error) {
      setStatus(`Failed to generate plan: ${error.message}`);
      setGenerationState("error");
    } finally {
      const generationDurationMs = Date.now() - generationStartedAt;
      setEstimatedGenerationMs((current) => {
        const blended = Math.round(current * 0.65 + generationDurationMs * 0.35);
        return Math.min(60000, Math.max(6000, blended));
      });
      setIsLoading(false);
      setLoadingStartedAt(null);
      setLoadingElapsedMs(0);
      setUseWhatYouHaveOverride(false);
    }
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    await generatePlan();
  };

  const handleLoadPlan = () => {
    if (!lookupUserId.trim()) {
      setSavedPlan("Enter a user ID to load a saved plan.");
      return;
    }
    const planData = plansByUser[lookupUserId.trim()];
    if (!planData) {
      setSavedPlan(`No saved plan found for ${lookupUserId.trim()}.`);
      return;
    }
    setSavedPlan(JSON.stringify(planData, null, 2));
  };

  const handleClearPlan = () => {
    if (!lookupUserId.trim()) {
      setSavedPlan("Enter a user ID to clear a saved plan.");
      return;
    }
    const updatedPlans = { ...plansByUser };
    if (updatedPlans[lookupUserId.trim()]) {
      delete updatedPlans[lookupUserId.trim()];
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(updatedPlans));
      setSavedPlan(`Cleared saved plan for ${lookupUserId.trim()}.`);
    } else {
      setSavedPlan(`No saved plan found for ${lookupUserId.trim()}.`);
    }
  };

  const handleCopyGroceries = async () => {
    const grouped = groupGroceries(groceryList);
    const lines = Object.entries(grouped).flatMap(([category, items]) => [
      category.toUpperCase(),
      ...items.map((item) => `- ${item.qty} ${item.unit} ${item.name}`.trim()),
      "",
    ]);
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      setStatus("Grocery list copied to clipboard.");
    } catch (error) {
      setStatus("Unable to copy groceries in this browser.");
    }
  };

  const toggleDrawer = () => setDrawerOpen((open) => !open);

  const toggleCheck = (itemKey) => {
    setGroceryChecks((current) => ({
      ...current,
      [itemKey]: !current[itemKey],
    }));
  };

  const clearChecks = () => {
    setGroceryChecks({});
  };

  const handleNav = (view) => {
    setActiveView(view);
    setDrawerOpen(false);
  };

  const renderMealIngredients = (ingredients) => {
    if (!ingredients?.length) {
      return <p>No ingredients listed.</p>;
    }

    if (!isDataReady) {
      return <p>{ingredients.join(", ")}</p>;
    }

    return (
      <ul className="ingredient-list">
        {ingredients.map((ingredient, index) => {
          const ingredientId = resolveIngredientId(ingredient);
          const category = ingredientId ? getIngredient(ingredientId)?.category : null;
          return (
            <li key={`${ingredient}-${index}`}>
              <span className="ingredient-name">{ingredient}</span>
              {category ? (
                <span className={`badge badge-${category}`}>
                  {formatCategory(category)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const getMealDisplayName = (meal) => {
    if (!meal) return "Meal";
    const recipe = meal.recipeId ? recipeById.get(meal.recipeId) : null;
    return recipe?.name || recipe?.title || meal.name || "Meal";
  };


  const handleAddDinnerToGroceries = () => {
    const ingredients = activeDayData?.meals?.dinner?.ingredients || [];
    const additions = ingredients
      .map((item) => item?.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        qty: "",
        unit: "",
        category: (() => {
          const ingredientId = resolveIngredientId(name);
          const category = ingredientId ? getIngredient(ingredientId)?.category : null;
          return formatCategory(category);
        })(),
      }));

    if (!additions.length) {
      setStatus("No dinner ingredients available to add.");
      return;
    }

    setGroceryList((current) => {
      const existing = new Set(current.map((item) => item.name.toLowerCase()));
      const nextAdditions = additions.filter((item) => !existing.has(item.name.toLowerCase()));
      if (!nextAdditions.length) {
        setStatus("Dinner ingredients already in grocery list.");
        return current;
      }
      setStatus(
        `Added ${nextAdditions.length} dinner item${nextAdditions.length > 1 ? "s" : ""} to grocery list.`
      );
      return [...current, ...nextAdditions];
    });
  };

  const handleSwapMeal = (dayIndex, mealType) => {
    if (!weeklyPlan) {
      setStatus("Generate a plan before swapping meals.");
      return;
    }
    const symptomList = symptoms
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const nextPlan = swapMealInPlan({
      plan: weeklyPlan,
      recipes,
      getByMealType: data?.getByMealType,
      profile: buildProfile(),
      phase: cycleInfo.phase,
      symptoms: symptomList,
      settings: buildPlanSettings(),
      dayIndex,
      mealType,
    });
    setWeeklyPlan(nextPlan);
    setGroceryList(buildGroceryList(nextPlan));
    setStatus(`Swapped ${mealType} for day ${dayIndex + 1}.`);
  };

  const handleExportPlan = () => {
    if (!weeklyPlan) {
      setStatus("Generate a plan before exporting.");
      return;
    }
    const blob = new Blob([JSON.stringify(weeklyPlan, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `phasefuel-plan-${weeklyPlan.startDateISO || "week"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Plan exported.");
  };

  const coreSettings = [
    {
      key: "preferLeftoverLunch",
      label: "Prefer leftover lunch",
      description: "Bias plan toward leftover-friendly lunches.",
      value: settings.preferLeftoverLunch,
      onChange: () =>
        updateSettings({ preferLeftoverLunch: !settings.preferLeftoverLunch }),
    },
    {
      key: "preferBatchCooking",
      label: "Prefer batch cooking",
      description: "Encourage bulk prep and reusable components.",
      value: settings.preferBatchCooking,
      onChange: () =>
        updateSettings({ preferBatchCooking: !settings.preferBatchCooking }),
    },
    {
      key: "includeSnacks",
      label: "Include snacks",
      description: "Add optional snack slots to the week.",
      value: settings.includeSnacks,
      onChange: () => updateSettings({ includeSnacks: !settings.includeSnacks }),
    },
  ];

  const featureFlags = [
    {
      key: "enablePantryTracking",
      label: "Enable pantry tracking",
      description: "Track pantry staples and reuse signals.",
    },
    {
      key: "enableLeftoverFatiguePrevention",
      label: "Enable leftover fatigue prevention",
      description: "Cycle leftovers to avoid repetition fatigue.",
    },
    {
      key: "enableBatchDay",
      label: "Enable batch day",
      description: "Schedule a dedicated batch cooking day.",
    },
    {
      key: "enableFreezerTags",
      label: "Enable freezer tags",
      description: "Mark freezer-ready meals in the plan.",
    },
    {
      key: "enableBudgetOptimizer",
      label: "Enable budget optimizer",
      description: "Focus on budget-conscious ingredients.",
    },
    {
      key: "enableUseWhatYouHaveMode",
      label: "Enable use-what-you-have mode",
      description: "Prioritize pantry-first recipes.",
    },
  ];

  const fallbackDayCount = planDays || 7;
  const weekdayLabels = buildWeekdayLabels(weeklyPlan?.days?.length || fallbackDayCount);
  const dayChips = (
    weeklyPlan?.days ||
    Array.from({ length: fallbackDayCount }, (_, index) => ({
      dateISO: new Date(Date.now() + index * 86400000).toISOString().slice(0, 10),
    }))
  ).map((day, index) => ({
    label: weekdayLabels[index] || day.dateISO,
    value: index,
  }));

  const activeDayData = weeklyPlan?.days?.[activePlanDay] || null;
  const activeRecipeMeal =
    activeRecipeMealType && activeDayData?.meals ? activeDayData.meals[activeRecipeMealType] : null;
  const activeRecipeDetails =
    activeRecipeMeal?.recipeId && recipes.length
      ? recipes.find((recipe) => recipe.id === activeRecipeMeal.recipeId) || null
      : null;
  const activeRecipeName =
    activeRecipeDetails?.name || activeRecipeDetails?.title || getMealDisplayName(activeRecipeMeal);
  const activeRecipeIngredients =
    activeRecipeDetails?.ingredientTokens || activeRecipeMeal?.ingredients || [];
  const activeRecipeSteps =
    activeRecipeDetails?.steps || activeRecipeDetails?.instructions || [];

  const loadingProgressPercent = isLoading
    ? Math.min(95, Math.round((loadingElapsedMs / Math.max(estimatedGenerationMs, 1)) * 100))
    : 0;
  const loadingElapsedSeconds = Math.floor(loadingElapsedMs / 1000);
  const loadingRemainingSeconds = Math.max(
    0,
    Math.ceil((estimatedGenerationMs - loadingElapsedMs) / 1000)
  );

  const groceryGroups = groupGroceries(groceryList);
  const groceryCount = groceryList.length;
  const groceryTotals = null;

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-left">
          <span className="brand-dot" aria-hidden="true" />
          <div>
            <div className="screen-title">{VIEW_LABELS[activeView]}</div>
            <div className="screen-subtitle">PhaseFuel</div>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={toggleDrawer} aria-label="Menu">
          <span className="icon-line" />
          <span className="icon-line" />
          <span className="icon-line" />
        </button>
      </header>

      {drawerOpen ? (
        <div className="drawer" role="dialog" aria-modal="true">
          <div className="drawer-header">
            <span className="drawer-title">Navigate</span>
            <button type="button" className="icon-button" onClick={toggleDrawer} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="drawer-links">
            {Object.keys(VIEW_LABELS).map((view) => (
              <button
                key={view}
                type="button"
                className={activeView === view ? "drawer-link active" : "drawer-link"}
                onClick={() => handleNav(view)}
              >
                {VIEW_LABELS[view]}
              </button>
            ))}
          </div>
          <div className="drawer-footer">
            <div className="status-pill">Status: {generationState}</div>
            <div className="status-note">{status}</div>
          </div>
        </div>
      ) : null}

      <main className="app-main">
        {activeView === "today" ? (
          <section className="screen">
            <div className="hero-block">
              <h1>Today</h1>
              <div className="info-pill">
                Day {(cycleDay || "--")} • {formatPhase(cycleInfo.phase)} • {moonInfo.phase}
              </div>
              <div className="rhythm-badge">
                <div className="rhythm-title">Rhythms</div>
                <div className="rhythm-row">
                  <span>Cycle:</span>
                  <strong>
                    {formatPhase(cycleInfo.phase)} ({Math.round(cycleInfo.confidence * 100)}%)
                  </strong>
                </div>
                <div className="rhythm-row">
                  <span>Moon:</span>
                  <strong>{moonInfo.phase}</strong>
                </div>
                <div className="rhythm-row">
                  <span>Sync:</span>
                  <strong>{syncScore}</strong>
                </div>
                <div className="rhythm-disclaimer">Symbolic cadence only • not medical advice.</div>
              </div>
              <p className="hero-line">Cycle-aware meals. Period.</p>
              <div className="stat-lines">
                <div>
                  <span>Energy</span>
                  <strong>{ENERGY_BY_PHASE[cycleInfo.phase] || "Steady"}</strong>
                </div>
                <div>
                  <span>Focus</span>
                  <strong>{FOCUS_BY_PHASE[cycleInfo.phase] || "Grounded"}</strong>
                </div>
              </div>
              <form onSubmit={handleGenerate} className="form-grid">
                <label>
                  User ID
                  <input
                    type="text"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    placeholder="alex"
                    required
                  />
                </label>
                <label>
                  Cycle Day
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={cycleDay}
                    onChange={(event) => setCycleDay(event.target.value)}
                    placeholder="14"
                    required
                  />
                </label>
                <label>
                  Plan Days
                  <select
                    value={planDays}
                    onChange={(event) => setPlanDays(Number.parseInt(event.target.value, 10))}
                  >
                    {Array.from({ length: 7 }, (_, index) => {
                      const day = index + 1;
                      return (
                        <option key={day} value={day}>
                          {day} {day === 1 ? "day" : "days"}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="stretch">
                  Symptoms
                  <textarea
                    rows="3"
                    value={symptoms}
                    onChange={(event) => setSymptoms(event.target.value)}
                    placeholder="bloating, low energy"
                    required
                  />
                </label>
                <label>
                  Dietary Preferences
                  <input
                    type="text"
                    value={dietaryPreferences}
                    onChange={(event) => setDietaryPreferences(event.target.value)}
                    placeholder="vegetarian, high-protein"
                  />
                </label>
                <label>
                  Cuisine Focus
                  <input
                    type="text"
                    value={cuisinePreferences}
                    onChange={(event) => setCuisinePreferences(event.target.value)}
                    placeholder="Mediterranean, Korean"
                  />
                </label>
                <label className="stretch">
                  Avoid/Dislikes
                  <textarea
                    rows="2"
                    value={foodAvoidances}
                    onChange={(event) => setFoodAvoidances(event.target.value)}
                    placeholder="cilantro, peanuts"
                  />
                </label>
                {settings.featureFlags.enableBudgetOptimizer ? (
                  <label className="stretch">
                    Budget Constraints
                    <textarea
                      rows="2"
                      value={budgetNotes}
                      onChange={(event) => setBudgetNotes(event.target.value)}
                      placeholder="$60/week, prioritize bulk grains"
                    />
                  </label>
                ) : null}
                <button type="submit" className="primary-button" disabled={isLoading || !isDataReady}>
                  {isLoading ? "Generating..." : "Generate Plan"}
                </button>
                {isLoading ? (
                  <p className="helper" role="status" aria-live="polite">
                    Generating plan… elapsed {formatDuration(loadingElapsedSeconds)} • about {formatDuration(
                      loadingRemainingSeconds
                    )} remaining.
                  </p>
                ) : null}
              </form>
              <div className="secondary-actions">
                {(settings.featureFlags.enableUseWhatYouHaveMode ||
                  settings.featureFlags.enablePantryTracking) && (
                  <button type="button" className="link-button" onClick={handleUseWhatYouHave}>
                    Use what you have &gt;
                  </button>
                )}
              </div>
              <div className="status-strip">
                <div className={`status-pill ${generationState}`}>State: {generationState}</div>
                {pantryFirst ? <div className="tag">Pantry-first plan</div> : null}
              </div>
              <div className="status-note">{status}</div>
              {plannerError ? <div className="alert">{plannerError}</div> : null}
            </div>
            <details className="accordion" open={false}>
              <summary>PLAN NARRATIVE</summary>
              <div className="accordion-body">
                <p>{planNarrative?.summaryText || "Generate a plan to see the narrative summary."}</p>
                {planNarrative?.groceryByAisle?.length ? (
                  <div className="narrative-grocery">
                    {planNarrative.groceryByAisle.map((aisle) => (
                      <div key={aisle.aisle}>
                        <strong>{aisle.aisle}</strong>
                        <ul>
                          {aisle.items.map((item) => (
                            <li key={`${aisle.aisle}-${item}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
            <details className="accordion" open={false}>
              <summary>RECIPE FINDER</summary>
              <div className="accordion-body">
                {dataState.status === "loading" ? (
                  <div className="recipe-finder-skeleton" aria-label="Loading recipe datasets">
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                  </div>
                ) : dataState.status === "error" ? (
                  <p>Unable to load recipe datasets. Check your connection and reload.</p>
                ) : (
                  <div className="recipe-finder">
                    <div className="filter-grid">
                      <label>
                        Meal type
                        <select
                          value={filterMealType}
                          onChange={(event) => setFilterMealType(event.target.value)}
                        >
                          <option value="">Any</option>
                          {mealTypeOptions.map((mealType) => (
                            <option key={mealType} value={mealType}>
                              {mealType}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="filter-group">
                        <span>Diet flags</span>
                        <div className="chip-row">
                          {dietFlagOptions.length ? (
                            dietFlagOptions.map((flag) => (
                              <button
                                key={flag}
                                type="button"
                                className={filterDietFlags.includes(flag) ? "chip active" : "chip"}
                                onClick={() => toggleDietFlag(flag)}
                              >
                                <span>{flag}</span>
                                {filterDietFlags.includes(flag) ? <span className="chip-dot" /> : null}
                              </button>
                            ))
                          ) : (
                            <span className="helper">No diet flags available.</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <label className="stretch">
                      Ingredient filters
                      <div className="search-row compact">
                        <input
                          type="search"
                          value={filterIngredientQuery}
                          onChange={(event) => {
                            setFilterIngredientQuery(event.target.value);
                            setFilterError("");
                          }}
                          placeholder="Search ingredients"
                        />
                        <button type="button" className="ghost" onClick={handleAddIngredientFilter}>
                          Add
                        </button>
                      </div>
                      {filterError ? <div className="helper error">{filterError}</div> : null}
                      {filterIngredientSuggestions.length ? (
                        <div className="suggestions">
                          {filterIngredientSuggestions.map((ingredient) => (
                            <button
                              key={ingredient.id}
                              type="button"
                              className="suggestion"
                              onClick={() => addIngredientFilter(ingredient)}
                            >
                              <span>{ingredient.name}</span>
                              {ingredient.category ? (
                                <span className={`badge badge-${ingredient.category}`}>
                                  {formatCategory(ingredient.category)}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </label>
                    <div className="chip-row">
                      {selectedIngredients.length ? (
                        selectedIngredients.map((ingredient) => (
                          <button
                            type="button"
                            key={ingredient.id}
                            className="chip active ingredient-chip"
                            onClick={() => removeIngredientFilter(ingredient.id)}
                          >
                            <span>{ingredient.name}</span>
                            {ingredient.category ? (
                              <span className={`badge badge-${ingredient.category}`}>
                                {formatCategory(ingredient.category)}
                              </span>
                            ) : null}
                            <span className="chip-action">×</span>
                          </button>
                        ))
                      ) : (
                        <span className="helper">No ingredient filters selected.</span>
                      )}
                    </div>
                    <div className="match-summary">
                      Matching recipes: <strong>{filteredRecipes.total}</strong>
                    </div>
                    {filteredRecipes.items.length ? (
                      <ul className="recipe-results">
                        {filteredRecipes.items.map((recipe) => (
                          <li key={recipe.id} className="recipe-result">
                            <div>
                              <strong>{recipe.title}</strong>
                              <div className="tag-row">
                                {recipe.mealTypes.map((mealType) => (
                                  <span className="tag" key={`${recipe.id}-${mealType}`}>
                                    {mealType}
                                  </span>
                                ))}
                              </div>
                              {recipe.ingredientPreview ? (
                                <div className="helper">{recipe.ingredientPreview}</div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="helper">No recipes match the current filters.</p>
                    )}
                  </div>
                )}
              </div>
            </details>
            <DatasetDiagnostics data={data} />
            <div className="disclaimer-note">
              Not medical advice. Low-FODMAP guidance is portion-sensitive and this planner uses a
              conservative heuristic.
            </div>
          </section>
        ) : null}

        {activeView === "plan" ? (
          <section className="screen">
            <div className="section-header">
              <h2>PLAN</h2>
              <button type="button" className="ghost" onClick={handleExportPlan}>
                Export JSON
              </button>
              <div className="chip-row">
                {dayChips.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    className={activePlanDay === chip.value ? "chip active" : "chip"}
                    onClick={() => setActivePlanDay(chip.value)}
                  >
                    <span>{chip.label}</span>
                    {activePlanDay === chip.value ? <span className="chip-dot" /> : null}
                  </button>
                ))}
              </div>
            </div>
            {isLoading ? (
              <div className="loading-state" role="status" aria-live="polite">
                <div className="loading-spinner" aria-hidden="true" />
                <p>Generating your plan. This can take a moment.</p>
                <div className="progress-track" aria-hidden="true">
                  <div
                    className="progress-fill"
                    style={{ width: `${loadingProgressPercent}%` }}
                  />
                </div>
                <div className="progress-stats">
                  <span>{loadingProgressPercent}% complete</span>
                  <span>Elapsed {formatDuration(loadingElapsedSeconds)}</span>
                  <span>ETA {formatDuration(loadingRemainingSeconds)}</span>
                </div>
              </div>
            ) : weeklyPlan ? (
              <>
                <div className="calendar-grid">
                  {weeklyPlan.days.map((day, index) => (
                    <button
                      type="button"
                      key={day.dateISO}
                      className={activePlanDay === index ? "calendar-card active" : "calendar-card"}
                      onClick={() => setActivePlanDay(index)}
                    >
                      <div className="calendar-header">{weekdayLabels[index]}</div>
                      <div className="calendar-date">{day.dateISO}</div>
                      <div className="calendar-meal">{getMealDisplayName(day.meals.breakfast)}</div>
                      <div className="calendar-meal">{getMealDisplayName(day.meals.lunch)}</div>
                      <div className="calendar-meal">{getMealDisplayName(day.meals.dinner)}</div>
                    </button>
                  ))}
                </div>

                <div className="plan-section">
                  <h3>{activeDayData ? `Day ${activePlanDay + 1}` : "Select a day"}</h3>
                  {activeDayData ? (
                    ["breakfast", "lunch", "dinner", "snack"]
                      .filter((mealType) => activeDayData.meals[mealType])
                      .map((mealType) => {
                        const meal = activeDayData.meals[mealType];
                        const isRecipeOpen = activeRecipeMealType === mealType;
                        return (
                          <div className="meal-card" key={mealType}>
                            <div>
                              <h4>{getMealDisplayName(meal)}</h4>
                              <div className="tag-row">
                                <span className="tag">{mealType}</span>
                                <span className="tag">{formatPhase(cycleInfo.phase)} phase</span>
                              </div>
                            </div>
                            <div className="card-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() =>
                                  setActiveRecipeMealType((current) =>
                                    current === mealType ? null : mealType
                                  )
                                }
                              >
                                {isRecipeOpen ? "Hide recipe" : "View recipe"}
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => handleSwapMeal(activePlanDay, mealType)}
                              >
                                Swap meal
                              </button>
                              {mealType === "dinner" ? (
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={handleAddDinnerToGroceries}
                                >
                                  Add to Grocery
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                  ) : (
                    <p>Select a day to view details.</p>
                  )}

                  {activeRecipeMeal ? (
                    <div className="meal-card recipe-details-card">
                      <div>
                        <h4>{activeRecipeName}</h4>
                        <div className="tag-row">
                          <span className="tag">{activeRecipeMealType}</span>
                          {activeRecipeDetails?.timeMinutes ? (
                            <span className="tag">{activeRecipeDetails.timeMinutes} min</span>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <h5>Ingredients</h5>
                        {renderMealIngredients(activeRecipeIngredients)}
                      </div>
                      <div>
                        <h5>Instructions</h5>
                        {activeRecipeSteps.length ? (
                          <ol className="instruction-list">
                            {activeRecipeSteps.map((step, index) => (
                              <li key={`${activeRecipeMeal.recipeId}-step-${index}`}>{step}</li>
                            ))}
                          </ol>
                        ) : (
                          <p className="helper">No detailed instructions available for this recipe.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="why-panel">
                  <h3>Why this plan?</h3>
                  {activeDayData ? (
                    <ul>
                      {Object.values(activeDayData.meals).flatMap((meal) =>
                        (meal.rationale || []).map((reason, index) => (
                          <li key={`${meal.recipeId}-${index}`}>{reason}</li>
                        ))
                      )}
                    </ul>
                  ) : (
                    <p>No rationale yet. Generate a plan to see details.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p>No plan generated yet. Head to Today and generate a plan.</p>
              </div>
            )}
          </section>
        ) : null}

        {activeView === "grocery" ? (
          <section className="screen">
            <div className="section-header">
              <h2>GROCERY</h2>
              <div className="search-row">
                <input type="search" placeholder="Search groceries" />
                <button type="button" className="ghost" onClick={handleCopyGroceries}>
                  Copy
                </button>
                <button type="button" className="ghost" onClick={clearChecks}>
                  Clear Checks
                </button>
              </div>
            </div>
            <div className="accordion-stack">
              {Object.entries(groceryGroups).length ? (
                Object.entries(groceryGroups).map(([category, items]) => (
                  <details className="accordion" key={category} open>
                    <summary>{category.toUpperCase()}</summary>
                    <div className="accordion-body">
                      {items.map((item) => {
                        const key = `${item.category}-${item.name}`;
                        return (
                          <label className="checkbox-row" key={key}>
                            <input
                              type="checkbox"
                              checked={Boolean(groceryChecks[key])}
                              onChange={() => toggleCheck(key)}
                            />
                            <span className="checkbox-label">
                              {item.name}
                              <span className="checkbox-meta">
                                {item.qty} {item.unit}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ))
              ) : (
                <div className="empty-state">
                  <p>No grocery list yet. Generate a plan to populate items.</p>
                </div>
              )}
            </div>
            <div className="grocery-footer">
              {settings.featureFlags.enableBudgetOptimizer && settings.weeklyBudget ? (
                <div className="budget-meter">
                  <div className="budget-row">
                    <span>Weekly Budget</span>
                    <strong>${settings.weeklyBudget}</strong>
                  </div>
                  <div className="budget-row">
                    <span>Planner Estimate</span>
                    <strong>
                      {groceryTotals
                        ? `$${groceryTotals.estMin} - $${groceryTotals.estMax}`
                        : "Not available"}
                    </strong>
                  </div>
                </div>
              ) : null}
              <div className="total-items">Total items: {groceryCount}</div>
            </div>
          </section>
        ) : null}

        {activeView === "profile" ? (
          <section className="screen">
            <div className="section-header">
              <h2>Profile</h2>
              <p className="muted">Manage saved plan archive and privacy settings.</p>
            </div>
            <div className="card">
              <h3>Privacy</h3>
              <p>
                PhaseFuel never stores secret keys in the browser. AI narration runs through the
                backend proxy with rate limits.
              </p>
            </div>
            <div className="card">
              <h3>Saved Plans</h3>
              <p>Pull a saved plan by user ID, or wipe it.</p>
              <label>
                Lookup User ID
                <input
                  type="text"
                  value={lookupUserId}
                  onChange={(event) => setLookupUserId(event.target.value)}
                  placeholder="alex"
                />
              </label>
              <div className="button-row">
                <button type="button" className="primary-button" onClick={handleLoadPlan}>
                  Load Plan
                </button>
                <button type="button" className="ghost" onClick={handleClearPlan}>
                  Clear Plan
                </button>
              </div>
              <pre className="output">{savedPlan}</pre>
            </div>
          </section>
        ) : null}

        {activeView === "privacy" ? (
          <section className="screen">
            <div className="section-header">
              <h2>Privacy</h2>
              <p className="muted">Data handling, storage, and disclaimers.</p>
            </div>
            <div className="card">
              <h3>Stored locally</h3>
              <ul>
                <li>Meal plans and grocery checkmarks saved in your browser storage.</li>
                <li>Pantry, freezer, and price memory items if enabled.</li>
                <li>Settings such as cycle preferences and diet constraints.</li>
              </ul>
            </div>
            <div className="card">
              <h3>Sent to server</h3>
              <p>
                The narrative endpoint receives only the WeeklyPlan JSON plus a short profile
                summary and allowed ingredient tokens to format copy.
              </p>
            </div>
            <div className="card">
              <h3>Disclaimers</h3>
              <p>
                PhaseFuel is not medical advice. Low-FODMAP guidance is portion-sensitive and this
                planner uses conservative heuristics.
              </p>
            </div>
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section className="screen">
            <div className="section-header">
              <h2>Settings</h2>
              <p className="muted">Toggles, cycle preferences, and feature modules.</p>
            </div>
            <div className="card">
              <h3>Core Preferences</h3>
              <div className="toggle-list">
                {coreSettings.map((item) => (
                  <label className="toggle-item" key={item.key}>
                    <div>
                      <span className="toggle-label">{item.label}</span>
                      <span className="toggle-description">{item.description}</span>
                    </div>
                    <input type="checkbox" checked={item.value} onChange={item.onChange} />
                  </label>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>Cycle Preferences</h3>
              <div className="cycle-grid">
                <label>
                  Last Period Start
                  <input
                    type="date"
                    value={settings.cyclePreferences.lastPeriodStart}
                    onChange={(event) =>
                      handleCyclePreferenceChange("lastPeriodStart", event.target.value)
                    }
                  />
                </label>
                <label>
                  Last Ovulation (optional)
                  <input
                    type="date"
                    value={settings.cyclePreferences.lastOvulation}
                    onChange={(event) =>
                      handleCyclePreferenceChange("lastOvulation", event.target.value)
                    }
                  />
                </label>
                <label>
                  Cycle Length (days)
                  <input
                    type="number"
                    min="20"
                    max="45"
                    value={settings.cyclePreferences.cycleLength}
                    onChange={(event) =>
                      handleCyclePreferenceChange(
                        "cycleLength",
                        Number.parseInt(event.target.value || "0", 10)
                      )
                    }
                  />
                </label>
                <label>
                  Luteal Length (days)
                  <input
                    type="number"
                    min="10"
                    max="18"
                    value={settings.cyclePreferences.lutealLength}
                    onChange={(event) =>
                      handleCyclePreferenceChange(
                        "lutealLength",
                        Number.parseInt(event.target.value || "0", 10)
                      )
                    }
                  />
                </label>
                <label>
                  Period Length (days)
                  <input
                    type="number"
                    min="3"
                    max="10"
                    value={settings.cyclePreferences.periodLength}
                    onChange={(event) =>
                      handleCyclePreferenceChange(
                        "periodLength",
                        Number.parseInt(event.target.value || "0", 10)
                      )
                    }
                  />
                </label>
                <label>
                  Cycle Mode
                  <select
                    value={settings.cycleMode}
                    onChange={(event) => handleSettingsChange("cycleMode", event.target.value)}
                  >
                    <option value="period_based">Period-based</option>
                    <option value="ovulation_aware">Ovulation-aware</option>
                    <option value="moon_only">Moon-only</option>
                    <option value="symptom_only">Symptom-only</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="card">
              <h3>Batch & Budget</h3>
              <div className="cycle-grid">
                <label>
                  Batch Day Of Week
                  <input
                    type="text"
                    value={settings.batchDayOfWeek}
                    onChange={(event) => handleSettingsChange("batchDayOfWeek", event.target.value)}
                  />
                </label>
                <label>
                  Batch Time Budget (min)
                  <input
                    type="number"
                    min="30"
                    value={settings.batchTimeBudgetMin}
                    onChange={(event) =>
                      handleSettingsChange(
                        "batchTimeBudgetMin",
                        Number.parseInt(event.target.value || "0", 10)
                      )
                    }
                  />
                </label>
                <label>
                  Time Budget (min)
                  <input
                    type="number"
                    min="10"
                    value={settings.timeBudgetMin}
                    onChange={(event) =>
                      handleSettingsChange(
                        "timeBudgetMin",
                        Number.parseInt(event.target.value || "0", 10)
                      )
                    }
                  />
                </label>
                <label>
                  Weekly Budget
                  <input
                    type="number"
                    min="0"
                    value={settings.weeklyBudget || ""}
                    onChange={(event) =>
                      handleSettingsChange(
                        "weeklyBudget",
                        event.target.value ? Number.parseFloat(event.target.value) : null
                      )
                    }
                  />
                </label>
                <label>
                  Cost Mode
                  <select
                    value={settings.costMode}
                    onChange={(event) => handleSettingsChange("costMode", event.target.value)}
                  >
                    <option value="tight">Tight</option>
                    <option value="normal">Normal</option>
                    <option value="generous">Generous</option>
                  </select>
                </label>
                <label>
                  Max Repeats Per Week
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={settings.maxRepeatsPerWeek}
                    onChange={(event) =>
                      handleSettingsChange(
                        "maxRepeatsPerWeek",
                        Number.parseInt(event.target.value || "0", 10)
                      )
                    }
                  />
                </label>
              </div>
            </div>
            <div className="card">
              <h3>Diet & Constraints</h3>
              <div className="cycle-grid">
                <label>
                  Diet Pattern
                  <select
                    value={settings.dietPattern}
                    onChange={(event) => handleSettingsChange("dietPattern", event.target.value)}
                  >
                    <option value="omnivore">Omnivore</option>
                    <option value="pescatarian">Pescatarian</option>
                    <option value="vegetarian">Vegetarian</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </label>
                <label>
                  Gluten-free
                  <input
                    type="checkbox"
                    checked={settings.glutenFree}
                    onChange={() => handleSettingsChange("glutenFree", !settings.glutenFree)}
                  />
                </label>
                <label>
                  Low-FODMAP Strictness
                  <select
                    value={settings.lowFodmapMode}
                    onChange={(event) => handleSettingsChange("lowFodmapMode", event.target.value)}
                  >
                    <option value="off">Off</option>
                    <option value="moderate">Moderate</option>
                    <option value="strict">Strict</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="card">
              <h3>Feature Flags</h3>
              <div className="toggle-list">
                {featureFlags.map((flag) => (
                  <label className="toggle-item" key={flag.key}>
                    <div>
                      <span className="toggle-label">{flag.label}</span>
                      <span className="toggle-description">{flag.description}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.featureFlags[flag.key]}
                      onChange={() =>
                        updateSettings({
                          featureFlags: {
                            [flag.key]: !settings.featureFlags[flag.key],
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
            <button type="button" className="ghost" onClick={handleResetDefaults}>
              Reset to Defaults
            </button>

            {settings.featureFlags.enablePantryTracking ? (
              <div className="card">
                <h3>Pantry</h3>
                <p>Track pantry items for pantry-first planning.</p>
                <form onSubmit={addPantryItem} className="form-grid">
                  <label>
                    Item
                    <input
                      type="text"
                      value={pantryInput.name}
                      onChange={(event) =>
                        setPantryInput((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Qty
                    <input
                      type="text"
                      value={pantryInput.qty}
                      onChange={(event) =>
                        setPantryInput((current) => ({ ...current, qty: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      type="text"
                      value={pantryInput.unit}
                      onChange={(event) =>
                        setPantryInput((current) => ({ ...current, unit: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Expires On
                    <input
                      type="date"
                      value={pantryInput.expiresOn}
                      onChange={(event) =>
                        setPantryInput((current) => ({
                          ...current,
                          expiresOn: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button type="submit" className="primary-button">
                    Add/Update Pantry Item
                  </button>
                </form>
                <ul className="inventory-list">
                  {pantryItems.map((item) => (
                    <li key={item.name}>
                      <span>{item.name}</span>
                      <span>{item.qty ? `${item.qty} ${item.unit || ""}` : ""}</span>
                      <span>{item.expiresOn ? `Expires ${item.expiresOn}` : ""}</span>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setPantryItems((items) => removePantryItem(items, item.name))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {settings.featureFlags.enableFreezerTags ? (
              <div className="card">
                <h3>Freezer Inventory</h3>
                <p>Track frozen portions for future planning.</p>
                <form onSubmit={addFreezerEntry} className="form-grid">
                  <label>
                    Item
                    <input
                      type="text"
                      value={freezerInput.name}
                      onChange={(event) =>
                        setFreezerInput((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Portions
                    <input
                      type="number"
                      min="1"
                      value={freezerInput.portions}
                      onChange={(event) =>
                        setFreezerInput((current) => ({ ...current, portions: event.target.value }))
                      }
                    />
                  </label>
                  <button type="submit" className="primary-button">
                    Add to Freezer
                  </button>
                </form>
                <ul className="inventory-list">
                  {freezerItems.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      <span>{item.name}</span>
                      <span>{item.portions ? `${item.portions} portions` : ""}</span>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setFreezerItems((items) => removeFreezerItem(items, index))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {settings.featureFlags.enableBudgetOptimizer ? (
              <div className="card">
                <h3>Price Memory</h3>
                <p>Store common prices for better estimates and swaps.</p>
                <form onSubmit={addPriceEntry} className="form-grid">
                  <label>
                    Item
                    <input
                      type="text"
                      value={priceInput.name}
                      onChange={(event) =>
                        setPriceInput((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      type="text"
                      value={priceInput.unit}
                      onChange={(event) =>
                        setPriceInput((current) => ({ ...current, unit: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Price
                    <input
                      type="number"
                      step="0.01"
                      value={priceInput.price}
                      onChange={(event) =>
                        setPriceInput((current) => ({ ...current, price: event.target.value }))
                      }
                    />
                  </label>
                  <button type="submit" className="primary-button">
                    Add/Update Price
                  </button>
                </form>
                <ul className="inventory-list">
                  {priceItems.map((item) => (
                    <li key={item.name}>
                      <span>{item.name}</span>
                      <span>
                        {item.price}/{item.unit}
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setPriceItems((items) => removePriceItem(items, item.name))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                {settings.weeklyBudget ? (
                  <div className="inline-note">Weekly budget: {settings.weeklyBudget}</div>
                ) : null}
              </div>
            ) : null}

            {settings.featureFlags.enableLeftoverFatiguePrevention ? (
              <div className="card">
                <h3>Leftover Rotation</h3>
                <p>Recent transformations (avoids repetition).</p>
                <div className="history-list">
                  {historyItems.length
                    ? historyItems.map((item) => <span key={item}>{item}</span>)
                    : "No history yet."}
                </div>
                <div className="history-meta">Tracking last {MAX_HISTORY} transformations.</div>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        {Object.keys(VIEW_LABELS).map((view) => (
          <button
            key={view}
            type="button"
            className={activeView === view ? "nav-item active" : "nav-item"}
            onClick={() => handleNav(view)}
          >
            <span className="nav-icon" aria-hidden="true" />
            <span className="nav-label">{VIEW_LABELS[view]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
