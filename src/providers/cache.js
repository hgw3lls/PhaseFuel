const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 7 * DAY_MS;
const DB_NAME = "phasefuel-recipe-cache";
const DB_VERSION = 1;
const STORE_NAME = "recipeDetails";

const toKey = (provider, recipeId) => `${provider}:${recipeId}`;

const openDb = (indexedDbImpl = globalThis.indexedDB) => {
  if (!indexedDbImpl) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDbImpl.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const idbGet = async (db, key) => {
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const idbPut = async (db, value) => {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const idbDelete = async (db, key) => {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const createRecipeCache = ({
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  indexedDB: indexedDbImpl = globalThis.indexedDB,
} = {}) => {
  const memory = new Map();
  let dbPromise = null;

  const getDb = () => {
    if (!dbPromise) dbPromise = openDb(indexedDbImpl).catch(() => null);
    return dbPromise;
  };

  const get = async (provider, recipeId) => {
    const key = toKey(provider, recipeId);
    const timestamp = now();

    const fromMemory = memory.get(key);
    if (fromMemory) {
      if (timestamp - fromMemory.cachedAt <= ttlMs) return fromMemory.value;
      memory.delete(key);
    }

    const db = await getDb();
    const persisted = await idbGet(db, key);
    if (!persisted) return null;
    if (timestamp - persisted.cachedAt > ttlMs) {
      await idbDelete(db, key);
      return null;
    }
    memory.set(key, persisted);
    return persisted.value;
  };

  const set = async (provider, recipeId, value) => {
    const key = toKey(provider, recipeId);
    const payload = {
      key,
      cachedAt: now(),
      value,
    };
    memory.set(key, payload);
    const db = await getDb();
    await idbPut(db, payload);
    return value;
  };

  return {
    ttlMs,
    get,
    set,
  };
};

export { DEFAULT_TTL_MS };
