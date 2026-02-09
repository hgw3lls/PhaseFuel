const HISTORY_STORAGE_KEY = "phasefuel.history.v1";
const MAX_HISTORY = 5;

const loadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const saveHistory = (items) => {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
};

const updateHistory = (current, transformations) => {
  if (!Array.isArray(transformations)) {
    return current;
  }
  const merged = [...transformations, ...current];
  const deduped = Array.from(new Set(merged));
  return deduped.slice(0, MAX_HISTORY);
};

export { HISTORY_STORAGE_KEY, loadHistory, saveHistory, updateHistory, MAX_HISTORY };
