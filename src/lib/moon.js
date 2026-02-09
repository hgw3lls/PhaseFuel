const DAY_MS = 24 * 60 * 60 * 1000;
const SYNODIC_MONTH = 29.53058867;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);

const MOON_PHASES = [
  "new",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full",
  "waning gibbous",
  "last quarter",
  "waning crescent",
];

export const getLunarAge = (date = new Date()) => {
  const days = (date.getTime() - REF_NEW_MOON) / DAY_MS;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  return age;
};

export const getMoonPhaseBucket = (date = new Date()) => {
  const age = getLunarAge(date);
  const index = Math.floor((age / SYNODIC_MONTH) * MOON_PHASES.length) % MOON_PHASES.length;
  return { age, phase: MOON_PHASES[index] };
};
