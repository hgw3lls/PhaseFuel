# PhaseFuel

PhaseFuel started as a backend service for generating cycle-aware meal plans. This repo now also includes a Vite + React brutalist web app that runs entirely in the browser so it can be deployed on GitHub Pages.

## Web App (Vite + React)

The web app uses the OpenAI API directly from the browser. Plans are saved locally in `localStorage` by user ID.

### Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

### Build + deploy to GitHub Pages

```bash
npm run build
```

The build outputs to the `docs/` folder, which GitHub Pages can serve.

1. In your GitHub repo settings, enable GitHub Pages.
2. Choose the `main` branch and `/docs` folder as the source.
3. Save and visit the URL that GitHub Pages provides.

## Backend API (original)

The FastAPI backend in `main.py` still expects Firebase credentials and an OpenAI API key.

```bash
export FIREBASE_CREDENTIALS="<base64 JSON>"
export OPENAI_API_KEY="<api key>"
python main.py
```
