export type Ingredient = {
  id: string;
  name: string;
  aliases?: string[];
  category?: string;
  count?: number;
};

type AliasRecord = {
  canonicalName: string;
  canonicalId: string;
};

type IngredientData = {
  ingredients: Ingredient[];
  aliasMap: Record<string, AliasRecord>;
};

type SearchEntry = {
  key: string;
  id: string;
  count: number;
  isCanonical: boolean;
};

let ingredientById = new Map<string, Ingredient>();
let canonicalIdByName = new Map<string, string>();
let aliasToCanonicalId = new Map<string, string>();
let canonicalEntries: SearchEntry[] = [];
let aliasEntries: SearchEntry[] = [];
let initialized = false;

export const initializeIngredientResolver = ({ ingredients, aliasMap }: IngredientData) => {
  ingredientById = new Map();
  canonicalIdByName = new Map();
  aliasToCanonicalId = new Map();
  canonicalEntries = [];
  aliasEntries = [];

  ingredients.forEach((ingredient) => {
    if (!ingredient?.id) return;
    const nameKey = normalizeIngredientText(ingredient.name || "");
    if (nameKey) {
      canonicalIdByName.set(nameKey, ingredient.id);
      canonicalEntries.push({
        key: nameKey,
        id: ingredient.id,
        count: ingredient.count ?? 0,
        isCanonical: true,
      });
    }
    ingredientById.set(ingredient.id, ingredient);
  });

  Object.entries(aliasMap || {}).forEach(([raw, record]) => {
    const key = normalizeIngredientText(raw);
    if (!key || !record?.canonicalId) return;
    aliasToCanonicalId.set(key, record.canonicalId);
    const ingredient = ingredientById.get(record.canonicalId);
    aliasEntries.push({
      key,
      id: record.canonicalId,
      count: ingredient?.count ?? 0,
      isCanonical: false,
    });
  });

  canonicalEntries.sort((a, b) => a.key.localeCompare(b.key));
  aliasEntries.sort((a, b) => a.key.localeCompare(b.key));
  initialized = true;
};

export const normalizeIngredientText = (value: string): string =>
  value.toLowerCase().trim().replace(/\s+/g, " ");

const findPrefixStart = (entries: SearchEntry[], prefix: string) => {
  let low = 0;
  let high = entries.length - 1;
  let start = entries.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (entries[mid].key >= prefix) {
      start = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return start;
};

const collectPrefixMatches = (
  entries: SearchEntry[],
  prefix: string,
  limit: number
): SearchEntry[] => {
  const matches: SearchEntry[] = [];
  let index = findPrefixStart(entries, prefix);

  while (index < entries.length && matches.length < limit) {
    const entry = entries[index];
    if (!entry.key.startsWith(prefix)) {
      break;
    }
    matches.push(entry);
    index += 1;
  }

  return matches;
};

export const resolveIngredientId = (input: string): string | null => {
  if (!initialized) return null;
  const normalized = normalizeIngredientText(input);
  if (!normalized) return null;

  const aliasHit = aliasToCanonicalId.get(normalized);
  if (aliasHit) return aliasHit;

  const direct = canonicalIdByName.get(normalized);
  if (direct) return direct;

  const canonicalMatch = collectPrefixMatches(canonicalEntries, normalized, 1)[0];
  if (canonicalMatch) return canonicalMatch.id;

  const aliasMatch = collectPrefixMatches(aliasEntries, normalized, 20).reduce<SearchEntry | null>(
    (best, entry) => {
      if (!best || entry.count > best.count) {
        return entry;
      }
      return best;
    },
    null
  );

  return aliasMatch?.id ?? null;
};

export const searchIngredients = (prefix: string, limit = 20): Ingredient[] => {
  if (!initialized) return [];
  const normalized = normalizeIngredientText(prefix);
  if (!normalized) return [];

  const results: Ingredient[] = [];
  const seen = new Set<string>();

  const canonicalMatches = collectPrefixMatches(canonicalEntries, normalized, limit);
  canonicalMatches.forEach((entry) => {
    if (results.length >= limit) return;
    if (!seen.has(entry.id)) {
      const ingredient = ingredientById.get(entry.id);
      if (ingredient) {
        results.push(ingredient);
        seen.add(entry.id);
      }
    }
  });

  if (results.length < limit) {
    const remaining = limit - results.length;
    const aliasMatches = collectPrefixMatches(aliasEntries, normalized, remaining * 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, remaining);

    aliasMatches.forEach((entry) => {
      if (results.length >= limit) return;
      if (!seen.has(entry.id)) {
        const ingredient = ingredientById.get(entry.id);
        if (ingredient) {
          results.push(ingredient);
          seen.add(entry.id);
        }
      }
    });
  }

  return results;
};

export const getIngredient = (id: string): Ingredient | null => {
  if (!initialized) return null;
  return ingredientById.get(id) ?? null;
};
