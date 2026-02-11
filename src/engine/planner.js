import {
  applySymptomOverrides,
  getCycleDay,
  getPhase,
  getPhaseNutritionEmphasis,
} from "./cycle.js";
import { calcMacroRanges } from "./macros.js";
import { MEAL_TEMPLATES, getTemplatesByPhase } from "./templates.js";

const toDateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const dateKey = (date) => toDateOnly(date).toISOString().slice(0, 10);

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pickTemplate = (templates, seed, usedIds = new Set()) => {
  const pool = templates.filter((item) => !usedIds.has(item.id));
  const source = pool.length ? pool : templates;
  if (!source.length) {
    return null;
  }

  const candidateCount = Math.min(4, source.length);
  const shortlist = source.slice(0, candidateCount);
  return shortlist[seed % shortlist.length];
};

const scoreTemplate = (template, signals) => {
  let score = 0;
  const styles = new Set(signals.emphasis.mealStyle || []);

  if (styles.has("warm") && template.warmth === "WARM") score += 2;
  if (styles.has("easy-digest") && template.digestion === "GENTLE") score += 2;
  if (styles.has("high-satiety") && template.tags.includes("high-satiety")) score += 2;

  if (signals.symptoms?.cramps || signals.phase === "MENSTRUAL") {
    if (template.warmth === "WARM") score += 2;
    if (template.digestion === "GENTLE") score += 2;
  }

  if (signals.symptoms?.bloating) {
    if (template.digestion === "HEAVY") score -= 4;
    if (template.tags.includes("high-salt")) score -= 4;
  }

  return score;
};

const rankTemplates = (templates, signals) =>
  [...templates].sort((a, b) => {
    const diff = scoreTemplate(b, signals) - scoreTemplate(a, signals);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });


const filterTemplatesForSignals = (templates, signals) => {
  let next = [...templates];

  if (signals.symptoms?.cramps || signals.phase === "MENSTRUAL") {
    const warmGentle = next.filter((item) => item.warmth === "WARM" && item.digestion === "GENTLE");
    if (warmGentle.length) {
      next = warmGentle;
    }
  }

  if (signals.symptoms?.bloating) {
    const lighter = next.filter((item) => item.digestion !== "HEAVY" && !item.tags.includes("high-salt"));
    if (lighter.length) {
      next = lighter;
    }
  }

  return next;
};

const buildPrepTasks = (selected) => {
  const tasks = new Set();
  selected.forEach((template) => {
    if (!template) return;
    if (template.prep === "BATCH") tasks.add(`Batch prep base for ${template.name}`);
    if (template.prep === "QUICK") tasks.add(`Quick-cook components for ${template.name}`);
    if (template.prep === "ASSEMBLE") tasks.add(`Set aside assemble-ready items for ${template.name}`);
  });
  return Array.from(tasks);
};

export const buildDaySignals = (profile, today = new Date()) => {
  const day = toDateOnly(today);
  const cycleLength = Number.isInteger(profile?.cycleLength) ? profile.cycleLength : 28;
  const periodLength = Number.isInteger(profile?.periodLength) ? profile.periodLength : 5;
  const ovulationOffset = Number.isInteger(profile?.ovulationOffset) ? profile.ovulationOffset : 14;

  const cycleDay = getCycleDay(
    {
      lastPeriodStart: profile?.lastPeriodStart,
      cycleLength,
    },
    day
  );

  const phase = getPhase({
    cycleDay,
    cycleLength,
    periodLength,
    ovulationOffset,
  });

  const baseGuidance = getPhaseNutritionEmphasis(phase);
  const symptoms = profile?.symptoms || {};
  const emphasis = applySymptomOverrides(baseGuidance, symptoms);

  return {
    date: dateKey(day),
    cycleDay,
    phase,
    symptoms,
    emphasis,
    extraSnack: emphasis.mealStyle.includes("extra snack slot"),
  };
};

export const planDay = (profile, daySignals) => {
  const phaseTemplates = getTemplatesByPhase(daySignals.phase);
  const filteredTemplates = filterTemplatesForSignals(
    phaseTemplates.length ? phaseTemplates : MEAL_TEMPLATES,
    daySignals
  );
  const ranked = rankTemplates(filteredTemplates, daySignals);

  const seedBase = hashString(`${daySignals.date}:${JSON.stringify(profile || {})}`);
  const used = new Set();

  const breakfast = pickTemplate(ranked, seedBase + 11, used);
  if (breakfast) used.add(breakfast.id);
  const lunch = pickTemplate(ranked, seedBase + 23, used);
  if (lunch) used.add(lunch.id);
  const dinner = pickTemplate(ranked, seedBase + 37, used);
  if (dinner) used.add(dinner.id);

  const snackTemplates = rankTemplates(
    ranked.filter((item) => item.tags.includes("snack") || item.prep === "ASSEMBLE"),
    daySignals
  );

  const snacks = [];
  const snackCount = daySignals.extraSnack || (profile?.appetiteSupport && daySignals.phase === "LUTEAL") ? 2 : 1;
  for (let i = 0; i < snackCount; i += 1) {
    const snack = pickTemplate(snackTemplates.length ? snackTemplates : ranked, seedBase + 50 + i, used);
    if (snack) {
      snacks.push(snack);
      used.add(snack.id);
    }
  }

  const macroRanges = calcMacroRanges(profile, {
    phase: daySignals.phase,
    overrides: { extraSnack: snackCount > 1 },
  });

  const prepTasks = buildPrepTasks([breakfast, lunch, dinner, ...snacks]);

  return {
    date: daySignals.date,
    phase: daySignals.phase,
    macroRanges,
    emphasis: daySignals.emphasis,
    meals: {
      breakfast,
      lunch,
      dinner,
      snacks,
    },
    prepTasks,
  };
};
