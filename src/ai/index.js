import { generateViaByok } from "./providers/byok";
import { generateViaProxy } from "./providers/proxy";

export const AI_MODE = {
  HOSTED: "HOSTED",
  BYOK: "BYOK",
};

export const generateNarrative = async (payload, { mode = AI_MODE.HOSTED, apiKey } = {}) => {
  if (mode === AI_MODE.BYOK) {
    return generateViaByok(payload, apiKey);
  }

  return generateViaProxy(payload);
};
