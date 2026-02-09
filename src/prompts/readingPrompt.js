const buildReadingPrompt = ({ plannerJson, cycleInfo, moonInfo }) => {
  const cycleLine = cycleInfo?.phase
    ? `Cycle phase: ${cycleInfo.phase}. Next: ${cycleInfo.nextPhase} on ${new Date(
        cycleInfo.nextPhaseDate
      ).toLocaleDateString()}.`
    : "Cycle phase is unknown; interpret the omen anyway.";
  const moonLine = moonInfo?.phase
    ? `Moon phase: ${moonInfo.name}. Next: ${moonInfo.nextPhaseName} on ${new Date(
        moonInfo.nextPhaseDate
      ).toLocaleDateString()}.`
    : "Moon phase is unknown; keep the tone mystical.";

  return [
    "Reading pass: write a short occult reading that frames the plan mythically but ties to practical actions.",
    cycleLine,
    moonLine,
    "Use the planner JSON below as the source of truth for meals, grocery list, and prep steps:",
    plannerJson,
    "Avoid medical claims. End with a short disclaimer: folklore + general nutrition guidance, not medical advice.",
  ].join("\n\n");
};

export { buildReadingPrompt };
