const PANTRY_STORAGE_KEY = "phasefuel.pantry.v1";

/**
 * @typedef {Object} PantryItem
 * @property {string} name
 * @property {string} [qty]
 * @property {string} [unit]
 * @property {string} [expiresOn]
 */

const normalizeName = (value) => value.trim().toLowerCase();

const loadPantry = () => {
  try {
    const raw = localStorage.getItem(PANTRY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const savePantry = (items) => {
  localStorage.setItem(PANTRY_STORAGE_KEY, JSON.stringify(items));
};

const upsertPantryItem = (items, item) => {
  const target = normalizeName(item.name || "");
  if (!target) {
    return items;
  }
  const existingIndex = items.findIndex((entry) => normalizeName(entry.name) === target);
  if (existingIndex >= 0) {
    const nextItems = [...items];
    nextItems[existingIndex] = { ...items[existingIndex], ...item };
    return nextItems;
  }
  return [...items, item];
};

const removePantryItem = (items, name) =>
  items.filter((item) => normalizeName(item.name) !== normalizeName(name));

const summarizePantry = (items) =>
  items
    .map((item) => item.name)
    .filter(Boolean)
    .join(", ");

const adjustGroceryListForPantry = (groceryList, pantryItems) => {
  if (!Array.isArray(groceryList) || !pantryItems?.length) {
    return groceryList || [];
  }
  const pantrySet = new Set(pantryItems.map((item) => normalizeName(item.name || "")));
  return groceryList.filter((item) => !pantrySet.has(normalizeName(item.name || "")));
};

export {
  PANTRY_STORAGE_KEY,
  loadPantry,
  savePantry,
  upsertPantryItem,
  removePantryItem,
  summarizePantry,
  adjustGroceryListForPantry,
};
