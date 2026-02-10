import fs from "node:fs";
import path from "node:path";

const publicDir = path.resolve("public");
const dataDir = path.join(publicDir, "data");

const datasetMap = {
  "recipes.phasefuel.canonical.v3.json": "recipes.phasefuel.canonical.json",
  "ingredients.canonical.catalog.v3.json": "ingredients.canonical.catalog.json",
  "recipes.indexes.v3.json": "recipes.indexes.json",
  "ingredient.alias.map.v3.json": "ingredient.alias.map.json",
};

fs.mkdirSync(dataDir, { recursive: true });

const missingSources = [];

for (const [sourceName, targetName] of Object.entries(datasetMap)) {
  const source = path.join(publicDir, sourceName);
  const target = path.join(dataDir, targetName);

  if (!fs.existsSync(source)) {
    missingSources.push(sourceName);
    continue;
  }

  fs.copyFileSync(source, target);
}

if (missingSources.length) {
  console.error("Build data preparation failed: missing source dataset files in public/.");
  missingSources.forEach((file) => console.error(` - public/${file}`));
  process.exit(1);
}

console.log("Build data preparation complete: dataset files are synced to public/data.");
