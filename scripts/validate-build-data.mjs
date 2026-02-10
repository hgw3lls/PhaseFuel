import fs from "node:fs";
import path from "node:path";

const required = [
  "recipes.phasefuel.canonical.json",
  "ingredients.canonical.catalog.json",
  "recipes.indexes.json",
  "ingredient.alias.map.json",
];

const distDir = path.resolve("dist", "data");

const missing = required.filter((file) => !fs.existsSync(path.join(distDir, file)));

if (missing.length) {
  console.error("Build output validation failed: missing required dataset files in dist/data.");
  missing.forEach((file) => console.error(` - dist/data/${file}`));
  console.error("Ensure files exist under public/data and BASE_URL is configured for GitHub Pages.");
  process.exit(1);
}

console.log("Build output validation passed: required dataset files are present in dist/data.");
