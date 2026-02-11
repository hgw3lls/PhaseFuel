# .

. (pronounced Period) is a Vite + React single-page app with a deterministic meal-planning core and a constrained AI narration layer. Plans are generated locally from the embedded recipe dataset and stored in `localStorage` by user ID.

## Architecture

- **Deterministic planner (client)**: `/src/lib` houses the cycle, moon, and planner logic that scores recipes and generates weekly plans with constraints and variety penalties.
- **Local data**: `/data/out/recipes.normalized.json` and `/data/out/ingredients.catalog.json` seed the app with a starter dataset.
- **Constrained AI proxy (serverless)**: `/api/planNarrative` accepts a WeeklyPlan JSON payload and returns strictly formatted narrative output (summary, day notes, grocery by aisle, substitutions). The browser never sends secret keys directly to OpenAI.

## Disclaimers

. provides symbolic guidance and meal suggestions only. It is **not medical advice**, diagnosis, or treatment. If you have health concerns, consult a qualified professional.

## Privacy

- No API keys are stored in the browser.
- Weekly plans are stored locally in `localStorage`.
- The optional narrative formatter uses a backend proxy that reads the OpenAI key from environment variables.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL shown in your terminal (typically `http://localhost:5173`).

To enable AI narration locally, run the narrative server in another terminal:

```bash
OPENAI_API_KEY=... npm run server
```

## Build for production

```bash
npm run build
npm run preview
```

## Data pipeline notes

The app ships with starter data in `/data/out`. If you introduce a pipeline to normalize recipes or ingredients, ensure your output files are written to the same paths so the app can load them without external APIs.

### Dataset pipeline (self-contained)

. includes a local pipeline that can rebuild `/data/out` without any external network access:

```bash
npm run dataset:build
```

Pipeline stages live in `/scripts/pipeline`:

1. `01_ingest_json_recipes.ts` reads sample raw data from `scripts/pipeline/input/recipes.sample.json` and writes `data/out/recipes.parsed.jsonl`.
2. `02_build_ingredient_catalog.ts` builds `data/out/ingredients.catalog.json` with token counts and placeholder constraint fields.
3. `03_derive_recipe_index.ts` derives tags and outputs `data/out/recipes.normalized.json`.

### Adding new raw datasets later

To integrate a larger dataset (e.g., RecipeNLG or a CSV export), drop the raw file into `scripts/pipeline/input/`, update `01_ingest_json_recipes.ts` to parse it, and re-run `npm run dataset:build`. Keep the output schema stable so the app can import JSON directly at build time.
