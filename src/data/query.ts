export type Recipe = {
  id: string;
  name: string;
  mealType: string;
  ingredientTokens?: string[];
  ingredientIds?: string[];
  tags?: string[];
};

type RecipeIndexes = {
  byMealType: Record<string, number[]>;
  byDietFlag: Record<string, number[]>;
  byIngredientId: Record<string, number[]>;
};

type QueryData = {
  recipes: Recipe[];
  indexes: RecipeIndexes;
};

let store: QueryData | null = null;

export const initializeQueryEngine = (data: QueryData) => {
  store = data;
};

const getIndexes = () => store?.indexes;

export const indicesByMealType = (mealType: string): number[] => {
  const indexes = getIndexes();
  return indexes?.byMealType?.[mealType] ?? [];
};

export const indicesByDietFlag = (flag: string): number[] => {
  const indexes = getIndexes();
  return indexes?.byDietFlag?.[flag] ?? [];
};

export const indicesByIngredientId = (ingredientId: string): number[] => {
  const indexes = getIndexes();
  return indexes?.byIngredientId?.[ingredientId] ?? [];
};

export const intersectSorted = (a: number[], b: number[]): number[] => {
  if (!a.length || !b.length) return [];

  let i = 0;
  let j = 0;
  const result: number[] = [];
  let last = -1;

  while (i < a.length && j < b.length) {
    const left = a[i];
    const right = b[j];

    if (left === right) {
      if (left !== last) {
        result.push(left);
        last = left;
      }
      i += 1;
      j += 1;
      continue;
    }

    if (left < right) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return result;
};

export const intersectMany = (arrays: number[][]): number[] => {
  const candidates = arrays.filter((array) => array.length);
  if (!candidates.length) return [];

  candidates.sort((a, b) => a.length - b.length);

  return candidates.reduce((acc, next) => intersectSorted(acc, next));
};

export const getMatchingRecipes = (filters: {
  mealType?: string;
  dietFlags?: string[];
  ingredientIds?: string[];
}): Recipe[] => {
  if (!store) return [];

  const { mealType, dietFlags, ingredientIds } = filters;
  const indexArrays: number[][] = [];

  if (mealType) {
    indexArrays.push(indicesByMealType(mealType));
  }

  dietFlags?.forEach((flag) => {
    indexArrays.push(indicesByDietFlag(flag));
  });

  ingredientIds?.forEach((ingredientId) => {
    indexArrays.push(indicesByIngredientId(ingredientId));
  });

  if (!indexArrays.length) {
    return store.recipes;
  }

  const matches = intersectMany(indexArrays);
  return matches.map((index) => store.recipes[index]).filter(Boolean);
};
