import http from "node:http";
import { URL } from "node:url";
import { buildNarrativeFallbackPayload } from "../src/config/narrative.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_TEMPERATURE = 0.2;

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

const port = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

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

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
          temperature: parseTemperature(process.env.OPENAI_TEMPERATURE),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!response.ok) {
        sendJson(res, 200, fallbackResponse("Upstream error"));
        return;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(content);
      sendJson(res, 200, parsed);
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
