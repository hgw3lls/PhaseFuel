import { planWeek } from "../engine/weekPlanner.js";
import {
  getMigrationFlagKey,
  loadUserData,
  saveUserData,
} from "./storage.js";

const LEGACY_PLAN_MAP_KEY = "phasefuel_meal_plans";
const LEGACY_KEY_PATTERNS = [
  (userId) => `phasefuel_plans_${userId}`,
  (userId) => `phasefuel_plan_${userId}`,
  () => LEGACY_PLAN_MAP_KEY,
];

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const safeJsonParse = (raw, fallback = null) => {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
};

const sanitize = (value) => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const lowered = key.toLowerCase();
      if (lowered.includes("apikey") || lowered.includes("api_key") || lowered.includes("openai")) {
        return acc;
      }
      acc[key] = sanitize(item);
      return acc;
    }, {});
  }
  return value;
};

const mealToLegacy = (meal, fallbackName = "Legacy meal") => {
  if (!meal) return null;
  const raw = sanitize(meal);
  const stable = JSON.stringify(raw);
  return {
    id: `legacy:${hashString(stable)}`,
    name: raw.name || raw.title || raw.recipeName || fallbackName,
    ...raw,
  };
};

const mapLegacyDay = (legacyDay, fallbackDay) => {
  const rawMeals = legacyDay?.meals || {};
  const notes = [legacyDay?.notes, legacyDay?.note, legacyDay?.text].filter(Boolean).join("\n").trim();
  const breakfast = mealToLegacy(rawMeals.breakfast || legacyDay?.breakfast, "Legacy breakfast");
  const lunch = mealToLegacy(rawMeals.lunch || legacyDay?.lunch, "Legacy lunch");
  const dinner = mealToLegacy(rawMeals.dinner || legacyDay?.dinner, "Legacy dinner");
  const snackLegacy = rawMeals.snack || rawMeals.snacks || legacyDay?.snack || legacyDay?.snacks;
  const snacks = Array.isArray(snackLegacy)
    ? snackLegacy.map((item) => mealToLegacy(item, "Legacy snack")).filter(Boolean)
    : [mealToLegacy(snackLegacy, "Legacy snack")].filter(Boolean);

  const hasLegacyMeals = Boolean(breakfast || lunch || dinner || snacks.length);

  return {
    date: legacyDay?.dateISO || legacyDay?.date || fallbackDay.date,
    phase: legacyDay?.phase || fallbackDay.phase,
    moonPhase: fallbackDay.moonPhase,
    macroRanges: fallbackDay.macroRanges,
    emphasis: fallbackDay.emphasis,
    meals: {
      breakfast: breakfast || fallbackDay.meals.breakfast,
      lunch: lunch || fallbackDay.meals.lunch,
      dinner: dinner || fallbackDay.meals.dinner,
      snacks: snacks.length ? snacks : fallbackDay.meals.snacks,
    },
    prepTasks: Array.isArray(legacyDay?.prepTasks) ? legacyDay.prepTasks : fallbackDay.prepTasks,
    notes: notes || undefined,
    source: hasLegacyMeals ? "legacy" : "mixed",
  };
};

const toWeekPlanV2 = (userId, legacyPayload = {}) => {
  const startDate =
    legacyPayload?.weekly_plan?.startDateISO ||
    legacyPayload?.weeklyPlan?.startDateISO ||
    legacyPayload?.startDate ||
    new Date().toISOString().slice(0, 10);

  const profile = sanitize({
    cycleDay: legacyPayload?.cycle_day ?? null,
    symptoms: legacyPayload?.symptoms || "",
    settingsSnapshot: legacyPayload?.settings_snapshot || null,
  });

  const generatedWeek = planWeek(
    {
      lastPeriodStart:
        legacyPayload?.settings_snapshot?.cyclePreferences?.lastPeriodStart ||
        legacyPayload?.weekly_plan?.startDateISO ||
        new Date().toISOString().slice(0, 10),
      cycleLength: legacyPayload?.settings_snapshot?.cyclePreferences?.cycleLength || 28,
      periodLength: legacyPayload?.settings_snapshot?.cyclePreferences?.periodLength || 5,
      ovulationOffset: 14,
      activityLevel: "moderate",
      goal: "maintain",
      appetiteSupport: false,
      enableMoonCadence: true,
      sleepSensitive: false,
      symptoms: {},
    },
    startDate
  );

  const legacyDays =
    legacyPayload?.weekly_plan?.days || legacyPayload?.weeklyPlan?.days || legacyPayload?.days || [];

  const days = generatedWeek.days.map((day, index) =>
    mapLegacyDay(legacyDays[index] || {}, day)
  );

  if (!legacyDays.length && legacyPayload?.text) {
    days[0] = {
      ...days[0],
      notes: String(legacyPayload.text),
      source: "mixed",
    };
  }

  return {
    version: 2,
    userId,
    startDate,
    generatedAt: new Date().toISOString(),
    signals: {
      enableMoonCadence: true,
      sleepSensitive: false,
    },
    days,
    source: legacyDays.length ? "legacy" : "mixed",
    profile,
  };
};

const collectLegacyEntries = (userId) => {
  const entries = [];

  LEGACY_KEY_PATTERNS.forEach((buildKey) => {
    const key = buildKey(userId);
    const parsed = safeJsonParse(localStorage.getItem(key), null);
    if (!parsed) return;

    if (key === LEGACY_PLAN_MAP_KEY && parsed?.[userId]) {
      entries.push(parsed[userId]);
      return;
    }

    if (parsed?.weekly_plan || parsed?.weeklyPlan || parsed?.days || parsed?.text) {
      entries.push(parsed);
    }
  });

  return entries;
};

export const migrateIfNeeded = (userId) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return { migrated: false, reason: "missing-user" };
  }

  const migrationFlagKey = getMigrationFlagKey(normalizedUserId);
  if (localStorage.getItem(migrationFlagKey) === "1") {
    return { migrated: false, reason: "already-migrated" };
  }

  const legacyEntries = collectLegacyEntries(normalizedUserId);
  if (!legacyEntries.length) {
    localStorage.setItem(migrationFlagKey, "1");
    return { migrated: false, reason: "no-legacy-data" };
  }

  const current = loadUserData(normalizedUserId);
  const migratedPlans = legacyEntries.map((entry) => toWeekPlanV2(normalizedUserId, entry));

  saveUserData(normalizedUserId, {
    ...current,
    profile: {
      ...current.profile,
      ...migratedPlans[0]?.profile,
    },
    plans: [...current.plans, ...migratedPlans],
  });

  localStorage.setItem(migrationFlagKey, "1");
  return { migrated: true, count: migratedPlans.length };
};
