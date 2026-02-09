export type IngredientRecord = {
  token: string;
  aliases: string[];
  gluten: boolean;
  fodmap: "low" | "caution" | "high";
  animal: "none" | "fish" | "meat" | "dairy" | "egg";
  notes?: string;
};

export type LowFodmapMode = "off" | "moderate" | "strict";

const normalize = (value: string) => value.toLowerCase().trim();

const buildLookup = (catalog: IngredientRecord[]) => {
  const lookup = new Map<string, IngredientRecord>();
  catalog.forEach((record) => {
    lookup.set(normalize(record.token), record);
    record.aliases.forEach((alias) => {
      lookup.set(normalize(alias), record);
    });
  });
  return lookup;
};

export const resolveIngredientTokens = (
  ingredients: string[],
  catalog: IngredientRecord[]
): string[] => {
  const lookup = buildLookup(catalog);
  return ingredients.map((ingredient) => {
    const key = normalize(ingredient);
    return lookup.get(key)?.token ?? key;
  });
};

export const compileAllowed = (
  profile: {
    dietPattern: "omnivore" | "pescatarian" | "vegetarian" | "vegan";
    glutenFree: boolean;
  },
  ingredientCatalog: IngredientRecord[],
  strictness: LowFodmapMode
) => {
  const allowedTokens = new Set<string>();
  const forbiddenTokens = new Set<string>();
  const cautionTokens = new Set<string>();
  const warnings: string[] = [];

  ingredientCatalog.forEach((ingredient) => {
    const token = normalize(ingredient.token);

    if (profile.glutenFree) {
      const isUnsafeOats = token === "oats" && ingredient.gluten;
      if (ingredient.gluten || isUnsafeOats) {
        forbiddenTokens.add(token);
        if (isUnsafeOats) {
          warnings.push("Oats can be unsafe unless explicitly gluten-free.");
        }
        return;
      }
    }

    if (strictness === "strict" && ingredient.fodmap !== "low") {
      forbiddenTokens.add(token);
      if (ingredient.fodmap === "caution") {
        cautionTokens.add(token);
      }
      return;
    }

    if (strictness === "moderate" && ingredient.fodmap === "high") {
      forbiddenTokens.add(token);
      return;
    }

    if (ingredient.fodmap === "caution") {
      cautionTokens.add(token);
    }

    if (profile.dietPattern === "vegan" && ingredient.animal !== "none") {
      forbiddenTokens.add(token);
      return;
    }

    if (
      profile.dietPattern === "vegetarian" &&
      (ingredient.animal === "meat" || ingredient.animal === "fish")
    ) {
      forbiddenTokens.add(token);
      return;
    }

    if (profile.dietPattern === "pescatarian" && ingredient.animal === "meat") {
      forbiddenTokens.add(token);
      return;
    }

    allowedTokens.add(token);
  });

  return { allowedTokens, forbiddenTokens, cautionTokens, warnings };
};
