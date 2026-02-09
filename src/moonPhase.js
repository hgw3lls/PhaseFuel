const SYNODIC_MONTH = 29.530588853;
const PHASES = [
  { phase: "new", name: "New Moon" },
  { phase: "waxing_crescent", name: "Waxing Crescent" },
  { phase: "first_quarter", name: "First Quarter" },
  { phase: "waxing_gibbous", name: "Waxing Gibbous" },
  { phase: "full", name: "Full Moon" },
  { phase: "waning_gibbous", name: "Waning Gibbous" },
  { phase: "last_quarter", name: "Last Quarter" },
  { phase: "waning_crescent", name: "Waning Crescent" },
];

const PHASE_LENGTH = SYNODIC_MONTH / PHASES.length;
const KNOWN_NEW_MOON = new Date("2000-01-06T18:14:00Z");

const addDays = (date, days) => {
  const next = new Date(date);
  next.setTime(next.getTime() + days * 24 * 60 * 60 * 1000);
  return next;
};

/**
 * @param {Date} date
 */
const getMoonPhase = (date) => {
  const target = date instanceof Date ? date : new Date(date);
  const diffDays = (target - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
  const age = ((diffDays % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phaseIndex = Math.floor(age / PHASE_LENGTH) % PHASES.length;
  const nextIndex = (phaseIndex + 1) % PHASES.length;
  const phaseProgress = age % PHASE_LENGTH;
  const daysUntilNext = PHASE_LENGTH - phaseProgress;

  return {
    phase: PHASES[phaseIndex].phase,
    name: PHASES[phaseIndex].name,
    nextPhase: PHASES[nextIndex].phase,
    nextPhaseName: PHASES[nextIndex].name,
    nextPhaseDate: addDays(target, daysUntilNext),
    ageDays: Number(age.toFixed(2)),
  };
};

export { getMoonPhase };
