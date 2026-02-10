/**
 * @typedef {Object} UserProfile
 * @property {string} id
 * @property {"omnivore"|"pescatarian"|"vegetarian"|"vegan"} dietPattern
 * @property {boolean} glutenFree
 * @property {boolean} lowFodmap
 * @property {number} fodmapStrictness
 * @property {string[]} avoidIngredients
 * @property {string[]} preferTags
 * @property {number} timeBudgetMin
 * @property {"tight"|"normal"|"generous"} budgetLevel
 */

/**
 * @typedef {Object} CycleSettings
 * @property {string} lastPeriodStart
 * @property {number} typicalCycleLength
 * @property {number} typicalLutealLength
 * @property {number} periodLength
 * @property {string} [lastOvulation]
 */

/**
 * @typedef {Object} DailyLog
 * @property {string} dateISO
 * @property {string[]} symptoms
 */

/**
 * @typedef {Object} Recipe
 * @property {string} id
 * @property {string} name
 * @property {"breakfast"|"lunch"|"dinner"|"snack"} mealType
 * @property {string[]} ingredients
 * @property {string[]} [ingredientTokens]
 * @property {string[]} [ingredientIds]
 * @property {string[]} tags
 * @property {number} timeMinutes
 * @property {"budget"|"balanced"|"premium"} costLevel
 * @property {number} servings
 * @property {boolean} leftovers
 * @property {boolean} batchable
 */

/**
 * @typedef {Object} PlannedMeal
 * @property {string} recipeId
 * @property {string} name
 * @property {"breakfast"|"lunch"|"dinner"|"snack"} mealType
 * @property {string[]} ingredients
 * @property {string[]} tags
 * @property {string[]} rationale
 */

/**
 * @typedef {Object} WeeklyPlanDay
 * @property {string} dateISO
 * @property {{breakfast?: PlannedMeal, lunch?: PlannedMeal, dinner?: PlannedMeal, snack?: PlannedMeal}} meals
 */

/**
 * @typedef {Object} WeeklyPlan
 * @property {string} startDateISO
 * @property {WeeklyPlanDay[]} days
 * @property {string[]} notes
 */

export {};
