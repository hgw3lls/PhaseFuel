import cycleDefaultsData from "../config/cycleDefaults.v1.json";

const DAY_MS = 24 * 60 * 60 * 1000;

const PHASES = ["menstrual", "follicular", "ovulatory", "luteal"];

const toDate = (value) => (value ? new Date(value) : null);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const DEFAULT_CONFIDENCES = {
  moonOnly: 0.35,
  symptomOnly: 0.3,
  ovulationAwareLuteal: 0.8,
  ovulationAwareWindow: 0.85,
  missingLastPeriod: 0.3,
  menstrual: 0.7,
  follicular: 0.6,
  ovulatory: 0.65,
  luteal: 0.65,
};

const DEFAULTS = {
  typicalCycleLength: 28,
  typicalLutealLength: 14,
  periodLength: 5,
  confidences: DEFAULT_CONFIDENCES,
};

const asNumber = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asConfidences = (value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_CONFIDENCES;
  }
  return {
    moonOnly: asNumber(value.moonOnly, DEFAULT_CONFIDENCES.moonOnly),
    symptomOnly: asNumber(value.symptomOnly, DEFAULT_CONFIDENCES.symptomOnly),
    ovulationAwareLuteal: asNumber(value.ovulationAwareLuteal, DEFAULT_CONFIDENCES.ovulationAwareLuteal),
    ovulationAwareWindow: asNumber(value.ovulationAwareWindow, DEFAULT_CONFIDENCES.ovulationAwareWindow),
    missingLastPeriod: asNumber(value.missingLastPeriod, DEFAULT_CONFIDENCES.missingLastPeriod),
    menstrual: asNumber(value.menstrual, DEFAULT_CONFIDENCES.menstrual),
    follicular: asNumber(value.follicular, DEFAULT_CONFIDENCES.follicular),
    ovulatory: asNumber(value.ovulatory, DEFAULT_CONFIDENCES.ovulatory),
    luteal: asNumber(value.luteal, DEFAULT_CONFIDENCES.luteal),
  };
};

const CYCLE_DEFAULTS = {
  typicalCycleLength: asNumber(cycleDefaultsData?.typicalCycleLength, DEFAULTS.typicalCycleLength),
  typicalLutealLength: asNumber(cycleDefaultsData?.typicalLutealLength, DEFAULTS.typicalLutealLength),
  periodLength: asNumber(cycleDefaultsData?.periodLength, DEFAULTS.periodLength),
  confidences: asConfidences(cycleDefaultsData?.confidences),
};

export const estimatePhase = (dateISO, settings, mode = "period_based") => {
  const date = toDate(dateISO) || new Date();
  const cycleLength = settings?.typicalCycleLength || settings?.cycleLength || CYCLE_DEFAULTS.typicalCycleLength;
  const lutealLength = settings?.typicalLutealLength || settings?.lutealLength || CYCLE_DEFAULTS.typicalLutealLength;
  const periodLength = settings?.periodLength || CYCLE_DEFAULTS.periodLength;

  if (mode === "moon_only") {
    return { phase: "ovulatory", confidence: CYCLE_DEFAULTS.confidences.moonOnly };
  }

  if (mode === "symptom_only") {
    return { phase: "luteal", confidence: CYCLE_DEFAULTS.confidences.symptomOnly };
  }

  if (mode === "ovulation_aware" && settings?.lastOvulation) {
    const lastOvulation = toDate(settings.lastOvulation);
    if (lastOvulation) {
      const diffDays = Math.floor((date - lastOvulation) / DAY_MS);
      if (diffDays >= 0 && diffDays <= lutealLength) {
        return { phase: "luteal", confidence: CYCLE_DEFAULTS.confidences.ovulationAwareLuteal };
      }
      const ovulationWindow = Math.abs(diffDays);
      if (ovulationWindow <= 2) {
        return { phase: "ovulatory", confidence: CYCLE_DEFAULTS.confidences.ovulationAwareWindow };
      }
    }
  }

  const lastPeriodStart = toDate(settings?.lastPeriodStart);
  if (!lastPeriodStart) {
    return { phase: "follicular", confidence: CYCLE_DEFAULTS.confidences.missingLastPeriod };
  }

  const dayInCycle = clamp(Math.floor((date - lastPeriodStart) / DAY_MS) + 1, 1, cycleLength);
  if (dayInCycle <= periodLength) {
    return { phase: PHASES[0], confidence: CYCLE_DEFAULTS.confidences.menstrual };
  }
  if (dayInCycle <= cycleLength - lutealLength - 1) {
    return { phase: PHASES[1], confidence: CYCLE_DEFAULTS.confidences.follicular };
  }
  if (dayInCycle <= cycleLength - lutealLength + 2) {
    return { phase: PHASES[2], confidence: CYCLE_DEFAULTS.confidences.ovulatory };
  }
  return { phase: PHASES[3], confidence: CYCLE_DEFAULTS.confidences.luteal };
};
