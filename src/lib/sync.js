const PHASE_ANCHORS = {
  menstrual: 0,
  follicular: 2,
  ovulatory: 4,
  luteal: 6,
};

export const computeSyncScore = (cyclePhase, moonPhaseIndex) => {
  const anchor = PHASE_ANCHORS[cyclePhase] ?? 0;
  const distance = Math.abs(anchor - moonPhaseIndex);
  const normalized = 1 - Math.min(distance, 4) / 4;
  return Math.round(normalized * 100);
};
