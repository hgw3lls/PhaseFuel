# PhaseFuel Datasets

## Required files (`public/data/`)

- `recipes.phasefuel.canonical.json` — canonical recipe records (includes `ingredientIds` / `ingredientTokens`).
- `ingredients.canonical.catalog.json` — canonical ingredient entities (`id`, `name`, `aliases`, `category`, `count`).
- `recipes.indexes.json` — precomputed index arrays keyed by meal type, diet flag, and ingredient id.
- `ingredient.alias.map.json` — raw token to canonical ingredient mapping.

## Index model

`recipes.indexes.json` stores arrays of recipe indices. Each number points to a position in the loaded recipes array. Filtering intersects index arrays first, then maps resulting indices to recipe objects.

## GitHub Pages / BASE_URL

Dataset fetches must use `import.meta.env.BASE_URL`:

```ts
const base = import.meta.env.BASE_URL;
fetch(`${base}data/recipes.phasefuel.canonical.json`)
```

Do not hardcode `/data/...` when deploying under a subpath.

## Regeneration

Regeneration pipeline docs are TODO; add project-specific commands here when finalized.
