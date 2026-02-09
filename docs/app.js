const STORAGE_KEY = "phasefuel_api_key";
const PLAN_STORAGE_KEY = "phasefuel_meal_plans";

const apiKeyInput = document.getElementById("apiKey");
const saveKeyButton = document.getElementById("saveKey");
const form = document.getElementById("mealForm");
const statusEl = document.getElementById("status");
const planOutput = document.getElementById("planOutput");
const lookupUserId = document.getElementById("lookupUserId");
const loadPlanButton = document.getElementById("loadPlan");
const clearPlanButton = document.getElementById("clearPlan");
const savedOutput = document.getElementById("savedOutput");

const getStoredPlans = () => {
  const raw = localStorage.getItem(PLAN_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const setStatus = (message, isError = false) => {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b3261e" : "#5a616d";
};

const saveApiKey = () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus("Enter an API key before saving.", true);
    return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  setStatus("API key saved locally.");
};

const loadApiKey = () => {
  const storedKey = localStorage.getItem(STORAGE_KEY);
  if (storedKey) {
    apiKeyInput.value = storedKey;
  }
};

const savePlan = (userId, payload) => {
  const plans = getStoredPlans();
  plans[userId] = payload;
  localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
};

const renderPlan = (planText) => {
  planOutput.textContent = planText || "No plan generated yet.";
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

saveKeyButton.addEventListener("click", saveApiKey);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Generating meal plan...");

  const apiKey = apiKeyInput.value.trim();
  const userId = document.getElementById("userId").value.trim();
  const cycleDay = document.getElementById("cycleDay").value.trim();
  const symptoms = document.getElementById("symptoms").value.trim();

  if (!apiKey) {
    setStatus("Please enter your OpenAI API key.", true);
    return;
  }

  try {
    const plan = await requestMealPlan({ apiKey, cycleDay, symptoms });
    renderPlan(plan);
    savePlan(userId, { cycle_day: Number(cycleDay), symptoms, meal_plan: plan });
    setStatus("Meal plan saved locally.");
  } catch (error) {
    setStatus(`Failed to generate plan: ${error.message}`, true);
  }
});

loadPlanButton.addEventListener("click", () => {
  const userId = lookupUserId.value.trim();
  if (!userId) {
    savedOutput.textContent = "Enter a user ID to load a saved plan.";
    return;
  }
  const plans = getStoredPlans();
  const plan = plans[userId];
  if (!plan) {
    savedOutput.textContent = `No saved plan found for ${userId}.`;
    return;
  }
  savedOutput.textContent = JSON.stringify(plan, null, 2);
});

clearPlanButton.addEventListener("click", () => {
  const userId = lookupUserId.value.trim();
  if (!userId) {
    savedOutput.textContent = "Enter a user ID to clear a saved plan.";
    return;
  }
  const plans = getStoredPlans();
  if (plans[userId]) {
    delete plans[userId];
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
    savedOutput.textContent = `Cleared saved plan for ${userId}.`;
  } else {
    savedOutput.textContent = `No saved plan found for ${userId}.`;
  }
});

loadApiKey();
