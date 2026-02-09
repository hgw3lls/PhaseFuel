# PhaseFuel

PhaseFuel started as a backend service for generating cycle-aware meal plans. This repo now also includes a static web app that runs entirely in the browser so it can be deployed on GitHub Pages.

## Web App (GitHub Pages)

The static web app lives in the `docs/` folder and uses the OpenAI API directly from the browser. Plans are saved locally in `localStorage` by user ID.

### Run locally

```bash
python3 -m http.server --directory docs 8000
```

Then open `http://localhost:8000` in your browser.

### Deploy to GitHub Pages

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
