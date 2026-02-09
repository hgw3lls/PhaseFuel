const PRICE_STORAGE_KEY = "phasefuel.prices.v1";

const loadPrices = () => {
  try {
    const raw = localStorage.getItem(PRICE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const savePrices = (items) => {
  localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(items));
};

const upsertPriceItem = (items, item) => {
  const target = item.name?.trim().toLowerCase();
  if (!target) {
    return items;
  }
  const index = items.findIndex((entry) => entry.name.trim().toLowerCase() === target);
  if (index >= 0) {
    const next = [...items];
    next[index] = { ...items[index], ...item };
    return next;
  }
  return [...items, item];
};

const removePriceItem = (items, name) =>
  items.filter((entry) => entry.name.trim().toLowerCase() !== name.trim().toLowerCase());

const summarizePrices = (items) =>
  items
    .map((item) => `${item.name}: ${item.price}/${item.unit}`)
    .filter(Boolean)
    .join(", ");

export {
  PRICE_STORAGE_KEY,
  loadPrices,
  savePrices,
  upsertPriceItem,
  removePriceItem,
  summarizePrices,
};
