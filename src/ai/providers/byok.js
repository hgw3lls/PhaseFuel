const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";

const buildInput = ({ profileSummary, weekStartISO, weeklyPlanJson, allowedTokens }) => {
  const instructions =
    "You are a meal planning assistant. Return only valid JSON with keys: summaryText (string), dayNotes (array of {date,note}), groceryByAisle (array of {aisle,items}), substitutions (array).";

  return [
    {
      role: "system",
      content: [{ type: "input_text", text: instructions }],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Profile summary: ${profileSummary}\nWeek start: ${weekStartISO}\nAllowed ingredient tokens: ${allowedTokens.join(
            ", "
          )}\nWeeklyPlan JSON: ${JSON.stringify(weeklyPlanJson)}`,
        },
      ],
    },
  ];
};

const parseResponseJson = (data) => {
  const directText = data?.output_text;
  if (directText) {
    return JSON.parse(directText);
  }

  const outputItem = data?.output?.find((item) => item?.type === "message");
  const textBlock = outputItem?.content?.find((item) => item?.type === "output_text");
  if (textBlock?.text) {
    return JSON.parse(textBlock.text);
  }

  throw new Error("Narrative response invalid.");
};

export const generateViaByok = async (payload, apiKey) => {
  if (!apiKey) {
    throw new Error("OpenAI API key is required.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: buildInput(payload),
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error("Narrative request failed.");
  }

  const data = await response.json();
  return parseResponseJson(data);
};
