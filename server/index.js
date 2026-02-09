import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

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

const fallbackResponse = (reason = "AI unavailable") => ({
  summaryText: `Deterministic plan generated. ${reason}. Not medical advice.`,
  dayNotes: [],
  groceryByAisle: [],
  substitutions: [],
});

app.post("/api/planNarrative", async (req, res) => {
  const { profileSummary, weekStartISO, weeklyPlanJson, allowedTokens } = req.body || {};
  if (!profileSummary || !weekStartISO || !weeklyPlanJson || !Array.isArray(allowedTokens)) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(200).json(fallbackResponse("Missing OPENAI_API_KEY"));
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
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      res.status(200).json(fallbackResponse("Upstream error"));
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    res.status(200).json(parsed);
  } catch (error) {
    res.status(200).json(fallbackResponse("Parsing failed"));
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.info(`Narrative server listening on ${port}`);
});
