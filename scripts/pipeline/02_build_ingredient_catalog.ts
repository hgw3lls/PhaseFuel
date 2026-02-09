import fs from "fs";
import path from "path";

const inputPath = path.join("data", "out", "recipes.parsed.jsonl");
const outputPath = path.join("data", "out", "ingredients.catalog.json");

const lines = fs.readFileSync(inputPath, "utf-8").trim().split("\n");
const counts = new Map();

lines.forEach((line) => {
  const record = JSON.parse(line);
  record.ingredientTokens.forEach((token) => {
    counts.set(token, (counts.get(token) || 0) + 1);
  });
});

const catalog = Array.from(counts.entries())
  .map(([token, count]) => ({
    token,
    aliases: [],
    count,
    gluten: false,
    fodmap: "low",
    animal: "none",
    notes: "placeholder",
  }))
  .sort((a, b) => b.count - a.count);

fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + "\n");
console.info(`Wrote ingredient catalog -> ${outputPath}`);
