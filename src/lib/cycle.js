const DAY_MS = 24 * 60 * 60 * 1000;

const PHASES = ["menstrual", "follicular", "ovulatory", "luteal"];

const toDate = (value) => (value ? new Date(value) : null);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const estimatePhase = (dateISO, settings, mode = "period_based") => {
  const date = toDate(dateISO) || new Date();
  const cycleLength = settings?.typicalCycleLength || settings?.cycleLength || 28;
  const lutealLength = settings?.typicalLutealLength || settings?.lutealLength || 14;
  const periodLength = settings?.periodLength || 5;

  if (mode === "moon_only") {
    return { phase: "ovulatory", confidence: 0.35 };
  }

  if (mode === "symptom_only") {
    return { phase: "luteal", confidence: 0.3 };
  }

  if (mode === "ovulation_aware" && settings?.lastOvulation) {
    const lastOvulation = toDate(settings.lastOvulation);
    if (lastOvulation) {
      const diffDays = Math.floor((date - lastOvulation) / DAY_MS);
      if (diffDays >= 0 && diffDays <= lutealLength) {
        return { phase: "luteal", confidence: 0.8 };
      }
      const ovulationWindow = Math.abs(diffDays);
      if (ovulationWindow <= 2) {
        return { phase: "ovulatory", confidence: 0.85 };
      }
    }
  }

  const lastPeriodStart = toDate(settings?.lastPeriodStart);
  if (!lastPeriodStart) {
    return { phase: "follicular", confidence: 0.3 };
  }

  const dayInCycle = clamp(Math.floor((date - lastPeriodStart) / DAY_MS) + 1, 1, cycleLength);
  if (dayInCycle <= periodLength) {
    return { phase: PHASES[0], confidence: 0.7 };
  }
  if (dayInCycle <= cycleLength - lutealLength - 1) {
    return { phase: PHASES[1], confidence: 0.6 };
  }
  if (dayInCycle <= cycleLength - lutealLength + 2) {
    return { phase: PHASES[2], confidence: 0.65 };
  }
  return { phase: PHASES[3], confidence: 0.65 };
};
