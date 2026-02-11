import { NARRATIVE_COPY, buildNarrativeFallbackPayload } from "../config/narrative";

export const buildFallbackNarrative = ({ weeklyPlan, profileSummary }) => {
  const dayNotes = weeklyPlan?.days?.map((day) => ({
    date: day.dateISO,
    note: NARRATIVE_COPY.fallbackDayNoteTemplate(day.phase),
  })) || [];

  return buildNarrativeFallbackPayload({
    summaryContext: profileSummary,
    dayNotes,
  });
};

export const requestPlanNarrative = async ({
  profileSummary,
  weekStartISO,
  weeklyPlanJson,
  allowedTokens,
  fallback,
}) => {
  try {
    const response = await fetch("/api/planNarrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileSummary, weekStartISO, weeklyPlanJson, allowedTokens }),
    });
    if (!response.ok) {
      throw new Error("Narrative request failed.");
    }
    const data = await response.json();
    if (!data?.summaryText) {
      throw new Error("Narrative response invalid.");
    }
    return data;
  } catch (error) {
    return fallback;
  }
};
