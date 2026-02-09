const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MENSTRUAL_DAYS = 5;

const normalizeDate = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/**
 * @param {Date} today
 * @param {{lastPeriodStart: string, cycleLength: number, lutealLength: number}} prefs
 */
const calculateCyclePhase = (today, prefs) => {
  const cycleLength = prefs?.cycleLength || 28;
  const lutealLength = prefs?.lutealLength || 14;
  const startDate = normalizeDate(prefs?.lastPeriodStart);
  if (!startDate) {
    return {
      isValid: false,
      phase: null,
      nextPhase: null,
      nextPhaseDate: null,
      dayInCycle: null,
      cycleLength,
      lutealLength,
    };
  }

  const todayDate = normalizeDate(today) || new Date();
  const diffDays = Math.floor((todayDate - startDate) / MS_PER_DAY);
  const dayOffset = diffDays >= 0 ? diffDays % cycleLength : 0;
  const dayInCycle = dayOffset + 1;
  const ovulationDay = Math.max(1, cycleLength - lutealLength);

  let phase = "luteal";
  let nextPhase = "menstrual";
  let nextPhaseStartDay = 1;

  if (dayInCycle <= MENSTRUAL_DAYS) {
    phase = "menstrual";
    nextPhase = "follicular";
    nextPhaseStartDay = MENSTRUAL_DAYS + 1;
  } else if (dayInCycle < ovulationDay) {
    phase = "follicular";
    nextPhase = "ovulatory";
    nextPhaseStartDay = ovulationDay;
  } else if (dayInCycle === ovulationDay) {
    phase = "ovulatory";
    nextPhase = "luteal";
    nextPhaseStartDay = ovulationDay + 1;
  } else {
    phase = "luteal";
    nextPhase = "menstrual";
    nextPhaseStartDay = 1;
  }

  let daysUntilNext;
  if (nextPhaseStartDay === 1) {
    daysUntilNext = cycleLength - dayInCycle + 1;
  } else if (dayInCycle <= nextPhaseStartDay) {
    daysUntilNext = nextPhaseStartDay - dayInCycle;
  } else {
    daysUntilNext = cycleLength - dayInCycle + nextPhaseStartDay;
  }

  return {
    isValid: true,
    phase,
    nextPhase,
    nextPhaseDate: addDays(todayDate, daysUntilNext),
    dayInCycle,
    cycleLength,
    lutealLength,
  };
};

export { calculateCyclePhase };
