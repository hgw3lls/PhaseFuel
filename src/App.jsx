import { useMemo, useState } from "react";

const STORAGE_KEY = "phasefuel_api_key";
const PLAN_STORAGE_KEY = "phasefuel_meal_plans";

const getStoredPlans = () => {
  const raw = localStorage.getItem(PLAN_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const buildPrompt = (cycleDay, symptoms) =>
  `Generate a healthy meal plan for cycle day ${cycleDay} with symptoms: ${symptoms}`;

const requestMealPlan = async ({ apiKey, cycleDay, symptoms }) => {
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
          content: buildPrompt(cycleDay, symptoms),
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
      });
      setPlan(responsePlan || "No plan returned.");
      const updatedPlans = {
        ...plansByUser,
        [userId.trim()]: {
          cycle_day: Number(cycleDay),
          symptoms: symptoms.trim(),
          meal_plan: responsePlan,
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
        <section className="panel">
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

        <section className="panel wide">
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

        <section className="panel">
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
