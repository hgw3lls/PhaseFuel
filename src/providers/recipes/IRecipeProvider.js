/**
 * Normalized recipe shape.
 * @typedef {Object} NormalizedRecipe
 * @property {string} id
 * @property {string} source
 * @property {string} name
 * @property {string | null} image
 * @property {string | undefined} url
 * @property {{name: string, measure: string}[]} ingredients
 * @property {string | undefined} instructions
 * @property {string[]} tags
 * @property {string | undefined} cuisine
 * @property {string | undefined} category
 * @property {{calories?: number, protein?: number, carbs?: number, fat?: number} | undefined} nutrition
 * @property {{name: string, link: string}} sourceAttribution
 */

/**
 * @typedef {Object} RecipeFilters
 * @property {string | undefined} cuisine
 * @property {string | undefined} category
 * @property {number | undefined} limit
 */

/**
 * @typedef {Object} IRecipeProvider
 * @property {string} name
 * @property {(query: string, filters?: RecipeFilters) => Promise<NormalizedRecipe[]>} search
 * @property {(id: string) => Promise<NormalizedRecipe | null>} getById
 * @property {(filters?: RecipeFilters) => Promise<NormalizedRecipe[]>} random
 */

export {};
