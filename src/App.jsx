import { useEffect, useMemo, useState } from "react";
import { useSettings, DEFAULT_SETTINGS } from "./settings.jsx";
import { calculateCyclePhase } from "./cycleCalculator.js";
import { getMoonPhase } from "./moonPhase.js";
import { validatePlannerResponse } from "./mealPlan.js";
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

const getStoredPlans = () => {
  const raw = localStorage.getItem(PLAN_STORAGE_KEY);
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

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [userId, setUserId] = useState("");
  const [cycleDay, setCycleDay] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [pantryItems, setPantryItems] = useState(() => loadPantry());
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

      const validation = validatePlannerResponse(parsedPlan);
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
        ? adjustGroceryListForPantry(parsedPlan.groceryList.items, pantryItems)
        : parsedPlan.groceryList.items;

      setPlannerData(parsedPlan);
      setGroceryList(nextGrocery);
      setPrepSteps(parsedPlan.prepSteps);
      setEstimatedCost(parsedPlan.estimatedCost || null);
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

  return (
    <div className="page">
      <header className="banner">
        <div>
          <p className="tag">PhaseFuel</p>
          <h1>Brutalist Cycle Meal Planner</h1>
          <p className="subhead">
            A stark, high-contrast control panel for generating cycle-aware meal plans and
            saving them locally.
          </p>
          <nav className="nav">
            <a href="#api-vault">API Vault</a>
            <a href="#generator">Generator</a>
            <a href="#settings">Settings</a>
            <a href="#saved-plans">Saved Plans</a>
          </nav>
        </div>
        <div className="stats">
          <div>
            <span>Total Saved</span>
            <strong>{Object.keys(plansByUser).length}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{isLoading ? "Working" : "Idle"}</strong>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="panel" id="api-vault">
          <h2>API Vault</h2>
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
          <button type="button" onClick={handleSaveKey}>
            Save Key
          </button>
        </section>

        <section className="panel wide" id="generator">
          <h2>Plan Generator</h2>
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
            {settings.featureFlags.enablePantryTracking ? (
              <div className="inline-note">
                Pantry items: {summarizePantry(pantryItems) || "None added yet."}
              </div>
            ) : null}
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
            <div className="button-row">
              <button type="submit" disabled={isLoading}>
                {isLoading ? "Generating..." : "Generate Plan"}
              </button>
              {settings.featureFlags.enableUseWhatYouHaveMode ||
              settings.featureFlags.enablePantryTracking ? (
                <button type="button" className="ghost" onClick={handleUseWhatYouHave}>
                  Use What You Have (This Run)
                </button>
              ) : null}
            </div>
          </form>
          <div className={`status-pill ${generationState}`}>State: {generationState}</div>
          {pantryFirst ? <div className="toggle-pill">Pantry-first plan</div> : null}
          <div className="status">{status}</div>
          {plannerError ? (
            <div className="status error">
              {plannerError}
              <button type="button" className="ghost" onClick={generatePlan}>
                Retry Generation
              </button>
            </div>
          ) : null}
          {mealPlan ? (
            <div className="output">
              <h3>Meal Plan Flow</h3>
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
                          <div className="flow-meta">
                            Batch tag: {day.meals.dinner.batchTag}
                          </div>
                          <div className="flow-meta">
                            Servings cooked: {day.meals.dinner.servingsCooked}
                          </div>
                          <div className="flow-meta">
                            Leftovers: {day.meals.dinner.leftoverPortions} portion(s)
                          </div>
                          <div className="flow-meta">
                            Transformations: {day.meals.dinner.transformationOptions.join(", ")}
                          </div>
                          {settings.featureFlags.enableFreezerTags &&
                          day.meals.dinner.freezeFriendly ? (
                            <div className="freeze-pill">
                              Freeze {day.meals.dinner.freezePortions || 0} portion(s)
                            </div>
                          ) : null}
                        </div>
                        <div className="flow-arrow">→</div>
                        <div>
                          <span className="flow-title">Lunch</span>
                          <div>
                            {nextDay ? `${formatFlowLabel(nextDay)} lunch` : "No linked lunch"}
                          </div>
                          {nextDay ? (
                            <div className="flow-meta">
                              {mealPlan.days.find((planDay) => planDay.day === nextDay)?.meals.lunch
                                .name}
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
            <div className="output">
              <h3>Latest Planner Output</h3>
              <pre>{plannerRaw}</pre>
            </div>
          )}
        </section>

        {plannerData ? (
          <section className="panel">
            <h2>Grocery List</h2>
            <p>Planner-generated list with quantities and categories.</p>
            <ul className="grocery-list">
              {groceryList.map((item) => (
                <li key={`${item.name}-${item.category}`}>
                  <span className="grocery-item">{item.name}</span>
                  <span className="grocery-count">
                    {item.qty} {item.unit}
                  </span>
                  <span className="grocery-meta">{item.category}</span>
                  {item.substitutions?.length ? (
                    <span className="grocery-meta">
                      Swaps: {item.substitutions.join(" • ")}
                    </span>
                  ) : null}
                  {item.notes?.length ? (
                    <span className="grocery-meta">Notes: {item.notes.join(" • ")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {plannerData.groceryList.totals ? (
              <div className="cost-block">
                Estimated totals: {plannerData.groceryList.totals.estMin} -
                {` ${plannerData.groceryList.totals.estMax}`}
              </div>
            ) : null}
            <div className="prep-block">
              <h3>Prep Steps</h3>
              <ol>
                {prepSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            {estimatedCost ? (
              <div className="cost-block">
                Estimated Cost: {estimatedCost.currency} {estimatedCost.min} -
                {` ${estimatedCost.max}`}
              </div>
            ) : null}
            {settings.featureFlags.enableBatchDay ? (
              <div className="prep-block">
                <h3>Batch Day Checklist</h3>
                <ul>
                  {prepSteps
                    .filter((step) =>
                      step.toLowerCase().includes(settings.batchDayOfWeek.toLowerCase())
                    )
                    .map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                </ul>
              </div>
            ) : null}
            <details className="raw-json">
              <summary>Raw JSON response</summary>
              <pre>{plannerRaw}</pre>
            </details>
          </section>
        ) : null}

        {settings.showOccultReadingLayer ? (
          <section className="panel">
            <h2>Occult Reading Layer</h2>
            <p>
              The oracle is active. Your plans will include a mystical layer that maps
              cravings to cycle energy.
            </p>
            <div className="toggle-pill">Status: Enabled</div>
            <div className="output">
              <h3>Today&apos;s Reading</h3>
              <pre>{occultReading}</pre>
            </div>
          </section>
        ) : null}

        {settings.featureFlags.enablePantryTracking ? (
          <section className="panel" id="pantry">
            <h2>Pantry</h2>
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
                    setPantryInput((current) => ({ ...current, expiresOn: event.target.value }))
                  }
                />
              </label>
              <button type="submit">Add/Update Pantry Item</button>
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
                    onClick={() =>
                      setPantryItems((items) => removePantryItem(items, item.name))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {settings.featureFlags.enableFreezerTags ? (
          <section className="panel" id="freezer">
            <h2>Freezer Inventory</h2>
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
              <button type="submit">Add to Freezer</button>
            </form>
            <ul className="inventory-list">
              {freezerItems.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <span>{item.name}</span>
                  <span>{item.portions ? `${item.portions} portions` : ""}</span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      setFreezerItems((items) => removeFreezerItem(items, index))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {settings.featureFlags.enableBudgetOptimizer ? (
          <section className="panel" id="prices">
            <h2>Price Memory</h2>
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
              <button type="submit">Add/Update Price</button>
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
                    onClick={() =>
                      setPriceItems((items) => removePriceItem(items, item.name))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {settings.weeklyBudget ? (
              <div className="cost-block">Weekly budget: {settings.weeklyBudget}</div>
            ) : null}
          </section>
        ) : null}

        {settings.featureFlags.enableLeftoverFatiguePrevention ? (
          <section className="panel">
            <h2>Leftover Rotation</h2>
            <p>Recent transformations (avoids repetition).</p>
            <div className="history-list">
              {historyItems.length
                ? historyItems.map((item) => <span key={item}>{item}</span>)
                : "No history yet."}
            </div>
            <div className="history-meta">Tracking last {MAX_HISTORY} transformations.</div>
          </section>
        ) : null}

        <section className="panel" id="settings">
          <h2>Settings</h2>
          <p>Toggle core preferences and experimental feature flags.</p>
          <div className="toggle-group">
            <h3>Core Preferences</h3>
            <div className="toggle-list">
              {coreSettings.map((item) => (
                <label className="toggle-item" key={item.key}>
                  <div>
                    <span className="toggle-label">{item.label}</span>
                    <span className="toggle-description">{item.description}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={item.onChange}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="toggle-group">
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
          <div className="toggle-group">
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
          <div className="toggle-group">
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
        </section>

        {settings.showOccultReadingLayer ? (
          <section className="panel">
            <h2>Occult Reading Layer</h2>
            <p>
              The oracle is active. Your plans will include a mystical layer that maps
              cravings to cycle energy.
            </p>
            <div className="toggle-pill">Status: Enabled</div>
          </section>
        ) : null}

        <section className="panel" id="settings">
          <h2>Settings</h2>
          <p>Toggle core preferences and experimental feature flags.</p>
          <div className="toggle-group">
            <h3>Core Preferences</h3>
            <div className="toggle-list">
              {coreSettings.map((item) => (
                <label className="toggle-item" key={item.key}>
                  <div>
                    <span className="toggle-label">{item.label}</span>
                    <span className="toggle-description">{item.description}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={item.value}
                    onChange={item.onChange}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="toggle-group">
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
        </section>

        <section className="panel" id="saved-plans">
          <h2>Saved Plans</h2>
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
            <button type="button" onClick={handleLoadPlan}>
              Load Plan
            </button>
            <button type="button" className="ghost" onClick={handleClearPlan}>
              Clear Plan
            </button>
          </div>
          <pre className="output">{savedPlan}</pre>
        </section>
      </main>

      <footer>
        Brutalist UI. No server required. Deploy via GitHub Pages.
      </footer>
    </div>
  );
}
