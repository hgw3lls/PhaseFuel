import type { MenstrualPhaseParams, MenstrualPhaseResult } from "./phaseModels";

const DEFAULT_CYCLE_LENGTH = 28;
const DEFAULT_LUTEAL_LENGTH = 14;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const getMenstrualPhase = ({
  cycleDay,
  cycleLength = DEFAULT_CYCLE_LENGTH,
  lutealLength = DEFAULT_LUTEAL_LENGTH,
}: MenstrualPhaseParams): MenstrualPhaseResult => {
  const normalizedCycleLength = Math.max(1, Math.floor(cycleLength));
  const normalizedCycleDay = clamp(Math.floor(cycleDay), 1, normalizedCycleLength);

  const safeLutealLength = clamp(Math.floor(lutealLength), 1, normalizedCycleLength - 1 || 1);
  const ovulationDay = clamp(normalizedCycleLength - safeLutealLength, 1, normalizedCycleLength);

  if (normalizedCycleDay <= 5) {
    return {
      phase: "menstrual",
      dayInPhase: normalizedCycleDay,
      ovulationDay,
    };
  }

  if (normalizedCycleDay < ovulationDay) {
    return {
      phase: "follicular",
      dayInPhase: normalizedCycleDay - 5,
      ovulationDay,
    };
  }

  if (normalizedCycleDay === ovulationDay) {
    return {
      phase: "ovulation",
      dayInPhase: 1,
      ovulationDay,
    };
  }

  return {
    phase: "luteal",
    dayInPhase: normalizedCycleDay - ovulationDay,
    ovulationDay,
  };
};
