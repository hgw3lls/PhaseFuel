import { useMemo, useState } from "react";
import { useSettings } from "./settings.jsx";

const STORAGE_KEY = "phasefuel_api_key";
const PLAN_STORAGE_KEY = "phasefuel_meal_plans";

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

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [userId, setUserId] = useState("");
  const [cycleDay, setCycleDay] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [plan, setPlan] = useState("No plan generated yet.");
  const [lookupUserId, setLookupUserId] = useState("");
  const [savedPlan, setSavedPlan] = useState("No saved plan loaded.");
  const [isLoading, setIsLoading] = useState(false);
  const { settings, updateSettings } = useSettings();

  const plansByUser = useMemo(() => getStoredPlans(), [plan, savedPlan]);

  const handleSaveKey = () => {
    if (!apiKey.trim()) {
      setStatus("Enter an API key before saving.");
      return;
    }
    localStorage.setItem(STORAGE_KEY, apiKey.trim());
    setStatus("API key saved locally.");
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    if (!apiKey.trim()) {
      setStatus("Please enter your OpenAI API key.");
      return;
    }
    if (!userId.trim()) {
      setStatus("Please enter a user ID.");
      return;
    }
    setIsLoading(true);
    setStatus("Generating meal plan...");

    try {
      const responsePlan = await requestMealPlan({
        apiKey: apiKey.trim(),
        cycleDay: cycleDay.trim(),
        symptoms: symptoms.trim(),
        settings,
      });
      setPlan(responsePlan || "No plan returned.");
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
    } finally {
      setIsLoading(false);
    }
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
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Generating..." : "Generate Plan"}
            </button>
          </form>
          <div className="status">{status}</div>
          <div className="output">
            <h3>Latest Meal Plan</h3>
            <pre>{plan}</pre>
          </div>
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
