const SYNODIC_MONTH_DAYS = 29.53058867;
const SYNODIC_MONTH_MS = SYNODIC_MONTH_DAYS * 24 * 60 * 60 * 1000;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);

const normalizeDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date input.");
  }
  return date;
};

export const getMoonPhaseFraction = (date = new Date()) => {
  const normalized = normalizeDate(date);
  const elapsed = normalized.getTime() - KNOWN_NEW_MOON_UTC;
  const cycleMs = ((elapsed % SYNODIC_MONTH_MS) + SYNODIC_MONTH_MS) % SYNODIC_MONTH_MS;
  return cycleMs / SYNODIC_MONTH_MS;
};

export const getMoonPhaseName = (fraction) => {
  if (!Number.isFinite(fraction)) {
    throw new Error("fraction must be a finite number.");
  }

  const value = ((fraction % 1) + 1) % 1;

  if (value < 1 / 16 || value >= 15 / 16) return "NEW";
  if (value < 3 / 16) return "WAXING_CRESCENT";
  if (value < 5 / 16) return "FIRST_QUARTER";
  if (value < 7 / 16) return "WAXING_GIBBOUS";
  if (value < 9 / 16) return "FULL";
  if (value < 11 / 16) return "WANING_GIBBOUS";
  if (value < 13 / 16) return "LAST_QUARTER";
  return "WANING_CRESCENT";
};
