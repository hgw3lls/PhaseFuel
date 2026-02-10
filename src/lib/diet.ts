export type IngredientRecord = {
  id?: string;
  name?: string;
  token?: string;
  aliases?: string[];
  gluten?: boolean;
  glutenFreeSafe?: boolean;
  fodmap?: "low" | "caution" | "high";
  fodmapLevel?: "low" | "caution" | "high";
  animal?: "none" | "fish" | "meat" | "dairy" | "egg";
  notes?: string;
};

export type LowFodmapMode = "off" | "moderate" | "strict";

const normalize = (value: string) => value.toLowerCase().trim();

const buildLookup = (catalog: IngredientRecord[]) => {
  const lookup = new Map<string, IngredientRecord>();
  catalog.forEach((record) => {
    const token = normalize(record.token || record.name || "");
    if (!token) return;
    lookup.set(token, record);
    (record.aliases || []).forEach((alias) => {
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
    const record = lookup.get(key);
    return normalize(record?.token || record?.name || "") || key;
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
    const token = normalize(ingredient.token || ingredient.name || "");
    if (!token) return;
    const fodmap = ingredient.fodmap || ingredient.fodmapLevel || "low";
    const animal = ingredient.animal || "none";
    const gluten = Boolean(ingredient.gluten);
    const glutenSafe = ingredient.glutenFreeSafe === true;

    if (profile.glutenFree) {
      const isUnsafeOats = token === "oats" && !glutenSafe;
      if (gluten || isUnsafeOats) {
        forbiddenTokens.add(token);
        if (isUnsafeOats) {
          warnings.push("Oats can be unsafe unless explicitly gluten-free.");
        }
        return;
      }
    }

    if (strictness === "strict" && fodmap !== "low") {
      forbiddenTokens.add(token);
      if (fodmap === "caution") {
        cautionTokens.add(token);
      }
      return;
    }

    if (strictness === "moderate" && fodmap === "high") {
      forbiddenTokens.add(token);
      return;
    }

    if (fodmap === "caution") {
      cautionTokens.add(token);
    }

    if (profile.dietPattern === "vegan" && animal !== "none") {
      forbiddenTokens.add(token);
      return;
    }

    if (
      profile.dietPattern === "vegetarian" &&
      (animal === "meat" || animal === "fish")
    ) {
      forbiddenTokens.add(token);
      return;
    }

    if (profile.dietPattern === "pescatarian" && animal === "meat") {
      forbiddenTokens.add(token);
      return;
    }

    allowedTokens.add(token);
  });

  return { allowedTokens, forbiddenTokens, cautionTokens, warnings };
};
