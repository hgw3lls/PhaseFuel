import type { MoonPhase, MoonPhaseResult } from "./phaseModels";

const DAY_MS = 24 * 60 * 60 * 1000;
const SYNODIC_MONTH_DAYS = 29.530588;
const DEFAULT_REFERENCE_NEW_MOON = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));

const MOON_PHASES: MoonPhase[] = [
  "new",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
  "full",
  "waning_gibbous",
  "last_quarter",
  "waning_crescent",
];

const normalizeMoonAge = (daysFromReference: number): number => {
  const wrapped = daysFromReference % SYNODIC_MONTH_DAYS;
  return (wrapped + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
};

const getIlluminationBucket = (moonAgeDays: number): MoonPhaseResult["illuminationBucket"] => {
  const phaseRadians = (2 * Math.PI * moonAgeDays) / SYNODIC_MONTH_DAYS;
  const illumination = (1 - Math.cos(phaseRadians)) / 2;

  if (illumination < 0.33) {
    return "low";
  }

  if (illumination < 0.66) {
    return "medium";
  }

  return "high";
};

export const getMoonPhase = (
  date: Date,
  referenceNewMoon: Date = DEFAULT_REFERENCE_NEW_MOON
): MoonPhaseResult => {
  const daysFromReference = (date.getTime() - referenceNewMoon.getTime()) / DAY_MS;
  const moonAgeDays = normalizeMoonAge(daysFromReference);
  const phaseIndex = Math.floor((moonAgeDays / SYNODIC_MONTH_DAYS) * MOON_PHASES.length) % MOON_PHASES.length;

  return {
    moonPhase: MOON_PHASES[phaseIndex],
    moonAgeDays,
    illuminationBucket: getIlluminationBucket(moonAgeDays),
  };
};
