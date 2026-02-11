/**
 * @typedef {Object} Nutrients
 * @property {number} calories
 * @property {number} protein
 * @property {number} carbs
 * @property {number} fat
 * @property {Record<string, number> | undefined} micros
 */

/**
 * @typedef {Object} NutritionFood
 * @property {string} id
 * @property {string} source
 * @property {string} name
 * @property {string | undefined} servingSize
 * @property {Nutrients} nutrients
 */

/**
 * @typedef {Object} FoodHit
 * @property {string} id
 * @property {string} source
 * @property {string} name
 * @property {string | undefined} servingSize
 * @property {Nutrients | undefined} nutrients
 * @property {string | undefined} barcode
 */

/**
 * @typedef {Object} INutritionProvider
 * @property {(query: string) => Promise<FoodHit[]>} searchFoods
 * @property {(foodId: string, amount?: {value: number, unit?: string}) => Promise<Nutrients>} getNutrition
 */

export {};
