const FREEZER_STORAGE_KEY = "phasefuel.freezer.v1";

const loadFreezer = () => {
  try {
    const raw = localStorage.getItem(FREEZER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
};

const saveFreezer = (items) => {
  localStorage.setItem(FREEZER_STORAGE_KEY, JSON.stringify(items));
};

const addFreezerItem = (items, item) => [...items, item];

const removeFreezerItem = (items, index) => items.filter((_, idx) => idx !== index);

export { FREEZER_STORAGE_KEY, loadFreezer, saveFreezer, addFreezerItem, removeFreezerItem };
