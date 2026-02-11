import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { SettingsProvider } from "./settings.jsx";
import { ApiKeyProvider } from "./ai/ApiKeyContext.jsx";
import "./styles.css";

if (import.meta.env.DEV) {
  import("./lib/planner/dev.ts").then(({ runPlannerDemo }) => runPlannerDemo());
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SettingsProvider>
      <ApiKeyProvider>
        <App />
      </ApiKeyProvider>
    </SettingsProvider>
  </React.StrictMode>
);
