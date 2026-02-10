import { getMenstrualPhase } from "./cycleEngine";
import { getMoonPhase } from "./moonEngine";
import type { PhaseContext, PlannerUserProfile } from "./phaseModels";

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const getCycleDay = (cycleStartDate: Date, currentDate: Date, cycleLength: number): number => {
  const start = startOfUtcDay(cycleStartDate).getTime();
  const current = startOfUtcDay(currentDate).getTime();
  const daysDiff = Math.floor((current - start) / DAY_MS);

  return ((daysDiff % cycleLength) + cycleLength) % cycleLength + 1;
};

export const getPhaseContext = (userProfile: PlannerUserProfile, date: Date): PhaseContext => {
  const cycleStartDate = new Date(userProfile.cycleStartDate);
  const cycleLength = Math.max(1, Math.floor(userProfile.cycleLength));
  const cycleDay = getCycleDay(cycleStartDate, date, cycleLength);

  const menstrualResult = getMenstrualPhase({
    cycleDay,
    cycleLength,
    lutealLength: userProfile.lutealLength,
  });

  const moonResult = getMoonPhase(date);

  return {
    dateISO: startOfUtcDay(date).toISOString(),
    cycleDay,
    menstrualPhase: menstrualResult.phase,
    dayInPhase: menstrualResult.dayInPhase,
    moonPhase: moonResult.moonPhase,
    moonAgeDays: moonResult.moonAgeDays,
  };
};
