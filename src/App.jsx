import { useEffect, useMemo, useRef, useState } from "react";
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
import { buildFallbackNarrative } from "./lib/ai.js";
import { AI_MODE, generateNarrative } from "./ai";
import { useApiKey } from "./ai/ApiKeyContext.jsx";
import { getMoonPhaseFraction, getMoonPhaseName } from "./engine/moon.js";
import { migrateIfNeeded } from "./storage/migrate.js";
import { exportUserData, importUserData, loadUserData, resetUserData, saveUserData } from "./storage/storage.js";
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
import { createOffProvider } from "./providers/nutrition/off.js";
import { createFdcProvider } from "./providers/nutrition/fdc.js";

const GROCERY_CHECK_KEY = "phasefuel_grocery_checks";
const AUTH_SESSION_KEY = "phasefuel.auth.v1";

const LOGIN_USERS = {
  Maggie: { password: "Demo", role: "user", userId: "Maggie" },
  admin: { password: "admin", role: "admin", userId: "admin" },
};

const VIEW_LABELS = {
  today: "Home",
  plan: "Plan",
  grocery: "Grocery",
  profile: "Profile",
  privacy: "Privacy",
  settings: "Settings",
};

const NAV_ICONS = {
  today: "◐",
  plan: "☰",
  grocery: "✓",
  profile: "◍",
  privacy: "⎈",
  settings: "⚙",
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

const MOON_GUIDANCE = {
  new: {
    intention: "Set intentions and keep meals simple.",
    ritual: "Light a candle, write one goal, and prep one grounding soup.",
    vibe: "Reset",
  },
  "waxing crescent": {
    intention: "Build momentum with energizing foods.",
    ritual: "Add fresh herbs or citrus and choose one growth habit for this week.",
    vibe: "Momentum",
  },
  "first quarter": {
    intention: "Take decisive action on your plan.",
    ritual: "Batch-cook two proteins and commit to your grocery anchors.",
    vibe: "Action",
  },
  "waxing gibbous": {
    intention: "Refine and optimize your routine.",
    ritual: "Review pantry inventory and tighten your meal prep flow.",
    vibe: "Refine",
  },
  full: {
    intention: "Celebrate nourishment and connection.",
    ritual: "Host a shared meal or plate something colorful and abundant.",
    vibe: "Peak",
  },
  "waning gibbous": {
    intention: "Integrate what worked and simplify.",
    ritual: "Use leftovers creatively and note one ritual to keep.",
    vibe: "Integrate",
  },
  "last quarter": {
    intention: "Release friction and reduce decision fatigue.",
    ritual: "Remove one draining recipe and replace it with a quick favorite.",
    vibe: "Release",
  },
  "waning crescent": {
    intention: "Rest, restore, and prep lightly.",
    ritual: "Choose soft, warm meals and keep your next plan minimal.",
    vibe: "Restore",
  },
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

const waitForNextPaint = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });


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
  const { apiKey, setApiKey, clearApiKey, rememberInSession, setRememberInSession } = useApiKey();
  const offProvider = useMemo(() => createOffProvider(), []);
  const fdcProvider = useMemo(() => createFdcProvider(), []);
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
  const [pantryInput, setPantryInput] = useState({ name: "", qty: "", unit: "", expiresOn: "", barcode: "" });
  const [pantryBarcode, setPantryBarcode] = useState("");
  const [pantryIngredientQuery, setPantryIngredientQuery] = useState("");
  const [pantryIngredientHits, setPantryIngredientHits] = useState([]);
  const [freezerInput, setFreezerInput] = useState({ name: "", portions: "" });
  const [priceInput, setPriceInput] = useState({ name: "", unit: "", price: "" });
  const [budgetNotes, setBudgetNotes] = useState("");
  const [generationState, setGenerationState] = useState("idle");
  const [status, setStatus] = useState("Ready.");
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [plannerError, setPlannerError] = useState("");
  const [planNarrative, setPlanNarrative] = useState(null);
  const [groceryList, setGroceryList] = useState([]);
  const [manualGroceryInput, setManualGroceryInput] = useState({
    name: "",
    qty: "",
    unit: "",
    category: "",
  });
  const [grocerySearchQuery, setGrocerySearchQuery] = useState("");
  const [prepSteps, setPrepSteps] = useState([]);
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [lookupUserId, setLookupUserId] = useState("");
  const [aiMode, setAiMode] = useState(AI_MODE.HOSTED);
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
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [session, setSession] = useState(() => {
    const savedSession = localStorage.getItem(AUTH_SESSION_KEY);
    if (!savedSession) {
      return null;
    }
    try {
      const parsed = JSON.parse(savedSession);
      const knownUser = parsed?.username ? LOGIN_USERS[parsed.username] : null;
      if (!knownUser) {
        localStorage.removeItem(AUTH_SESSION_KEY);
        return null;
      }
      return {
        username: parsed.username,
        role: knownUser.role,
        userId: knownUser.userId,
      };
    } catch {
      localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
  });
  const { settings, setSettings, updateSettings } = useSettings();

  const importInputRef = useRef(null);

  const data = dataState.data;
  const recipes = data?.recipes || [];
  const recipeById = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes]);
  const ingredientCatalog = data?.ingredients || [];
  const dietFlagOptions = data?.dietFlags || [];
  const mealTypeOptions = data?.mealTypes || ["breakfast", "lunch", "dinner", "snack"];
  const isDataReady = dataState.status === "ready";

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
  const loadingElapsedSeconds = Math.round(loadingElapsedMs / 1000);
  const estimatedGenerationSeconds = Math.max(1, Math.round(estimatedGenerationMs / 1000));
  const loadingProgress = Math.min(100, Math.round((loadingElapsedMs / estimatedGenerationMs) * 100));
  const cycleInfo = useMemo(
    () => estimatePhase(new Date().toISOString(), settings.cyclePreferences, settings.cycleMode),
    [settings.cyclePreferences, settings.cycleMode]
  );
  const moonInfo = useMemo(() => getMoonPhaseBucket(new Date()), []);
  const syncScore = useMemo(
    () => computeSyncScore(cycleInfo.phase, Math.floor((moonInfo.age / 29.53) * 8)),
    [cycleInfo.phase, moonInfo.age]
  );
  const moonGuidance = MOON_GUIDANCE[moonInfo.phase] || MOON_GUIDANCE.new;

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
    if (!isLoading || !loadingStartedAt) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setLoadingElapsedMs(Date.now() - loadingStartedAt);
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [isLoading, loadingStartedAt]);

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
    if (!userId.trim()) {
      return;
    }
    ensureMigrationForUser(userId.trim());
  }, [userId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setUserId(session.userId);
    if (session.role === "admin") {
      setActiveView("settings");
    }
  }, [session]);

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
    setPantryInput({ name: "", qty: "", unit: "", expiresOn: "", barcode: "" });
  };

  const addFreezerEntry = (event) => {
    event.preventDefault();
    if (!freezerInput.name?.trim()) {
      return;
    }
    setFreezerItems((items) => addFreezerItem(items, freezerInput));
    setFreezerInput({ name: "", portions: "" });
  };

  const handleLookupPantryBarcode = async () => {
    if (!pantryBarcode.trim()) return;
    try {
      const hit = await offProvider.lookupBarcode(pantryBarcode.trim());
      if (!hit) {
        setStatus("Barcode not found in Open Food Facts.");
        return;
      }
      setPantryItems((items) =>
        upsertPantryItem(items, {
          name: hit.name,
          qty: "1",
          unit: hit.servingSize || "pack",
          barcode: hit.barcode || pantryBarcode.trim(),
        })
      );
      setPantryBarcode("");
      setStatus(`Added ${hit.name} from barcode.`);
    } catch (error) {
      setStatus("Barcode lookup failed. Try again later.");
    }
  };

  const handleSearchPantryIngredient = async () => {
    if (!pantryIngredientQuery.trim()) return;
    try {
      const hits = await fdcProvider.searchFoods(pantryIngredientQuery.trim());
      setPantryIngredientHits(hits.slice(0, 6));
      if (!hits.length) setStatus("No USDA matches found.");
    } catch (error) {
      setStatus("USDA lookup failed. Try again later.");
    }
  };

  const handleAddPantryIngredientHit = (hit) => {
    setPantryItems((items) =>
      upsertPantryItem(items, { name: hit.name, qty: "100", unit: "g", nutritionSource: "fdc", nutritionFoodId: hit.id })
    );
    setStatus(`Added ${hit.name} to pantry.`);
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
      enableRecipeProvider: settings.enableRecipeProvider,
      nutritionSources: {
        fdc: settings.nutritionSourceFdc,
        off: settings.nutritionSourceOff,
      },
      lowDataMode: settings.lowDataMode,
    };
  };

  const buildPlanSettings = () => ({
    preferLeftoverLunch: settings.preferLeftoverLunch,
    includeSnacks: settings.includeSnacks,
    maxRepeatsPerWeek: settings.maxRepeatsPerWeek,
    ingredientCatalog,
  });

  const toWeekPlanV2 = (plan, ownerUserId) => ({
    version: 2,
    userId: ownerUserId,
    startDate: plan.startDateISO || plan.weekStartISO || new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    signals: {
      enableMoonCadence: settings.enableMoonCadence,
      sleepSensitive: settings.sleepSensitive,
    },
    days: (plan.days || []).map((day) => ({
      date: day.dateISO,
      phase: (day.phase || cycleInfo.phase || "").toUpperCase(),
      moonPhase: getMoonPhaseName(getMoonPhaseFraction(day.dateISO)),
      macroRanges: day.macroRanges || null,
      emphasis: day.emphasis || { emphasize: [], limit: [], mealStyle: [] },
      meals: {
        breakfast: day.meals?.breakfast || null,
        lunch: day.meals?.lunch || null,
        dinner: day.meals?.dinner || null,
        snacks: [day.meals?.snack].filter(Boolean),
      },
      prepTasks: day.prepTasks || [],
      source: "current",
    })),
  });

  const fromWeekPlanV2 = (weekPlan) => ({
    startDateISO: weekPlan.startDate,
    days: (weekPlan.days || []).map((day) => ({
      dateISO: day.date,
      phase: (day.phase || "").toLowerCase(),
      meals: {
        breakfast: day.meals?.breakfast || null,
        lunch: day.meals?.lunch || null,
        dinner: day.meals?.dinner || null,
        snack: day.meals?.snacks?.[0] || null,
      },
      notes: day.notes || "",
    })),
  });

  const ensureMigrationForUser = (targetUserId) => {
    if (!targetUserId?.trim()) {
      return;
    }
    migrateIfNeeded(targetUserId.trim());
  };

  const getUserData = (targetUserId) => {
    ensureMigrationForUser(targetUserId);
    return loadUserData(targetUserId.trim());
  };

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
    setStatus("Generating personalized plan...");
    setPlannerError("");
    await waitForNextPaint();

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

      const narrativePayload = {
        profileSummary,
        weekStartISO: nextPlan.startDateISO || nextPlan.weekStartISO || "",
        weeklyPlanJson: nextPlan,
        allowedTokens: Array.from(allowedTokens),
      };

      const narrative = await generateNarrative(narrativePayload, {
        mode: aiMode,
        apiKey: aiMode === AI_MODE.BYOK ? apiKey : undefined,
      }).catch(() => fallbackNarrative);
      setPlanNarrative(narrative);

      const normalizedUserId = userId.trim();
      const currentUserData = getUserData(normalizedUserId);
      const weekPlanV2 = toWeekPlanV2(nextPlan, normalizedUserId);

      saveUserData(normalizedUserId, {
        ...currentUserData,
        profile: {
          ...currentUserData.profile,
          cycleDay: Number(cycleDay),
          symptoms: symptoms.trim(),
          settingsSnapshot: settings,
        },
        plans: [...currentUserData.plans, weekPlanV2],
      });
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

    const userData = getUserData(lookupUserId.trim());
    const latestPlan = userData.plans[userData.plans.length - 1];
    if (!latestPlan) {
      setSavedPlan(`No saved plan found for ${lookupUserId.trim()}.`);
      return;
    }

    setWeeklyPlan(fromWeekPlanV2(latestPlan));
    setSavedPlan(JSON.stringify(latestPlan, null, 2));
  };

  const handleClearPlan = () => {
    if (!lookupUserId.trim()) {
      setSavedPlan("Enter a user ID to clear a saved plan.");
      return;
    }

    resetUserData(lookupUserId.trim());
    setSavedPlan(`Cleared saved plan for ${lookupUserId.trim()}.`);
  };

  const handleExportData = () => {
    if (!userId.trim()) {
      setStatus("Enter a user ID before exporting data.");
      return;
    }

    const exportJson = exportUserData(userId.trim());
    const blob = new Blob([exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `phasefuel-user-${userId.trim()}-v2.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("User data exported.");
  };

  const handleImportDataClick = () => {
    importInputRef.current?.click();
  };

  const handleImportDataFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!userId.trim()) {
      setStatus("Enter a user ID before importing data.");
      return;
    }

    try {
      const payload = await file.text();
      importUserData(userId.trim(), payload);
      setStatus("User data imported and merged.");
    } catch (error) {
      setStatus("Import failed. Ensure the JSON file is valid.");
    } finally {
      event.target.value = "";
    }
  };

  const handleResetLocalData = () => {
    if (!userId.trim()) {
      setStatus("Enter a user ID before resetting local data.");
      return;
    }

    resetUserData(userId.trim());
    setWeeklyPlan(null);
    setSavedPlan("No saved plan loaded.");
    setStatus("Local v2 user data reset.");
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

  const handleRemoveGroceryItem = (itemToRemove) => {
    const key = `${itemToRemove.category}-${itemToRemove.name}`;
    setGroceryList((current) =>
      current.filter(
        (item) =>
          !(
            item.name === itemToRemove.name &&
            (item.category || "Other") === (itemToRemove.category || "Other")
          )
      )
    );
    setGroceryChecks((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    setStatus(`Removed ${itemToRemove.name} from grocery list.`);
  };

  const handleManualGroceryAdd = (event) => {
    event.preventDefault();
    const normalizedName = manualGroceryInput.name.trim();
    if (!normalizedName) {
      setStatus("Enter an item name to add to groceries.");
      return;
    }

    const manualItem = {
      name: normalizedName,
      qty: manualGroceryInput.qty.trim(),
      unit: manualGroceryInput.unit.trim(),
      category: formatCategory(manualGroceryInput.category.trim() || "Other"),
    };

    setGroceryList((current) => {
      const alreadyExists = current.some(
        (item) =>
          item.name.toLowerCase() === manualItem.name.toLowerCase() &&
          (item.category || "Other").toLowerCase() === manualItem.category.toLowerCase()
      );
      if (alreadyExists) {
        setStatus(`${manualItem.name} is already in grocery list.`);
        return current;
      }
      setStatus(`Added ${manualItem.name} to grocery list.`);
      return [...current, manualItem];
    });

    setManualGroceryInput({ name: "", qty: "", unit: "", category: "" });
  };

  const handleNav = (view) => {
    setActiveView(view);
    setDrawerOpen(false);
  };

  const handleLoginSubmit = (event) => {
    event.preventDefault();
    const username = loginForm.username.trim();
    const account = LOGIN_USERS[username];
    if (!account || account.password !== loginForm.password) {
      setAuthError("Invalid credentials. Use Maggie/Demo or admin/admin.");
      return;
    }
    const nextSession = {
      username,
      role: account.role,
      userId: account.userId,
    };
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username }));
    setSession(nextSession);
    setAuthError("");
    setLoginForm({ username: "", password: "" });
    setStatus(`Logged in as ${username}.`);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_SESSION_KEY);
    setSession(null);
    setUserId("");
    setActiveView("today");
    setDrawerOpen(false);
    setStatus("Logged out.");
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


  const handleAddMealToGroceries = (mealType) => {
    const ingredients = activeDayData?.meals?.[mealType]?.ingredients || [];
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
      setStatus(`No ${mealType} ingredients available to add.`);
      return;
    }

    setGroceryList((current) => {
      const existing = new Set(current.map((item) => item.name.toLowerCase()));
      const nextAdditions = additions.filter((item) => !existing.has(item.name.toLowerCase()));
      if (!nextAdditions.length) {
        setStatus(`${formatPhase(mealType)} ingredients already in grocery list.`);
        return current;
      }
      setStatus(
        `Added ${nextAdditions.length} ${mealType} item${nextAdditions.length > 1 ? "s" : ""} to grocery list.`
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
    {
      key: "enableRecipeProvider",
      label: "Enable recipe provider (TheMealDB dev)",
      description:
        "Fetch external recipes for solver candidates. Falls back to templates when provider is unavailable.",
      value: settings.enableRecipeProvider,
      onChange: () => updateSettings({ enableRecipeProvider: !settings.enableRecipeProvider }),
    },
    {
      key: "nutritionSourceFdc",
      label: "Nutrition source: USDA FDC",
      description: "Use USDA FoodData Central via server proxy for generic ingredient macros.",
      value: settings.nutritionSourceFdc,
      onChange: () => updateSettings({ nutritionSourceFdc: !settings.nutritionSourceFdc }),
    },
    {
      key: "nutritionSourceOff",
      label: "Nutrition source: Open Food Facts",
      description: "Use Open Food Facts for packaged foods/barcode nutrition.",
      value: settings.nutritionSourceOff,
      onChange: () => updateSettings({ nutritionSourceOff: !settings.nutritionSourceOff }),
    },
    {
      key: "lowDataMode",
      label: "Low-data mode",
      description: "Reduce nutrition API calls; prefer cached/local estimates.",
      value: settings.lowDataMode,
      onChange: () => updateSettings({ lowDataMode: !settings.lowDataMode }),
    },
    {
      key: "enableMoonCadence",
      label: "Enable moon cadence",
      description: "Use moon phase as a planning cadence modifier.",
      value: settings.enableMoonCadence,
      onChange: () => updateSettings({ enableMoonCadence: !settings.enableMoonCadence }),
    },
    {
      key: "sleepSensitive",
      label: "Sleep sensitive",
      description: "Prefer calmer evening snack planning on full moon days.",
      value: settings.sleepSensitive,
      onChange: () => updateSettings({ sleepSensitive: !settings.sleepSensitive }),
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

  const providerAttributions = weeklyPlan
    ? Array.from(
      new Map(
        (weeklyPlan.days || [])
          .flatMap((day) => Object.values(day.meals || {}))
          .flat()
          .filter((meal) => meal?.sourceAttribution?.name && meal?.sourceAttribution?.link)
          .map((meal) => [meal.sourceAttribution.name, meal.sourceAttribution])
      ).values()
    )
    : [];

  const activeDayData = weeklyPlan?.days?.[activePlanDay] || null;
  const activeDayMoonPhase = activeDayData?.dateISO
    ? getMoonPhaseName(getMoonPhaseFraction(activeDayData.dateISO))
    : null;
  const activeRecipeMeal =
    activeRecipeMealType && activeDayData?.meals ? activeDayData.meals[activeRecipeMealType] : null;
  const activeRecipeDetails =
    activeRecipeMeal?.recipeId && recipes.length
      ? recipes.find((recipe) => recipe.id === activeRecipeMeal.recipeId) || null
      : null;
  const activeRecipeName =
    activeRecipeDetails?.name || activeRecipeDetails?.title || activeRecipeMeal?.name || "Recipe";
  const activeRecipeIngredients =
    activeRecipeDetails?.ingredientTokens || activeRecipeMeal?.ingredients || [];
  const activeRecipeSteps =
    activeRecipeDetails?.steps || activeRecipeDetails?.instructions || [];

  const groceryGroups = groupGroceries(groceryList);
  const onboardingSteps = [
    {
      id: "profile",
      title: "Set your rhythm",
      detail: "Add your user ID + cycle day to personalize meals.",
      complete: Boolean(userId && cycleDay),
    },
    {
      id: "plan",
      title: "Generate your first plan",
      detail: "Build a 3 or 7 day roadmap and swap meals as needed.",
      complete: Boolean(weeklyPlan?.days?.length),
    },
    {
      id: "grocery",
      title: "Shop from your list",
      detail: "Open Grocery to check off essentials while you shop.",
      complete: Boolean(groceryList.length),
    },
  ];
  const completedOnboarding = onboardingSteps.filter((step) => step.complete).length;
  const filteredGroceryGroups = Object.fromEntries(
    Object.entries(groceryGroups)
      .map(([category, items]) => {
        const filteredItems = items.filter((item) => {
          const text = `${item.name} ${item.qty} ${item.unit} ${category}`.toLowerCase();
          return text.includes(grocerySearchQuery.trim().toLowerCase());
        });
        return [category, filteredItems];
      })
      .filter(([, items]) => items.length)
  );
  const groceryCount = groceryList.length;
  const groceryTotals = null;

  if (!session) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="screen">
            <div className="card">
              <h2>Log in to PhaseFuel</h2>
              <p className="helper">User: Maggie / Demo • Admin: admin / admin</p>
              <form onSubmit={handleLoginSubmit} className="form-grid">
                <label>
                  Username
                  <input
                    type="text"
                    value={loginForm.username}
                    onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="Maggie"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="Demo"
                    required
                  />
                </label>
                <button type="submit">Log In</button>
                {authError ? <p className="helper warning-banner">{authError}</p> : null}
              </form>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-left">
          <span className="brand-dot" aria-hidden="true">.</span>
          <div>
            <div className="screen-title">.</div>
            <div className="screen-subtitle">Period</div>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={toggleDrawer} aria-label="Menu">
          <span className="icon-line" />
          <span className="icon-line" />
          <span className="icon-line" />
        </button>
        <button type="button" className="ghost" onClick={handleLogout}>
          Log out
        </button>
      </header>

      {drawerOpen ? (
        <>
          <button
            type="button"
            className="drawer-backdrop"
            onClick={toggleDrawer}
            aria-label="Close navigation"
          />
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
        </>
      ) : null}

      <main className="app-main">
        {activeView === "today" ? (
          <section className="screen">
            <div className="hero-block">
              <h1>Home</h1>
              <p className="hero-subline">Build your week in under a minute.</p>
              <div className="onboarding-panel" aria-live="polite">
                <div className="onboarding-header">
                  <h2>Quick Start</h2>
                  <span>
                    {completedOnboarding}/{onboardingSteps.length} complete
                  </span>
                </div>
                <div className="onboarding-track" role="progressbar" aria-valuemin={0} aria-valuemax={onboardingSteps.length} aria-valuenow={completedOnboarding}>
                  <span style={{ width: `${(completedOnboarding / onboardingSteps.length) * 100}%` }} />
                </div>
                <ul className="onboarding-list">
                  {onboardingSteps.map((step) => (
                    <li key={step.id} className={step.complete ? "is-complete" : ""}>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                      </div>
                      <button type="button" className="ghost" onClick={() => handleNav(step.id)}>
                        {step.complete ? "Review" : "Go"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="info-pill">
                Day {(cycleDay || "--")} • {formatPhase(cycleInfo.phase)} • {moonInfo.phase}
              </div>
              <div className="moon-oracle" aria-live="polite">
                <div className="moon-oracle-kicker">Moon Oracle • {moonInfo.phase}</div>
                <p className="moon-oracle-intention">{moonGuidance.intention}</p>
                <p className="moon-oracle-ritual">Ritual cue: {moonGuidance.ritual}</p>
                <div className="tag-row">
                  <span className="tag">Arc: {moonGuidance.vibe}</span>
                  <span className="tag">Lunar day: {Math.round(moonInfo.age) + 1}</span>
                </div>
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
              <div className="quick-actions">
                <button type="button" className="ghost" onClick={() => setPlanDays(3)}>
                  Quick 3-day reset
                </button>
                <button type="button" className="ghost" onClick={() => setPlanDays(7)}>
                  Full 7-day ritual
                </button>
              </div>
              <form onSubmit={handleGenerate} className="form-grid">
                <div className="quick-start-grid">
                  <label>
                    User ID
                    <input
                      type="text"
                      value={userId}
                      onChange={(event) => setUserId(event.target.value)}
                      placeholder="alex"
                      required
                      readOnly
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
                </div>
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
                <details className="accordion stretch" open={false}>
                  <summary>Advanced preferences</summary>
                  <div className="accordion-body">
                    <button type="button" className="ghost" onClick={() => handleNav("settings")}>Open advanced settings</button>
                    <div className="ai-mode-row">
                      <span>AI Mode</span>
                      <div className="segmented-control" role="radiogroup" aria-label="AI mode">
                        <button
                          type="button"
                          className={aiMode === AI_MODE.HOSTED ? "active" : ""}
                          onClick={() => setAiMode(AI_MODE.HOSTED)}
                        >
                          Hosted
                        </button>
                        <button
                          type="button"
                          className={aiMode === AI_MODE.BYOK ? "active" : ""}
                          onClick={() => setAiMode(AI_MODE.BYOK)}
                        >
                          BYOK
                        </button>
                      </div>
                    </div>
                    {aiMode === AI_MODE.BYOK ? (
                      <div className="byok-panel">
                        <p className="helper warning-banner">
                          Key stays in your browser; don’t use on shared computers.
                        </p>
                        <label>
                          OpenAI API Key
                          <input
                            type="password"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="sk-..."
                            autoComplete="off"
                          />
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={rememberInSession}
                            onChange={(event) => setRememberInSession(event.target.checked)}
                          />
                          Remember until tab closes
                        </label>
                        <button type="button" className="link-button" onClick={clearApiKey}>
                          Clear Key
                        </button>
                      </div>
                    ) : null}
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
                    <label>
                      Avoid/Dislikes
                      <textarea
                        rows="2"
                        value={foodAvoidances}
                        onChange={(event) => setFoodAvoidances(event.target.value)}
                        placeholder="cilantro, peanuts"
                      />
                    </label>
                    {settings.featureFlags.enableBudgetOptimizer ? (
                      <label>
                        Budget Constraints
                        <textarea
                          rows="2"
                          value={budgetNotes}
                          onChange={(event) => setBudgetNotes(event.target.value)}
                          placeholder="$60/week, prioritize bulk grains"
                        />
                      </label>
                    ) : null}
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={settings.glutenFree}
                        onChange={() => handleSettingsChange("glutenFree", !settings.glutenFree)}
                      />
                      Gluten-free meal planner
                    </label>
                  </div>
                </details>
                <button type="submit" className="primary-button" disabled={isLoading || !isDataReady}>
                  {isLoading ? "Generating..." : "Generate Plan"}
                </button>
                {isLoading ? (
                  <p className="helper" role="status" aria-live="polite">
                    Please wait while your plan is being generated ({formatDuration(
                      loadingElapsedSeconds
                    )}
                    /~{formatDuration(estimatedGenerationSeconds)}).
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
              <p className="helper">
                Recipe provider uses TheMealDB test key "1" for development/education only.
                Public app-store release needs a supporter key per TheMealDB docs.
              </p>
            </div>
            {isLoading ? (
              <div className="loading-state" role="status" aria-live="polite">
                <div className="loading-spinner" aria-hidden="true" />
                <p>Generating your plan. This can take a moment.</p>
                <p className="helper">
                  Elapsed {formatDuration(loadingElapsedSeconds)} / estimated{" "}
                  {formatDuration(estimatedGenerationSeconds)}
                </p>
                <progress value={loadingProgress} max="100" aria-label="Plan generation progress" />
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
                  {activeDayMoonPhase ? <p className="helper">Moon phase: {activeDayMoonPhase}</p> : null}
                  {activeDayData?.notes ? <p className="helper">Notes: {activeDayData.notes}</p> : null}
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
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => handleAddMealToGroceries(mealType)}
                              >
                                Add to Grocery
                              </button>
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
                  {activeDayData?.notes ? <p className="helper">Notes: {activeDayData.notes}</p> : null}
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

                {providerAttributions.length ? (
                  <div className="disclaimer-note">
                    External recipe attribution: {providerAttributions.map((item, index) => (
                      <span key={item.name}>
                        {index > 0 ? ", " : ""}
                        <a href={item.link} target="_blank" rel="noreferrer">
                          {item.name}
                        </a>
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state">
                <p>No plan generated yet. Head to Home and generate a plan.</p>
              </div>
            )}
          </section>
        ) : null}

        {activeView === "grocery" ? (
          <section className="screen">
            <div className="section-header">
              <h2>GROCERY</h2>
              <div className="search-row">
                <input
                  type="search"
                  placeholder="Search groceries"
                  value={grocerySearchQuery}
                  onChange={(event) => setGrocerySearchQuery(event.target.value)}
                />
                <button type="button" className="ghost" onClick={handleCopyGroceries}>
                  Copy
                </button>
                <button type="button" className="ghost" onClick={clearChecks}>
                  Clear Checks
                </button>
              </div>
            </div>
            <form className="form-grid" onSubmit={handleManualGroceryAdd}>
              <label>
                Item
                <input
                  type="text"
                  placeholder="Add manual grocery item"
                  value={manualGroceryInput.name}
                  onChange={(event) =>
                    setManualGroceryInput((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label>
                Qty
                <input
                  type="text"
                  value={manualGroceryInput.qty}
                  onChange={(event) =>
                    setManualGroceryInput((current) => ({ ...current, qty: event.target.value }))
                  }
                />
              </label>
              <label>
                Unit
                <input
                  type="text"
                  value={manualGroceryInput.unit}
                  onChange={(event) =>
                    setManualGroceryInput((current) => ({ ...current, unit: event.target.value }))
                  }
                />
              </label>
              <label>
                Category
                <input
                  type="text"
                  placeholder="Produce, Dairy..."
                  value={manualGroceryInput.category}
                  onChange={(event) =>
                    setManualGroceryInput((current) => ({ ...current, category: event.target.value }))
                  }
                />
              </label>
              <button type="submit" className="primary-button">
                Add Item
              </button>
            </form>
            <div className="accordion-stack">
              {Object.entries(filteredGroceryGroups).length ? (
                Object.entries(filteredGroceryGroups).map(([category, items]) => (
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
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleRemoveGroceryItem(item)}
                            >
                              Remove
                            </button>
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
                . never stores secret keys in the browser. AI narration runs through the
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
                . is not medical advice. Low-FODMAP guidance is portion-sensitive and this
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
              <p className="helper">
                Recipe provider uses TheMealDB test key "1" for development/education only.
                Public app-store release needs a supporter key per TheMealDB docs.
              </p>
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
            <div className="card">
              <h3>Data Portability</h3>
              <p className="helper">Export, import, or reset local v2 data for the current user.</p>
              <div className="secondary-actions">
                <button type="button" className="ghost" onClick={handleExportData}>
                  Export data
                </button>
                <button type="button" className="ghost" onClick={handleImportDataClick}>
                  Import data
                </button>
                <button type="button" className="ghost" onClick={handleResetLocalData}>
                  Reset local data
                </button>
              </div>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportDataFile}
                style={{ display: "none" }}
              />
            </div>

            <button type="button" className="ghost" onClick={handleResetDefaults}>
              Reset to Defaults
            </button>

            {settings.featureFlags.enablePantryTracking ? (
              <div className="card">
                <h3>Pantry</h3>
                <p>Track pantry items for pantry-first planning.</p>
                <div className="form-grid">
                  <label>
                    Add by barcode (Open Food Facts)
                    <input
                      type="text"
                      value={pantryBarcode}
                      onChange={(event) => setPantryBarcode(event.target.value)}
                      placeholder="e.g. 3017620422003"
                    />
                  </label>
                  <button type="button" className="ghost" onClick={handleLookupPantryBarcode}>
                    Lookup barcode
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Add generic ingredient (USDA FDC)
                    <input
                      type="text"
                      value={pantryIngredientQuery}
                      onChange={(event) => setPantryIngredientQuery(event.target.value)}
                      placeholder="e.g. rolled oats"
                    />
                  </label>
                  <button type="button" className="ghost" onClick={handleSearchPantryIngredient}>
                    Search USDA
                  </button>
                </div>
                {pantryIngredientHits.length ? (
                  <div className="chip-row">
                    {pantryIngredientHits.map((hit) => (
                      <button
                        key={`fdc-hit-${hit.id}`}
                        type="button"
                        className="chip"
                        onClick={() => handleAddPantryIngredientHit(hit)}
                      >
                        {hit.name}
                      </button>
                    ))}
                  </div>
                ) : null}
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
                    Barcode (optional)
                    <input
                      type="text"
                      value={pantryInput.barcode || ""}
                      onChange={(event) =>
                        setPantryInput((current) => ({ ...current, barcode: event.target.value }))
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
            <span className="nav-icon-glyph" aria-hidden="true">
              {NAV_ICONS[view] || "•"}
            </span>
            <span className="nav-label">{VIEW_LABELS[view]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
