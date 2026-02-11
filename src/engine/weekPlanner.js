import { buildDaySignals } from "./planner.js";
import { calcMacroRanges } from "./macros.js";
import { MEAL_TEMPLATES, getTemplatesByPhase } from "./templates.js";
import { getMoonPhaseFraction, getMoonPhaseName } from "./moon.js";

const toDateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const dateISO = (date) => toDateOnly(date).toISOString().slice(0, 10);

const addDays = (date, days) => {
  const next = toDateOnly(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const buildPrepTasks = (templates) => {
  const tasks = new Set();
  templates.forEach((template) => {
    if (!template) return;
    if (template.prep === "BATCH") tasks.add(`Batch prep base for ${template.name}`);
    if (template.prep === "QUICK") tasks.add(`Quick-cook components for ${template.name}`);
    if (template.prep === "ASSEMBLE") tasks.add(`Set aside assemble-ready items for ${template.name}`);
  });
  return tasks;
};

const getMoonCadence = (moonPhase) => {
  if (moonPhase === "NEW") return "NEW";
  if (["WAXING_CRESCENT", "FIRST_QUARTER", "WAXING_GIBBOUS"].includes(moonPhase)) return "WAXING";
  if (moonPhase === "FULL") return "FULL";
  return "WANING";
};

const noveltyLimitByCadence = {
  NEW: 2,
  WAXING: 1,
  FULL: 1,
  WANING: 0,
};

const filterTemplatesForSymptoms = (templates, daySignals) => {
  let next = [...templates];

  if (daySignals.symptoms?.cramps || daySignals.phase === "MENSTRUAL") {
    const warmGentle = next.filter((item) => item.warmth === "WARM" && item.digestion === "GENTLE");
    if (warmGentle.length) next = warmGentle;
  }

  if (daySignals.symptoms?.bloating) {
    const lighter = next.filter((item) => item.digestion !== "HEAVY" && !item.tags.includes("high-salt"));
    if (lighter.length) next = lighter;
  }

  return next;
};

const scoreTemplate = (template, daySignals, cadence, seenCounts) => {
  let score = 0;
  const styles = new Set(daySignals.emphasis.mealStyle || []);

  if (styles.has("warm") && template.warmth === "WARM") score += 2;
  if (styles.has("easy-digest") && template.digestion === "GENTLE") score += 2;
  if (styles.has("high-satiety") && template.tags.includes("high-satiety")) score += 2;

  if (cadence === "WANING") {
    if (template.prep === "QUICK" || template.prep === "ASSEMBLE") score += 2;
    if (template.tags.includes("comforting")) score += 1;
  }

  if (seenCounts.get(template.id)) {
    score += cadence === "WANING" ? 3 : 1;
  }

  return score;
};

const chooseTemplate = ({
  candidates,
  date,
  slot,
  cadence,
  noveltyLimit,
  seenCounts,
  dayNewIds,
  usedToday,
  daySignals,
}) => {
  if (!candidates.length) return null;

  const daySeed = hashString(`${dateISO(date)}:${slot}`);
  const available = candidates.filter((template) => !usedToday.has(template.id));
  const source = available.length ? available : candidates;

  const canUseNew = dayNewIds.size < noveltyLimit;
  let noveltyFiltered = source;
  if (!canUseNew) {
    const repeatedOnly = source.filter((template) => seenCounts.get(template.id));
    if (repeatedOnly.length) noveltyFiltered = repeatedOnly;
  }

  if (cadence === "WANING") {
    const repeatsFirst = noveltyFiltered.filter((template) => seenCounts.get(template.id));
    if (repeatsFirst.length) {
      noveltyFiltered = repeatsFirst;
    }
  }

  const ranked = [...noveltyFiltered].sort((a, b) => {
    const diff =
      scoreTemplate(b, daySignals, cadence, seenCounts) - scoreTemplate(a, daySignals, cadence, seenCounts);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  const choice = ranked[daySeed % Math.min(4, ranked.length)];
  if (!choice) return null;

  usedToday.add(choice.id);
  if (!seenCounts.get(choice.id)) {
    dayNewIds.add(choice.id);
  }
  seenCounts.set(choice.id, (seenCounts.get(choice.id) || 0) + 1);
  return choice;
};

export const planWeek = (profile, startDate = new Date()) => {
  const start = toDateOnly(startDate);
  const week = [];
  const seenCounts = new Map();

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(start, offset);
    const daySignals = buildDaySignals(profile, date);

    const moonFraction = getMoonPhaseFraction(date);
    const moonPhase = getMoonPhaseName(moonFraction);
    const cadence = profile?.enableMoonCadence === false ? "WAXING" : getMoonCadence(moonPhase);
    const noveltyLimit = noveltyLimitByCadence[cadence];

    const phaseTemplates = getTemplatesByPhase(daySignals.phase);
    const basePool = phaseTemplates.length ? phaseTemplates : MEAL_TEMPLATES;
    const filteredPool = filterTemplatesForSymptoms(basePool, daySignals);

    const dayNewIds = new Set();
    const usedToday = new Set();

    const breakfast = chooseTemplate({
      candidates: filteredPool,
      date,
      slot: "breakfast",
      cadence,
      noveltyLimit,
      seenCounts,
      dayNewIds,
      usedToday,
      daySignals,
    });

    const lunch = chooseTemplate({
      candidates: filteredPool,
      date,
      slot: "lunch",
      cadence,
      noveltyLimit,
      seenCounts,
      dayNewIds,
      usedToday,
      daySignals,
    });

    const dinner = chooseTemplate({
      candidates: filteredPool,
      date,
      slot: "dinner",
      cadence,
      noveltyLimit,
      seenCounts,
      dayNewIds,
      usedToday,
      daySignals,
    });

    const snackCandidates = filteredPool.filter(
      (template) => template.tags.includes("snack") || template.prep === "ASSEMBLE"
    );

    const snacks = [];
    const extraSnack =
      daySignals.extraSnack ||
      (profile?.appetiteSupport && daySignals.phase === "LUTEAL") ||
      (cadence === "FULL" && profile?.sleepSensitive);
    const snackCount = extraSnack ? 2 : 1;

    for (let snackIndex = 0; snackIndex < snackCount; snackIndex += 1) {
      const snack = chooseTemplate({
        candidates: snackCandidates.length ? snackCandidates : filteredPool,
        date,
        slot: `snack-${snackIndex}`,
        cadence,
        noveltyLimit,
        seenCounts,
        dayNewIds,
        usedToday,
        daySignals,
      });
      if (snack) snacks.push(snack);
    }

    const prepTasks = buildPrepTasks([breakfast, lunch, dinner, ...snacks]);

    if (cadence === "NEW") {
      prepTasks.add("pantry audit");
      prepTasks.add("batch cook 2 bases");
    }

    if (cadence === "WAXING") {
      prepTasks.add("progressive prep: chop produce for tomorrow");
    }

    if (cadence === "WANING") {
      prepTasks.add("leftover refresh bowl");
      prepTasks.add("simple soup night");
    }

    const emphasis = {
      ...daySignals.emphasis,
      emphasize: [...daySignals.emphasis.emphasize],
      mealStyle: [...daySignals.emphasis.mealStyle],
      limit: [...daySignals.emphasis.limit],
    };

    if (cadence === "FULL" && !emphasis.emphasize.includes("hydration")) {
      emphasis.emphasize.push("hydration");
    }
    if (cadence === "FULL" && profile?.sleepSensitive && !emphasis.mealStyle.includes("calm evening snack")) {
      emphasis.mealStyle.push("calm evening snack");
    }

    week.push({
      date: dateISO(date),
      cycleDay: daySignals.cycleDay,
      phase: daySignals.phase,
      moonPhase,
      moonCadence: cadence,
      macroRanges: calcMacroRanges(profile, {
        phase: daySignals.phase,
        overrides: { extraSnack },
      }),
      emphasis,
      meals: {
        breakfast,
        lunch,
        dinner,
        snacks,
      },
      prepTasks: Array.from(prepTasks),
      noveltyCount: dayNewIds.size,
    });
  }

  return {
    startDate: dateISO(start),
    days: week,
  };
};
