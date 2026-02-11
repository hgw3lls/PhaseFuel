export const NARRATIVE_COPY = {
  fallbackSummaryPrefix: "Personalized plan generated",
  fallbackDisclaimer: "Not medical advice.",
  fallbackDayNoteTemplate: (phase) => `Focus on ${phase} phase support with simple prep.`,
};

export const buildNarrativeFallbackPayload = ({ summaryContext = "", dayNotes = [] } = {}) => {
  const suffix = summaryContext ? ` for ${summaryContext}` : "";
  return {
    summaryText: `${NARRATIVE_COPY.fallbackSummaryPrefix}${suffix}. ${NARRATIVE_COPY.fallbackDisclaimer}`,
    dayNotes,
    groceryByAisle: [],
    substitutions: [],
  };
};
