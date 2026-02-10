import React, { useMemo } from "react";

type DataStore = {
  recipes?: Array<{ id?: string; name?: string; ingredientIds?: string[] }>;
  ingredients?: Array<{ id?: string; category?: string }>;
  indexes?: {
    byMealType?: Record<string, number[]>;
    byDietFlag?: Record<string, number[]>;
    byIngredientId?: Record<string, number[]>;
  };
};

const pickSampleIndices = (arrays: number[][], sampleSize = 8) => {
  const flat = arrays.filter((arr) => arr.length);
  if (!flat.length) return [] as number[];

  const picks: number[] = [];
  for (let i = 0; i < sampleSize; i += 1) {
    const arr = flat[Math.floor(Math.random() * flat.length)];
    const index = arr[Math.floor(Math.random() * arr.length)];
    if (Number.isInteger(index)) {
      picks.push(index);
    }
  }
  return picks;
};

export default function DatasetDiagnostics({ data }: { data: DataStore | null }) {
  if (!import.meta.env.DEV || !data) return null;

  const recipes = data.recipes || [];
  const ingredients = data.ingredients || [];
  const indexes = data.indexes || {};

  const diagnostics = useMemo(() => {
    const categoryDistribution = ingredients.reduce<Record<string, number>>((acc, ingredient) => {
      const category = ingredient.category || "unknown";
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    const mealTypeArrays = Object.values(indexes.byMealType || {});
    const dietFlagArrays = Object.values(indexes.byDietFlag || {});
    const ingredientIdArrays = Object.values(indexes.byIngredientId || {});

    const sampled = [
      ...pickSampleIndices(mealTypeArrays, 4),
      ...pickSampleIndices(dietFlagArrays, 4),
      ...pickSampleIndices(ingredientIdArrays, 4),
    ];

    const invalidReferences = sampled.filter((idx) => idx < 0 || idx >= recipes.length);

    return {
      categoryDistribution,
      keyCounts: {
        mealType: Object.keys(indexes.byMealType || {}).length,
        dietFlag: Object.keys(indexes.byDietFlag || {}).length,
        ingredientId: Object.keys(indexes.byIngredientId || {}).length,
      },
      invalidReferenceCount: invalidReferences.length,
    };
  }, [ingredients, indexes, recipes.length]);

  const sampleRecipe = recipes[0];

  return (
    <details className="accordion" open={false}>
      <summary>DATASET DIAGNOSTICS (DEV)</summary>
      <div className="accordion-body helper">
        <div>Total recipes: {recipes.length}</div>
        <div>Total ingredients: {ingredients.length}</div>
        <div>
          Sample recipe: {sampleRecipe?.name || "n/a"} (ingredientIds: {sampleRecipe?.ingredientIds?.length || 0})
        </div>
        <div>
          Index keys — mealType: {diagnostics.keyCounts.mealType}, dietFlag: {diagnostics.keyCounts.dietFlag}, ingredientId: {diagnostics.keyCounts.ingredientId}
        </div>
        <div>Random index reference check — invalid refs: {diagnostics.invalidReferenceCount}</div>
        <div>
          Categories: {Object.entries(diagnostics.categoryDistribution)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ") || "n/a"}
        </div>
      </div>
    </details>
  );
}
