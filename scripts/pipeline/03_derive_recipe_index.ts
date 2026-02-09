import fs from "fs";
import path from "path";

const inputPath = path.join("data", "out", "recipes.parsed.jsonl");
const outputPath = path.join("data", "out", "recipes.normalized.json");

const lines = fs.readFileSync(inputPath, "utf-8").trim().split("\n");

const deriveTags = (tokens) => {
  const tags = new Set();
  if (tokens.some((token) => token.includes("ginger"))) tags.add("ginger");
  if (tokens.some((token) => token.includes("salmon") || token.includes("tuna"))) {
    tags.add("omega-3");
  }
  if (tokens.some((token) => token.includes("spinach") || token.includes("lentils"))) {
    tags.add("iron-rich");
  }
  if (tokens.some((token) => token.includes("berries"))) tags.add("antioxidant");
  if (tokens.some((token) => token.includes("chia"))) tags.add("fiber");
  if (tokens.some((token) => token.includes("sweet potato"))) tags.add("complex-carb");
  if (tokens.some((token) => token.includes("olive oil"))) tags.add("comforting");
  return Array.from(tags);
};

const recipes = lines.map((line) => {
  const record = JSON.parse(line);
  return {
    id: record.id,
    name: record.name,
    mealType: record.mealType,
    ingredients: record.ingredients,
    tags: deriveTags(record.ingredientTokens),
    timeMinutes: record.timeMinutes,
    costLevel: record.costLevel,
    servings: record.servings,
    leftovers: record.leftovers,
    batchable: record.batchable,
  };
});

fs.writeFileSync(outputPath, JSON.stringify(recipes, null, 2) + "\n");
console.info(`Wrote normalized recipes -> ${outputPath}`);
