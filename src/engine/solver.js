import { buildDaySignals } from "./planner.js";
import { calcMacroRanges } from "./macros.js";
import { enforceConstraints } from "./constraints.js";
import { scoreCandidate } from "./score.js";

const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snacks"];

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

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), 1 | t);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const getMacros = (candidate) => candidate?.macros || {
  calories: Number(candidate?.calories || 0),
  protein: Number(candidate?.protein || 0),
  carbs: Number(candidate?.carbs || 0),
  fat: Number(candidate?.fat || 0),
};

const emptyMacros = () => ({ calories: 0, protein: 0, carbs: 0, fat: 0 });

const sumMacros = (left, right) => ({
  calories: Number(left.calories || 0) + Number(right.calories || 0),
  protein: Number(left.protein || 0) + Number(right.protein || 0),
  carbs: Number(left.carbs || 0) + Number(right.carbs || 0),
  fat: Number(left.fat || 0) + Number(right.fat || 0),
});

const sumDayMacros = (day) => {
  const meals = [day.meals.breakfast, day.meals.lunch, day.meals.dinner, ...(day.meals.snacks || [])].filter(Boolean);
  return meals.reduce((total, candidate) => sumMacros(total, getMacros(candidate)), emptyMacros());
};

const candidatePriority = (candidate) => {
  const source = candidate?.source || candidate?.type || "recipe";
  if (source === "leftover") return 3;
  if (source === "template") return 2;
  return 1;
};

const normalizeIngredient = (item) => {
  const value = typeof item === "string" ? item : item?.name || "";
  return value.trim().toLowerCase();
};

const updateHistory = (history, candidate, slot, dayIndex) => {
  if (!candidate) return;
  const recentBySlot = history.recentBySlot[slot] || [];
  recentBySlot.push({ id: candidate.id, dayIndex });
  history.recentBySlot[slot] = recentBySlot;

  history.recent.push({
    id: candidate.id,
    protein: candidate.protein,
    cuisine: candidate.cuisine,
    texture: candidate.texture,
    dayDelta: 0,
  });

  history.recent = history.recent
    .map((entry) => ({ ...entry, dayDelta: entry.dayDelta + 1 }))
    .filter((entry) => entry.dayDelta <= 7);

  (candidate.ingredients || []).forEach((ingredient) => {
    const name = normalizeIngredient(ingredient);
    if (!name) return;
    history.ingredientUsage.set(name, Number(history.ingredientUsage.get(name) || 0) + 1);
  });
};

const sortCandidates = ({ candidates, slot, day, constraints, history, rng, targets }) => {
  return [...candidates]
    .map((candidate) => {
      const score = scoreCandidate(candidate, targets, constraints, { ...history, slot });
      const jitter = rng() * 0.001;
      const priorityBoost = candidatePriority(candidate) * 0.25;
      return { candidate, score: score + priorityBoost + jitter };
    })
    .sort((a, b) => {
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      return `${a.candidate.id}:${day.date}:${slot}`.localeCompare(`${b.candidate.id}:${day.date}:${slot}`);
    });
};

const fallbackCandidate = (slot, index) => ({
  id: `fallback-${slot}-${index}`,
  name: `Fallback ${slot}`,
  source: "template",
  prepMinutes: 5,
  macros: { calories: 250, protein: 12, carbs: 30, fat: 8 },
  ingredients: [],
  diets: [],
  tags: ["quick"],
});

const buildLeftoverLunch = (dinnerCandidate, dayIndex, fraction = 0.65) => {
  const macros = getMacros(dinnerCandidate);
  return {
    id: `leftover-${dinnerCandidate.id}-${dayIndex}`,
    parentId: dinnerCandidate.id,
    name: `Leftover ${dinnerCandidate.name}`,
    source: "leftover",
    prepMinutes: 5,
    macros: {
      calories: Math.round(macros.calories * fraction),
      protein: Math.round(macros.protein * fraction),
      carbs: Math.round(macros.carbs * fraction),
      fat: Math.round(macros.fat * fraction),
    },
    ingredients: dinnerCandidate.ingredients || [],
    diets: dinnerCandidate.diets || [],
    phaseFit: dinnerCandidate.phaseFit || [],
    protein: dinnerCandidate.protein,
    cuisine: dinnerCandidate.cuisine,
    texture: dinnerCandidate.texture,
    tags: ["leftover"],
  };
};

const pickCandidateForSlot = ({ slot, dayIndex, days, candidates, constraints, history, rng, targets }) => {
  const day = days[dayIndex];
  const dayPrepUsed = SLOT_ORDER.flatMap((name) => (name === "snacks" ? day.meals.snacks : day.meals[name]))
    .flat()
    .filter(Boolean)
    .reduce((sum, meal) => sum + Number(meal.prepMinutes || 0), 0);

  const valid = candidates.filter((candidate) => {
    const result = enforceConstraints(candidate, {
      ...constraints,
      context: {
        slot,
        dayIndex,
        dayPrepUsed,
        recentBySlot: history.recentBySlot,
      },
    });
    return result.ok;
  });

  const ranked = sortCandidates({
    candidates: valid.length ? valid : candidates,
    slot,
    day,
    constraints,
    history,
    rng,
    targets,
  });

  return ranked[0]?.candidate || null;
};

export const planWeekSolved = (profile, startDate, { candidatesByMealSlot = {} } = {}) => {
  const start = toDateOnly(startDate || new Date());
  const seedInput = `${profile?.userId || profile?.id || "anon"}:${dateISO(start)}`;
  const rng = mulberry32(hashString(seedInput));

  const baseConstraints = profile?.constraints || {};
  const leftoversConfig = {
    enabled: profile?.leftovers?.enabled !== false,
    dinnerBatchThreshold: Number(profile?.leftovers?.dinnerBatchThreshold || 3),
    lunchFraction: Number(profile?.leftovers?.lunchFraction || 0.65),
  };

  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(start, offset);
    const signals = buildDaySignals(profile, date);
    const extraSnack = signals.extraSnack || (profile?.appetiteSupport && signals.phase === "LUTEAL");
    return {
      date: dateISO(date),
      phase: signals.phase,
      cycleDay: signals.cycleDay,
      signals,
      macroRanges: calcMacroRanges(profile, { phase: signals.phase, overrides: { extraSnack } }),
      meals: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    };
  });

  const history = {
    recent: [],
    recentBySlot: { breakfast: [], lunch: [], dinner: [], snacks: [] },
    ingredientUsage: new Map(),
  };

  const dinnerCandidates = candidatesByMealSlot.dinner || [];
  const topK = Math.max(1, Number(profile?.solver?.topK || 3));

  const assignDinners = (dayIndex) => {
    if (dayIndex >= days.length) return true;
    const day = days[dayIndex];
    const targets = {
      ...day.macroRanges,
      phase: day.phase,
      symptoms: day.signals.symptoms,
      cadence: day.signals.emphasis?.cadence,
    };

    const valid = dinnerCandidates.filter((candidate) =>
      enforceConstraints(candidate, {
        ...baseConstraints,
        context: {
          slot: "dinner",
          dayIndex,
          dayPrepUsed: 0,
          recentBySlot: history.recentBySlot,
        },
      }).ok
    );

    const ranked = sortCandidates({
      candidates: valid.length ? valid : dinnerCandidates,
      slot: "dinner",
      day,
      constraints: baseConstraints,
      history,
      rng,
      targets,
    })
      .slice(0, topK)
      .map((item) => item.candidate);

    for (const candidate of ranked) {
      const snapshot = {
        meal: day.meals.dinner,
        nextLunch: dayIndex + 1 < days.length ? days[dayIndex + 1].meals.lunch : null,
        recent: [...history.recent],
        recentBySlot: JSON.parse(JSON.stringify(history.recentBySlot)),
        ingredientUsage: new Map(history.ingredientUsage),
      };

      day.meals.dinner = candidate;
      updateHistory(history, candidate, "dinner", dayIndex);

      if (
        leftoversConfig.enabled &&
        dayIndex + 1 < days.length &&
        Number(candidate.batchServings || 1) >= leftoversConfig.dinnerBatchThreshold
      ) {
        days[dayIndex + 1].meals.lunch = buildLeftoverLunch(candidate, dayIndex + 1, leftoversConfig.lunchFraction);
      }

      if (assignDinners(dayIndex + 1)) return true;

      day.meals.dinner = snapshot.meal;
      if (dayIndex + 1 < days.length) days[dayIndex + 1].meals.lunch = snapshot.nextLunch;
      history.recent = snapshot.recent;
      history.recentBySlot = snapshot.recentBySlot;
      history.ingredientUsage = snapshot.ingredientUsage;
    }

    return false;
  };

  assignDinners(0);

  days.forEach((day, dayIndex) => {
    const targets = {
      ...day.macroRanges,
      phase: day.phase,
      symptoms: day.signals.symptoms,
      cadence: day.signals.emphasis?.cadence,
    };

    if (!day.meals.lunch) {
      const lunchPool = candidatesByMealSlot.lunch || [];
      const templates = lunchPool.filter((item) => (item.source || item.type) === "template");
      const recipes = lunchPool.filter((item) => (item.source || item.type) !== "template");
      const ordered = [...templates, ...recipes];
      day.meals.lunch = pickCandidateForSlot({
        slot: "lunch",
        dayIndex,
        days,
        candidates: ordered.length ? ordered : [fallbackCandidate("lunch", dayIndex)],
        constraints: baseConstraints,
        history,
        rng,
        targets,
      });
      updateHistory(history, day.meals.lunch, "lunch", dayIndex);
    } else {
      updateHistory(history, day.meals.lunch, "lunch", dayIndex);
    }

    day.meals.breakfast = pickCandidateForSlot({
      slot: "breakfast",
      dayIndex,
      days,
      candidates: candidatesByMealSlot.breakfast || [fallbackCandidate("breakfast", dayIndex)],
      constraints: baseConstraints,
      history,
      rng,
      targets,
    });
    updateHistory(history, day.meals.breakfast, "breakfast", dayIndex);

    const macrosBeforeSnacks = sumDayMacros(day);
    const needsSnack =
      day.signals.extraSnack ||
      (profile?.appetiteSupport && day.phase === "LUTEAL") ||
      macrosBeforeSnacks.calories < day.macroRanges.caloriesRange.min;
    const snackCount = needsSnack ? 2 : 1;

    const snackPool = candidatesByMealSlot.snacks || [];
    for (let i = 0; i < snackCount; i += 1) {
      const snackTargets = {
        ...targets,
        caloriesRange: {
          min: Math.max(0, day.macroRanges.caloriesRange.min - sumDayMacros(day).calories),
          max: Math.max(200, day.macroRanges.caloriesRange.max - sumDayMacros(day).calories),
        },
      };
      const snack = pickCandidateForSlot({
        slot: "snacks",
        dayIndex,
        days,
        candidates: snackPool.length ? snackPool : [fallbackCandidate("snack", `${dayIndex}-${i}`)],
        constraints: baseConstraints,
        history,
        rng,
        targets: snackTargets,
      });
      if (snack) {
        day.meals.snacks.push(snack);
        updateHistory(history, snack, "snacks", dayIndex);
      }
    }
  });

  return {
    startDate: dateISO(start),
    seed: seedInput,
    days,
  };
};
