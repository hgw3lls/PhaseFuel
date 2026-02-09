import { useEffect, useMemo, useState } from "react";
import { useSettings, DEFAULT_SETTINGS } from "./settings.jsx";
import { calculateCyclePhase } from "./cycleCalculator.js";
import { getMoonPhase } from "./moonPhase.js";
import { normalizePlannerResponse, validatePlannerResponse } from "./mealPlan.js";
import { buildPlannerPrompt } from "./prompts/plannerPrompt.js";
import { buildReadingPrompt } from "./prompts/readingPrompt.js";
import {
  adjustGroceryListForPantry,
  loadPantry,
  removePantryItem,
  savePantry,
  summarizePantry,
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
  summarizePrices,
  upsertPriceItem,
} from "./modules/priceMemory.js";
import { loadHistory, MAX_HISTORY, saveHistory, updateHistory } from "./modules/leftoverHistory.js";

const STORAGE_KEY = "phasefuel_api_key";
const PLAN_STORAGE_KEY = "phasefuel_meal_plans";
const GROCERY_CHECK_KEY = "phasefuel_grocery_checks";

const TRANSFORMATION_LIBRARY = [
  "wrap",
  "bowl",
  "salad",
  "soup remix",
  "fried rice",
  "quesadilla",
  "pasta toss",
  "frittata",
];

const VIEW_LABELS = {
  today: "Period",
  plan: "PLAN",
  grocery: "GROCERY",
  profile: "Profile",
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

const buildPrompt = (cycleDay, symptoms, settings) => {
  const preferences = [];
  const features = [];

  if (settings.preferLeftoverLunch) {
    preferences.push("Prefer leftover-based lunches where possible.");
  }
  if (settings.preferBatchCooking) {
    preferences.push("Favor batch cooking and reusable components.");
  }
  if (settings.showOccultReadingLayer) {
    preferences.push("Include a short occult-themed reading layer for each day.");
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

  return [
    `Generate a healthy meal plan for cycle day ${cycleDay} with symptoms: ${symptoms}.`,
    preferences.length ? `Preferences: ${preferences.join(" ")}` : "",
    features.length ? `Advanced features: ${features.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const requestOpenAi = async ({ apiKey, temperature, messages }) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      temperature,
      messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error?.message || response.statusText;
    throw new Error(message);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
};

const requestMealPlan = async ({ apiKey, cycleDay, symptoms, settings }) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: buildPrompt(cycleDay, symptoms, settings),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error?.message || response.statusText;
    throw new Error(message);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
};

const requestPlanner = async (params) =>
  requestOpenAi({
    apiKey: params.apiKey,
    temperature: 0.4,
    messages: [
      {
        role: "user",
        content: buildPlannerPrompt(params),
      },
    ],
  });

const requestReading = async ({ apiKey, plannerJson, cycleInfo, moonInfo }) =>
  requestOpenAi({
    apiKey,
    temperature: 0.7,
    messages: [
      {
        role: "user",
        content: buildReadingPrompt({ plannerJson, cycleInfo, moonInfo }),
      },
    ],
  });

const formatFlowLabel = (day) => `Day ${day}`;

const buildFlowMap = (plan) => {
  const map = new Map();
  if (!plan?.leftoversGraph) {
    return map;
  }
  plan.leftoversGraph.forEach((link) => {
    const fromDay = link.fromDayIndex ?? link.fromDay;
    const toDay = link.toDayIndex ?? link.toDay;
    if (typeof fromDay === "number" && typeof toDay === "number") {
      map.set(fromDay, toDay);
    }
  });
  return map;
};

const formatPhase = (value) => (value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Unknown");

const formatMoon = (moonInfo) => moonInfo?.name || "New Moon";

const buildWeekdayLabels = (count) => {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(today);
    next.setDate(today.getDate() + index);
    return next.toLocaleDateString(undefined, { weekday: "short" });
  });
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

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [userId, setUserId] = useState("");
  const [cycleDay, setCycleDay] = useState("");
  const [symptoms, setSymptoms] = useState("");
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
  const [plannerRaw, setPlannerRaw] = useState("No plan generated yet.");
  const [plannerData, setPlannerData] = useState(null);
  const [plannerError, setPlannerError] = useState("");
  const [groceryList, setGroceryList] = useState([]);
  const [prepSteps, setPrepSteps] = useState([]);
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [occultReading, setOccultReading] = useState("No occult reading yet.");
  const [lookupUserId, setLookupUserId] = useState("");
  const [savedPlan, setSavedPlan] = useState("No saved plan loaded.");
  const [isLoading, setIsLoading] = useState(false);
  const [useWhatYouHaveOverride, setUseWhatYouHaveOverride] = useState(false);
  const [activeView, setActiveView] = useState("today");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activePlanDay, setActivePlanDay] = useState(null);
  const [groceryChecks, setGroceryChecks] = useState(() => getStoredChecks());
  const { settings, setSettings, updateSettings } = useSettings();

  const plansByUser = useMemo(() => getStoredPlans(), [plannerData, savedPlan]);
  const mealPlan = plannerData?.mealPlan || null;
  const flowMap = useMemo(() => buildFlowMap(mealPlan), [mealPlan]);
  const pantryFirst = settings.featureFlags.enableUseWhatYouHaveMode || useWhatYouHaveOverride;
  const cycleInfo = useMemo(
    () => calculateCyclePhase(new Date(), settings.cyclePreferences),
    [settings.cyclePreferences]
  );
  const moonInfo = useMemo(() => getMoonPhase(new Date()), []);

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
    if (mealPlan?.days?.length) {
      setActivePlanDay((current) => current ?? mealPlan.days[0].day);
    }
  }, [mealPlan]);

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

  const handleSaveKey = () => {
    if (!apiKey.trim()) {
      setStatus("Enter an API key before saving.");
      return;
    }
    localStorage.setItem(STORAGE_KEY, apiKey.trim());
    setStatus("API key saved locally.");
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
    if (!apiKey.trim()) {
      setStatus("Please enter your OpenAI API key.");
      return;
    }
    if (!userId.trim()) {
      setStatus("Please enter a user ID.");
      return;
    }
    setIsLoading(true);
    setGenerationState("generating");
    setStatus("Generating meal plan...");
    setPlannerError("");

    const useWhatYouHaveMode =
      settings.featureFlags.enableUseWhatYouHaveMode || useWhatYouHaveOverride;
    const pantrySummary = summarizePantry(pantryItems);
    const priceSummary = summarizePrices(priceItems);

    try {
      const responsePlan = await requestPlanner({
        apiKey: apiKey.trim(),
        cycleDay: cycleDay.trim(),
        symptoms: symptoms.trim(),
        settings,
        cycleInfo,
        moonInfo,
        pantryItems: pantrySummary,
        budgetNotes: budgetNotes.trim(),
        priceMemory: priceSummary,
        history: historyItems,
        transformationLibrary: TRANSFORMATION_LIBRARY,
        useWhatYouHaveMode,
      });
      setPlannerRaw(responsePlan || "No plan returned.");

      let parsedPlan;
      try {
        parsedPlan = JSON.parse(responsePlan);
      } catch (error) {
        setPlannerData(null);
        setGroceryList([]);
        setPrepSteps([]);
        setEstimatedCost(null);
        setPlannerError("The planner returned invalid JSON. Please retry generation.");
        setStatus("Meal plan failed validation.");
        setGenerationState("error");
        return;
      }

      const normalizedPlan = normalizePlannerResponse(parsedPlan);
      const validation = validatePlannerResponse(normalizedPlan);
      if (!validation.ok) {
        setPlannerData(null);
        setGroceryList([]);
        setPrepSteps([]);
        setEstimatedCost(null);
        setPlannerError(`Plan schema errors: ${validation.errors.join(" ")}`);
        setStatus("Meal plan failed validation.");
        setGenerationState("error");
        return;
      }

      const nextGrocery = useWhatYouHaveMode
        ? adjustGroceryListForPantry(normalizedPlan.groceryList.items, pantryItems)
        : normalizedPlan.groceryList.items;

      setPlannerData(normalizedPlan);
      setGroceryList(nextGrocery);
      setPrepSteps(normalizedPlan.prepSteps);
      setEstimatedCost(normalizedPlan.estimatedCost || null);
      setGenerationState("success");

      if (settings.featureFlags.enableLeftoverFatiguePrevention) {
        const transformations = parsedPlan.mealPlan.days.flatMap(
          (day) => day.meals.dinner.transformationOptions || []
        );
        setHistoryItems((current) => updateHistory(current, transformations));
      }

      let occultText = null;
      if (settings.showOccultReadingLayer) {
        try {
          occultText = await requestReading({
            apiKey: apiKey.trim(),
            plannerJson: JSON.stringify(parsedPlan, null, 2),
            cycleInfo,
            moonInfo,
          });
        } catch (error) {
          occultText = "Occult reading unavailable.";
        }
        setOccultReading(occultText || "No occult reading returned.");
      }

      const updatedPlans = {
        ...plansByUser,
        [userId.trim()]: {
          cycle_day: Number(cycleDay),
          symptoms: symptoms.trim(),
          meal_plan: responsePlan,
          settings_snapshot: settings,
        },
      };
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(updatedPlans));
      setStatus("Meal plan saved locally.");
    } catch (error) {
      setStatus(`Failed to generate plan: ${error.message}`);
      setGenerationState("error");
    } finally {
      setIsLoading(false);
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
      key: "showOccultReadingLayer",
      label: "Show occult reading layer",
      description: "Add the mystical narrative overlay in outputs.",
      value: settings.showOccultReadingLayer,
      onChange: () =>
        updateSettings({ showOccultReadingLayer: !settings.showOccultReadingLayer }),
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

  const weekdayLabels = buildWeekdayLabels(mealPlan?.days?.length || 7);
  const dayChips = (mealPlan?.days || Array.from({ length: 7 }, (_, index) => ({ day: index + 1 })))
    .map((day, index) => ({
      label: weekdayLabels[index] || `Day ${day.day}`,
      value: day.day,
    }));

  const activeDayData = mealPlan?.days?.find((day) => day.day === activePlanDay) || null;
  const leftoverCards = mealPlan?.leftoversGraph?.length
    ? mealPlan.leftoversGraph.map((link) => {
        const fromDay = link.fromDayIndex ?? link.fromDay;
        const toDay = link.toDayIndex ?? link.toDay;
        const from = mealPlan.days.find((day) => day.day === fromDay);
        const transformList = from?.meals?.dinner?.transformationOptions || [];
        return {
          key: `${fromDay}-${toDay}`,
          title: "DINNER • LUNCH",
          transform: transformList.length ? transformList.join(" / ") : "Bowl / Wrap / Salad",
          time: "5 min",
        };
      })
    : [
        { key: "placeholder-1", title: "DINNER • LUNCH", transform: "Bowl / Wrap / Salad", time: "5 min" },
        { key: "placeholder-2", title: "DINNER • LUNCH", transform: "Soup Remix / Fried Rice", time: "10 min" },
      ];

  const groceryGroups = groupGroceries(groceryList);
  const groceryCount = groceryList.length;
  const groceryTotals = plannerData?.groceryList?.totals || null;

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
                Day {(cycleInfo.dayInCycle ?? cycleDay) || "--"} • {formatPhase(cycleInfo.phase)} • {formatMoon(moonInfo)}
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
                <button type="submit" className="primary-button" disabled={isLoading}>
                  {isLoading ? "Generating..." : "Generate Plan"}
                </button>
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
              <summary>READING</summary>
              <div className="accordion-body">
                {settings.showOccultReadingLayer ? (
                  <pre>{occultReading}</pre>
                ) : (
                  <p>Enable the occult layer in Settings to unlock today&apos;s reading.</p>
                )}
              </div>
            </details>
          </section>
        ) : null}

        {activeView === "plan" ? (
          <section className="screen">
            <div className="section-header">
              <h2>PLAN</h2>
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
            <div className="plan-section">
              <h3>{activeDayData ? `Day ${activeDayData.day}` : "Wednesday"}</h3>
              <details className="accordion">
                <summary>Breakfast</summary>
                <div className="accordion-body">
                  {activeDayData?.meals?.breakfast ? (
                    <div>
                      <strong>{activeDayData.meals.breakfast.name}</strong>
                      <p>{activeDayData.meals.breakfast.ingredients.join(", ")}</p>
                    </div>
                  ) : (
                    <p>Steel-cut oats with berries and almond butter.</p>
                  )}
                </div>
              </details>
              <details className="accordion">
                <summary>Lunch</summary>
                <div className="accordion-body">
                  {activeDayData?.meals?.lunch ? (
                    <div>
                      <strong>{activeDayData.meals.lunch.name}</strong>
                      <p>{activeDayData.meals.lunch.ingredients.join(", ")}</p>
                    </div>
                  ) : (
                    <p>Leftover roasted veg bowl with tahini drizzle.</p>
                  )}
                </div>
              </details>
            </div>

            <div className="leftover-stack">
              {leftoverCards.map((card) => (
                <div className="transform-card" key={card.key}>
                  <span className="card-kicker">{card.title}</span>
                  <div className="card-main">Transform: {card.transform}</div>
                  <div className="card-meta">{card.time}</div>
                </div>
              ))}
            </div>

            <div className="plan-section">
              <h3>Thursday</h3>
              <div className="meal-card">
                <div>
                  <h4>{activeDayData?.meals?.dinner?.name || "Roasted Veggie Tray Bake"}</h4>
                  <div className="tag-row">
                    <span className="tag">{formatPhase(cycleInfo.phase)} phase</span>
                    <span className="tag">batch-tag</span>
                  </div>
                  <p>
                    {activeDayData?.meals?.dinner?.ingredients?.join(", ") ||
                      "Broccoli, sweet potato, chickpeas, olive oil."}
                  </p>
                </div>
                <div className="card-actions">
                  <button type="button" className="ghost">
                    Swap
                  </button>
                  <button type="button" className="ghost">
                    Mark Cooked
                  </button>
                  <button type="button" className="ghost">
                    Add to Grocery
                  </button>
                </div>
              </div>
            </div>

            {mealPlan ? (
              <div className="plan-flow">
                <h3>Leftover Flow</h3>
                <div className="flow-list">
                  {mealPlan.days.map((day) => {
                    const nextDay = flowMap.get(day.day);
                    return (
                      <div className="flow-card" key={day.day}>
                        <div className="flow-header">{formatFlowLabel(day.day)}</div>
                        <div className="flow-row">
                          <div>
                            <span className="flow-title">Dinner</span>
                            <div>{day.meals.dinner.name}</div>
                            <div className="flow-meta">Batch tag: {day.meals.dinner.batchTag}</div>
                            <div className="flow-meta">
                              Leftovers: {day.meals.dinner.leftoverPortions} portion(s)
                            </div>
                            <div className="flow-meta">
                              Transformations: {day.meals.dinner.transformationOptions.join(", ")}
                            </div>
                          </div>
                          <div className="flow-arrow">→</div>
                          <div>
                            <span className="flow-title">Lunch</span>
                            <div>
                              {nextDay ? `${formatFlowLabel(nextDay)} lunch` : "No linked lunch"}
                            </div>
                            {nextDay ? (
                              <div className="flow-meta">
                                {mealPlan.days.find((planDay) => planDay.day === nextDay)?.meals
                                  .lunch.name}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
              <p className="muted">Manage your API vault and saved plan archive.</p>
            </div>
            <div className="card">
              <h3>API Vault</h3>
              <p>Paste your OpenAI API key. It never leaves this browser.</p>
              <label>
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-..."
                />
              </label>
              <button type="button" className="primary-button" onClick={handleSaveKey}>
                Save Key
              </button>
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
