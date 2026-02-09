import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const SETTINGS_STORAGE_KEY = "phasefuel.settings.v1";
const SETTINGS_VERSION = 1;

/**
 * @typedef {Object} FeatureFlags
 * @property {boolean} enablePantryTracking
 * @property {boolean} enableLeftoverFatiguePrevention
 * @property {boolean} enableBatchDay
 * @property {boolean} enableFreezerTags
 * @property {boolean} enableBudgetOptimizer
 * @property {boolean} enableUseWhatYouHaveMode
 */

/**
 * @typedef {Object} CyclePreferences
 * @property {string} lastPeriodStart
 * @property {number} cycleLength
 * @property {number} lutealLength
 */

/**
 * @typedef {Object} PhaseFuelSettings
 * @property {number} version
 * @property {FeatureFlags} featureFlags
 * @property {boolean} preferLeftoverLunch
 * @property {boolean} preferBatchCooking
 * @property {boolean} showOccultReadingLayer
 * @property {CyclePreferences} cyclePreferences
 * @property {string} batchDayOfWeek
 * @property {number} batchTimeBudgetMin
 * @property {number | null} weeklyBudget
 * @property {"tight" | "normal" | "generous"} costMode
 */

/** @type {PhaseFuelSettings} */
const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  featureFlags: {
    enablePantryTracking: false,
    enableLeftoverFatiguePrevention: false,
    enableBatchDay: false,
    enableFreezerTags: false,
    enableBudgetOptimizer: false,
    enableUseWhatYouHaveMode: false,
  },
  preferLeftoverLunch: true,
  preferBatchCooking: true,
  showOccultReadingLayer: true,
  cyclePreferences: {
    lastPeriodStart: "",
    cycleLength: 28,
    lutealLength: 14,
  },
  batchDayOfWeek: "Sunday",
  batchTimeBudgetMin: 90,
  weeklyBudget: null,
  costMode: "normal",
};

const coerceBoolean = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const coerceNumber = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const normalizeCyclePreferences = (prefs = {}) => ({
  lastPeriodStart:
    typeof prefs.lastPeriodStart === "string" ? prefs.lastPeriodStart : "",
  cycleLength: coerceNumber(prefs.cycleLength, DEFAULT_SETTINGS.cyclePreferences.cycleLength),
  lutealLength: coerceNumber(prefs.lutealLength, DEFAULT_SETTINGS.cyclePreferences.lutealLength),
});

const normalizeFeatureFlags = (flags = {}) => ({
  enablePantryTracking: coerceBoolean(
    flags.enablePantryTracking,
    DEFAULT_SETTINGS.featureFlags.enablePantryTracking
  ),
  enableLeftoverFatiguePrevention: coerceBoolean(
    flags.enableLeftoverFatiguePrevention,
    DEFAULT_SETTINGS.featureFlags.enableLeftoverFatiguePrevention
  ),
  enableBatchDay: coerceBoolean(flags.enableBatchDay, DEFAULT_SETTINGS.featureFlags.enableBatchDay),
  enableFreezerTags: coerceBoolean(
    flags.enableFreezerTags,
    DEFAULT_SETTINGS.featureFlags.enableFreezerTags
  ),
  enableBudgetOptimizer: coerceBoolean(
    flags.enableBudgetOptimizer,
    DEFAULT_SETTINGS.featureFlags.enableBudgetOptimizer
  ),
  enableUseWhatYouHaveMode: coerceBoolean(
    flags.enableUseWhatYouHaveMode,
    DEFAULT_SETTINGS.featureFlags.enableUseWhatYouHaveMode
  ),
});

const normalizeSettings = (candidate) => {
  if (!candidate || typeof candidate !== "object") {
    return DEFAULT_SETTINGS;
  }
  if (candidate.version !== SETTINGS_VERSION) {
    return DEFAULT_SETTINGS;
  }

  return {
    version: SETTINGS_VERSION,
    featureFlags: normalizeFeatureFlags(candidate.featureFlags),
    preferLeftoverLunch: coerceBoolean(
      candidate.preferLeftoverLunch,
      DEFAULT_SETTINGS.preferLeftoverLunch
    ),
    preferBatchCooking: coerceBoolean(
      candidate.preferBatchCooking,
      DEFAULT_SETTINGS.preferBatchCooking
    ),
    showOccultReadingLayer: coerceBoolean(
      candidate.showOccultReadingLayer,
      DEFAULT_SETTINGS.showOccultReadingLayer
    ),
    cyclePreferences: normalizeCyclePreferences(candidate.cyclePreferences),
    batchDayOfWeek:
      typeof candidate.batchDayOfWeek === "string"
        ? candidate.batchDayOfWeek
        : DEFAULT_SETTINGS.batchDayOfWeek,
    batchTimeBudgetMin: coerceNumber(
      candidate.batchTimeBudgetMin,
      DEFAULT_SETTINGS.batchTimeBudgetMin
    ),
    weeklyBudget:
      typeof candidate.weeklyBudget === "number" ? candidate.weeklyBudget : null,
    costMode:
      candidate.costMode === "tight" ||
      candidate.costMode === "normal" ||
      candidate.costMode === "generous"
        ? candidate.costMode
        : DEFAULT_SETTINGS.costMode,
  };
};

const loadSettings = () => {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(stored);
    return normalizeSettings(parsed);
  } catch (error) {
    return DEFAULT_SETTINGS;
  }
};

const saveSettings = (settings) => {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

const mergeSettings = (current, patch) => {
  const nextFeatureFlags = patch?.featureFlags
    ? { ...current.featureFlags, ...patch.featureFlags }
    : current.featureFlags;
  const nextCyclePreferences = patch?.cyclePreferences
    ? { ...current.cyclePreferences, ...patch.cyclePreferences }
    : current.cyclePreferences;

  return normalizeSettings({
    ...current,
    ...patch,
    featureFlags: nextFeatureFlags,
    cyclePreferences: nextCyclePreferences,
  });
};

const SettingsContext = createContext(null);

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(() => loadSettings());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((patch) => {
    setSettings((current) => mergeSettings(current, patch));
  }, []);

  const value = useMemo(
    () => ({
      settings,
      setSettings,
      updateSettings,
    }),
    [settings, updateSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
};

export { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY };
