import http from "node:http";
import { URL } from "node:url";
import { buildNarrativeFallbackPayload } from "../src/config/narrative.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_TEMPERATURE = 0.2;
const FDC_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

const createLruTtlCache = ({ max = 200, ttlMs = 30 * 60 * 1000 } = {}) => {
  const store = new Map();

  const get = (key) => {
    const current = store.get(key);
    if (!current) return null;
    if (Date.now() - current.cachedAt > ttlMs) {
      store.delete(key);
      return null;
    }
    store.delete(key);
    store.set(key, current);
    return current.value;
  };

  const set = (key, value) => {
    if (store.has(key)) store.delete(key);
    store.set(key, { value, cachedAt: Date.now() });
    if (store.size > max) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  };

  return { get, set };
};

const createSequentialThrottler = (minIntervalMs) => {
  let lastRun = 0;
  let queue = Promise.resolve();
  return (fn) => {
    queue = queue.then(async () => {
      const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRun));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastRun = Date.now();
      return fn();
    });
    return queue;
  };
};

const fdcCache = createLruTtlCache({ max: 300, ttlMs: 30 * 60 * 1000 });
// FDC default limit is 1000 requests/hour/IP (~1 request every 3.6s). We stay below with 4s spacing.
const throttleFdc = createSequentialThrottler(4000);

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Payload too large");
        error.statusCode = 413;
        req.destroy(error);
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        const parseError = new Error("Invalid JSON");
        parseError.statusCode = 400;
        reject(parseError);
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });

const buildPrompt = ({ profileSummary, weekStartISO, weeklyPlanJson, allowedTokens }) => {
  const schema = {
    summaryText: "string",
    dayNotes: [{ date: "YYYY-MM-DD", note: "string" }],
    groceryByAisle: [{ aisle: "string", items: ["string"] }],
    substitutions: [{ ingredient: "string", swap: "string" }],
  };

  return {
    system:
      "Only output valid JSON matching schema. Do not invent ingredients outside the plan’s recipes.",
    user: `Schema: ${JSON.stringify(schema)}\n\nProfile summary: ${profileSummary}\nWeek start: ${weekStartISO}\nAllowed ingredient tokens: ${allowedTokens.join(", ")}\nWeeklyPlan JSON: ${JSON.stringify(
      weeklyPlanJson
    )}\nDiet constraints: ${profileSummary}`,
  };
};

const parseTemperature = (value) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : DEFAULT_OPENAI_TEMPERATURE;
};

const fallbackResponse = (reason = "AI unavailable") =>
  buildNarrativeFallbackPayload({
    summaryContext: reason,
    dayNotes: [],
  });

const normalizeNarrative = (candidate, fallbackReason) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fallbackResponse(fallbackReason);
  }

  return {
    summaryText:
      typeof candidate.summaryText === "string" && candidate.summaryText.trim()
        ? candidate.summaryText
        : fallbackResponse(fallbackReason).summaryText,
    dayNotes: Array.isArray(candidate.dayNotes) ? candidate.dayNotes : [],
    groceryByAisle: Array.isArray(candidate.groceryByAisle) ? candidate.groceryByAisle : [],
    substitutions: Array.isArray(candidate.substitutions) ? candidate.substitutions : [],
  };
};

const extractResponseText = (responsePayload) => {
  if (typeof responsePayload?.output_text === "string" && responsePayload.output_text.trim()) {
    return responsePayload.output_text;
  }

  const output = Array.isArray(responsePayload?.output) ? responsePayload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (block?.type === "output_text" && typeof block.text === "string" && block.text.trim()) {
        return block.text;
      }
      if (block?.type === "text" && typeof block?.text?.value === "string" && block.text.value.trim()) {
        return block.text.value;
      }
    }
  }

  return "";
};

const port = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/fdc/search") {
    const apiKey = process.env.FDC_API_KEY;
    const query = String(url.searchParams.get("query") || "").trim();
    if (!apiKey) {
      sendJson(res, 500, { error: "Missing FDC_API_KEY" });
      return;
    }
    if (!query) {
      sendJson(res, 400, { error: "Missing query" });
      return;
    }

    const cacheKey = `search:${query.toLowerCase()}`;
    const cached = fdcCache.get(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    try {
      const payload = await throttleFdc(async () => {
        const response = await fetch(`${FDC_BASE_URL}/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, pageSize: 10 }),
        });
        if (!response.ok) {
          throw new Error(`FDC upstream search failed: ${response.status}`);
        }
        return response.json();
      });
      fdcCache.set(cacheKey, payload);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 502, { error: "FDC upstream error" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/fdc/food/")) {
    const apiKey = process.env.FDC_API_KEY;
    const foodId = url.pathname.split("/").pop();
    if (!apiKey) {
      sendJson(res, 500, { error: "Missing FDC_API_KEY" });
      return;
    }
    if (!foodId) {
      sendJson(res, 400, { error: "Missing food id" });
      return;
    }

    const cacheKey = `food:${foodId}`;
    const cached = fdcCache.get(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    try {
      const payload = await throttleFdc(async () => {
        const response = await fetch(
          `${FDC_BASE_URL}/food/${encodeURIComponent(foodId)}?api_key=${encodeURIComponent(apiKey)}`,
          { headers: { Accept: "application/json" } }
        );
        if (!response.ok) {
          throw new Error(`FDC upstream food failed: ${response.status}`);
        }
        return response.json();
      });
      fdcCache.set(cacheKey, payload);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 502, { error: "FDC upstream error" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/planNarrative") {
    let body = {};

    try {
      body = await readJsonBody(req);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      const message = statusCode === 413 ? "Payload too large." : "Invalid JSON.";
      sendJson(res, statusCode, { error: message });
      return;
    }

    const { profileSummary, weekStartISO, weeklyPlanJson, allowedTokens } = body || {};
    if (!profileSummary || !weekStartISO || !weeklyPlanJson || !Array.isArray(allowedTokens)) {
      sendJson(res, 400, { error: "Missing required fields." });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendJson(res, 200, fallbackResponse("Missing OPENAI_API_KEY"));
      return;
    }

    try {
      const { system, user } = buildPrompt({
        profileSummary,
        weekStartISO,
        weeklyPlanJson,
        allowedTokens,
      });

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
          temperature: parseTemperature(process.env.OPENAI_TEMPERATURE),
          input: [
            { role: "system", content: [{ type: "input_text", text: system }] },
            { role: "user", content: [{ type: "input_text", text: user }] },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        sendJson(res, 200, fallbackResponse("Upstream error"));
        return;
      }

      const data = await response.json();
      const outputText = extractResponseText(data);
      if (!outputText) {
        sendJson(res, 200, fallbackResponse("Response missing text output"));
        return;
      }

      try {
        const parsed = JSON.parse(outputText);
        sendJson(res, 200, normalizeNarrative(parsed, "Response shape invalid"));
      } catch (error) {
        sendJson(res, 200, fallbackResponse("Response JSON parse failed"));
      }
    } catch (error) {
      sendJson(res, 200, fallbackResponse("Parsing failed"));
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(port, () => {
  console.info(`Narrative server listening on ${port}`);
});
