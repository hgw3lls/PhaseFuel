const BATCH_TAGS = [
  "protein-base",
  "tray-roast",
  "soup-pot",
  "sauce-base",
  "grain-base",
  "stew",
];

const TRANSFORMATION_TAGS = ["wrap", "bowl", "salad", "soup", "fried-rice"];

/**
 * @typedef {Object} MealDetails
 * @property {string} name
 * @property {string[]} ingredients
 */

/**
 * @typedef {Object} LunchDetails
 * @property {string} name
 * @property {string[]} ingredients
 * @property {{day: number, dinner: string} | null} [leftoverFrom]
 * @property {string[]} [extraIngredients]
 */

/**
 * @typedef {Object} DinnerDetails
 * @property {string} name
 * @property {string[]} ingredients
 * @property {number} servingsCooked
 * @property {number} servingsDinner
 * @property {number} leftoverPortions
 * @property {string} batchTag
 * @property {string[]} transformationOptions
 * @property {boolean} [freezeFriendly]
 * @property {number} [freezePortions]
 */

/**
 * @typedef {Object} DayMeals
 * @property {MealDetails} breakfast
 * @property {LunchDetails} lunch
 * @property {DinnerDetails} dinner
 * @property {MealDetails} snacks
 */

/**
 * @typedef {Object} DayPlan
 * @property {number} day
 * @property {DayMeals} meals
 */

/**
 * @typedef {Object} LeftoverLink
 * @property {number} fromDayIndex
 * @property {number} toDayIndex
 * @property {"dinner"} fromMeal
 * @property {"lunch"} toMeal
 * @property {string} [transformationId]
 */

/**
 * @typedef {Object} MealPlan
 * @property {DayPlan[]} days
 * @property {LeftoverLink[]} leftoversGraph
 */

/**
 * @typedef {Object} GroceryListItem
 * @property {string} name
 * @property {string} qty
 * @property {string} unit
 * @property {string} category
 * @property {string[]} [notes]
 * @property {number} [estCost]
 * @property {string[]} [substitutions]
 */

/**
 * @typedef {Object} PlannerResponse
 * @property {MealPlan} mealPlan
 * @property {{items: GroceryListItem[], totals?: { estMin: number, estMax: number }}} groceryList
 * @property {string[]} prepSteps
 * @property {{min: number, max: number, currency: string} | null} estimatedCost
 */

const MEAL_PLAN_SCHEMA_EXAMPLE = {
  mealPlan: {
    days: [
      {
        day: 1,
        meals: {
          breakfast: { name: "", ingredients: [""] },
          lunch: {
            name: "",
            ingredients: [""],
            leftoverFrom: { day: 1, dinner: "" },
            extraIngredients: [""],
          },
          dinner: {
            name: "",
            ingredients: [""],
            servingsCooked: 4,
            servingsDinner: 2,
            leftoverPortions: 2,
            batchTag: "protein-base",
            transformationOptions: ["wrap", "bowl"],
            freezeFriendly: false,
            freezePortions: 0,
          },
          snacks: { name: "", ingredients: [""] },
        },
      },
    ],
    leftoversGraph: [
      {
        fromDayIndex: 1,
        toDayIndex: 2,
        fromMeal: "dinner",
        toMeal: "lunch",
        transformationId: "",
      },
    ],
  },
  groceryList: {
    items: [
      {
        name: "",
        qty: "",
        unit: "",
        category: "",
        notes: [""],
        estCost: 0,
        substitutions: [""],
      },
    ],
    totals: { estMin: 0, estMax: 0 },
  },
  prepSteps: [""],
  estimatedCost: { min: 0, max: 0, currency: "USD" },
};

const MEAL_PLAN_SCHEMA = `Return STRICT JSON with this shape and no extra commentary:

${JSON.stringify(
  MEAL_PLAN_SCHEMA_EXAMPLE,
  null,
  2
)}`;

const isString = (value) => typeof value === "string" && value.trim().length > 0;
const isStringArray = (value) => Array.isArray(value) && value.every(isString);

const validateMeal = (meal, errors, path) => {
  if (!meal || typeof meal !== "object") {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!isString(meal.name)) {
    errors.push(`${path}.name must be a non-empty string.`);
  }
  if (!isStringArray(meal.ingredients)) {
    errors.push(`${path}.ingredients must be an array of strings.`);
  }
};

const validateDinner = (dinner, errors, path) => {
  validateMeal(dinner, errors, path);
  if (typeof dinner?.servingsCooked !== "number" || dinner.servingsCooked < 1) {
    errors.push(`${path}.servingsCooked must be a number >= 1.`);
  }
  if (typeof dinner?.servingsDinner !== "number" || dinner.servingsDinner < 1) {
    errors.push(`${path}.servingsDinner must be a number >= 1.`);
  }
  if (typeof dinner?.leftoverPortions !== "number" || dinner.leftoverPortions < 1) {
    errors.push(`${path}.leftoverPortions must be a number >= 1.`);
  }
  if (!isString(dinner?.batchTag) || !BATCH_TAGS.includes(dinner.batchTag)) {
    errors.push(`${path}.batchTag must be one of ${BATCH_TAGS.join(", ")}.`);
  }
  if (!Array.isArray(dinner?.transformationOptions)) {
    errors.push(`${path}.transformationOptions must be an array.`);
  } else if (!dinner.transformationOptions.every((tag) => TRANSFORMATION_TAGS.includes(tag))) {
    errors.push(
      `${path}.transformationOptions must include only ${TRANSFORMATION_TAGS.join(", ")}.`
    );
  }
  if (typeof dinner?.freezeFriendly !== "undefined" && typeof dinner.freezeFriendly !== "boolean") {
    errors.push(`${path}.freezeFriendly must be a boolean when provided.`);
  }
  if (typeof dinner?.freezePortions !== "undefined" && typeof dinner.freezePortions !== "number") {
    errors.push(`${path}.freezePortions must be a number when provided.`);
  }
};

const validateLunch = (lunch, errors, path) => {
  validateMeal(lunch, errors, path);
  if (lunch?.leftoverFrom) {
    if (typeof lunch.leftoverFrom !== "object") {
      errors.push(`${path}.leftoverFrom must be an object when provided.`);
    } else {
      if (typeof lunch.leftoverFrom.day !== "number") {
        errors.push(`${path}.leftoverFrom.day must be a number.`);
      }
      if (!isString(lunch.leftoverFrom.dinner)) {
        errors.push(`${path}.leftoverFrom.dinner must be a string.`);
      }
    }
  }
  if (lunch?.extraIngredients && !isStringArray(lunch.extraIngredients)) {
    errors.push(`${path}.extraIngredients must be an array of strings when provided.`);
  }
};

const validateDay = (day, errors, index) => {
  if (typeof day?.day !== "number") {
    errors.push(`days[${index}].day must be a number.`);
  }
  if (!day?.meals || typeof day.meals !== "object") {
    errors.push(`days[${index}].meals must be an object.`);
    return;
  }
  validateMeal(day.meals.breakfast, errors, `days[${index}].meals.breakfast`);
  validateLunch(day.meals.lunch, errors, `days[${index}].meals.lunch`);
  validateDinner(day.meals.dinner, errors, `days[${index}].meals.dinner`);
  validateMeal(day.meals.snacks, errors, `days[${index}].meals.snacks`);
};

const validateLeftoverLink = (link, errors, index) => {
  if (!link || typeof link !== "object") {
    errors.push(`leftoversGraph[${index}] must be an object.`);
    return;
  }
  const fromDay = link.fromDayIndex ?? link.fromDay;
  const toDay = link.toDayIndex ?? link.toDay;
  if (typeof fromDay !== "number" || typeof toDay !== "number") {
    errors.push(`leftoversGraph[${index}] must include fromDayIndex and toDayIndex numbers.`);
  }
  if (link.fromMeal !== "dinner" || link.toMeal !== "lunch") {
    errors.push(`leftoversGraph[${index}] must map dinner to lunch.`);
  }
  if (link.transformationId && !isString(link.transformationId)) {
    errors.push(`leftoversGraph[${index}].transformationId must be a string when provided.`);
  }
};

const validateMealPlan = (plan) => {
  const errors = [];
  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["Meal plan must be an object."] };
  }
  if (!Array.isArray(plan.days) || plan.days.length === 0) {
    errors.push("days must be a non-empty array.");
  } else {
    plan.days.forEach((day, index) => validateDay(day, errors, index));
  }
  if (!Array.isArray(plan.leftoversGraph)) {
    errors.push("leftoversGraph must be an array.");
  } else {
    plan.leftoversGraph.forEach((link, index) => validateLeftoverLink(link, errors, index));
  }
  return { ok: errors.length === 0, errors };
};

const validateGroceryList = (list, errors) => {
  if (!list || typeof list !== "object") {
    errors.push("groceryList must be an object.");
    return;
  }
  if (!Array.isArray(list.items) || list.items.length === 0) {
    errors.push("groceryList.items must be a non-empty array.");
    return;
  }
  list.items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`groceryList.items[${index}] must be an object.`);
      return;
    }
    if (!isString(item.name)) {
      errors.push(`groceryList.items[${index}].name must be a non-empty string.`);
    }
    if (!isString(item.qty)) {
      errors.push(`groceryList.items[${index}].qty must be a non-empty string.`);
    }
    if (!isString(item.unit)) {
      errors.push(`groceryList.items[${index}].unit must be a non-empty string.`);
    }
    if (!isString(item.category)) {
      errors.push(`groceryList.items[${index}].category must be a non-empty string.`);
    }
    if (item.notes && !isStringArray(item.notes)) {
      errors.push(`groceryList.items[${index}].notes must be an array of strings when provided.`);
    }
    if (item.substitutions && !isStringArray(item.substitutions)) {
      errors.push(
        `groceryList.items[${index}].substitutions must be an array of strings when provided.`
      );
    }
  });
  if (list.totals) {
    if (typeof list.totals.estMin !== "number") {
      errors.push("groceryList.totals.estMin must be a number.");
    }
    if (typeof list.totals.estMax !== "number") {
      errors.push("groceryList.totals.estMax must be a number.");
    }
  }
};

const validatePlannerResponse = (payload) => {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["Planner response must be an object."] };
  }
  if (!payload.mealPlan) {
    errors.push("mealPlan is required.");
  } else {
    const mealPlanResult = validateMealPlan(payload.mealPlan);
    if (!mealPlanResult.ok) {
      errors.push(...mealPlanResult.errors);
    }
  }
  validateGroceryList(payload.groceryList, errors);
  if (!Array.isArray(payload.prepSteps) || payload.prepSteps.some((step) => !isString(step))) {
    errors.push("prepSteps must be an array of strings.");
  }
  if (payload.estimatedCost !== null && payload.estimatedCost !== undefined) {
    if (typeof payload.estimatedCost !== "object") {
      errors.push("estimatedCost must be an object when provided.");
    } else {
      if (typeof payload.estimatedCost.min !== "number") {
        errors.push("estimatedCost.min must be a number.");
      }
      if (typeof payload.estimatedCost.max !== "number") {
        errors.push("estimatedCost.max must be a number.");
      }
      if (!isString(payload.estimatedCost.currency)) {
        errors.push("estimatedCost.currency must be a string.");
      }
    }
  }

  return { ok: errors.length === 0, errors };
};

const normalizePlannerResponse = (payload) => {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (!payload.groceryList || !Array.isArray(payload.groceryList.items)) {
    return payload;
  }
  const normalizedItems = payload.groceryList.items.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const unit = typeof item.unit === "string" ? item.unit.trim() : "";
    return {
      ...item,
      unit: unit.length > 0 ? item.unit : "each",
    };
  });

  return {
    ...payload,
    groceryList: {
      ...payload.groceryList,
      items: normalizedItems,
    },
  };
};

const normalizeIngredient = (ingredient) => ingredient.trim().toLowerCase();

const addIngredient = (store, ingredient, source) => {
  const key = normalizeIngredient(ingredient);
  if (!key) {
    return;
  }
  if (!store.has(key)) {
    store.set(key, { name: ingredient.trim(), count: 0, sources: new Set() });
  }
  const entry = store.get(key);
  entry.count += 1;
  entry.sources.add(source);
};

const buildGroceryList = (plan) => {
  const store = new Map();
  if (!plan?.days) {
    return [];
  }

  plan.days.forEach((day) => {
    const { meals } = day;
    if (!meals) {
      return;
    }
    const breakfastSource = `Day ${day.day} breakfast`;
    meals.breakfast?.ingredients?.forEach((item) => addIngredient(store, item, breakfastSource));

    const dinnerSource = `Day ${day.day} dinner`;
    meals.dinner?.ingredients?.forEach((item) => addIngredient(store, item, dinnerSource));

    const lunchSource = `Day ${day.day} lunch`;
    if (meals.lunch?.leftoverFrom && Array.isArray(meals.lunch?.extraIngredients)) {
      meals.lunch.extraIngredients.forEach((item) => addIngredient(store, item, lunchSource));
    } else {
      meals.lunch?.ingredients?.forEach((item) => addIngredient(store, item, lunchSource));
    }

    const snackSource = `Day ${day.day} snacks`;
    meals.snacks?.ingredients?.forEach((item) => addIngredient(store, item, snackSource));
  });

  return Array.from(store.values())
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      sources: Array.from(entry.sources).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export {
  BATCH_TAGS,
  TRANSFORMATION_TAGS,
  MEAL_PLAN_SCHEMA,
  validateMealPlan,
  validatePlannerResponse,
  normalizePlannerResponse,
  buildGroceryList,
};
