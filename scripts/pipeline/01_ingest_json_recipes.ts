import fs from "fs";
import path from "path";

const normalizeToken = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const inputPath = path.join("scripts", "pipeline", "input", "recipes.sample.json");
const outputPath = path.join("data", "out", "recipes.parsed.jsonl");

const rawData = fs.readFileSync(inputPath, "utf-8");
const recipes = JSON.parse(rawData);

const parsed = recipes.map((recipe) => {
  const ingredientTokens = recipe.ingredients.map(normalizeToken);
  return {
    ...recipe,
    ingredientTokens,
  };
});

fs.writeFileSync(
  outputPath,
  parsed.map((record) => JSON.stringify(record)).join("\n") + "\n"
);

console.info(`Parsed ${parsed.length} recipes -> ${outputPath}`);
