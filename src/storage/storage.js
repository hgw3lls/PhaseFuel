const USER_KEY_PREFIX = "phasefuel:user:";
const USER_KEY_SUFFIX = ":v2";
const STORAGE_VERSION = 2;

const getUserStorageKey = (userId) => `${USER_KEY_PREFIX}${String(userId || "").trim()}${USER_KEY_SUFFIX}`;
const getMigrationFlagKey = (userId) => `phasefuel:migrated:v2:${String(userId || "").trim()}`;

const safeJsonParse = (raw, fallback = null) => {
  if (!raw || typeof raw !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
};

const sanitizeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const lowered = key.toLowerCase();
      if (lowered.includes("apikey") || lowered.includes("api_key") || lowered.includes("openai")) {
        return acc;
      }
      acc[key] = sanitizeValue(item);
      return acc;
    }, {});
  }
  return value;
};

const mergeNonNull = (base = {}, incoming = {}) => {
  const next = { ...base };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      next[key] = value;
    }
  });
  return next;
};

const normalizeUserData = (userId, candidate = {}) => {
  const profile = candidate?.profile && typeof candidate.profile === "object" ? candidate.profile : {};
  const plans = Array.isArray(candidate?.plans) ? candidate.plans : [];
  return {
    version: STORAGE_VERSION,
    userId: String(userId || "").trim(),
    profile: sanitizeValue(profile),
    plans: sanitizeValue(plans),
  };
};

export const loadUserData = (userId) => {
  const key = getUserStorageKey(userId);
  const parsed = safeJsonParse(localStorage.getItem(key), null);
  return normalizeUserData(userId, parsed || {});
};

export const saveUserData = (userId, data) => {
  const key = getUserStorageKey(userId);
  const normalized = normalizeUserData(userId, data);
  localStorage.setItem(key, JSON.stringify(normalized));
  return normalized;
};

export const exportUserData = (userId) => JSON.stringify(loadUserData(userId), null, 2);

export const importUserData = (userId, json, options = {}) => {
  const incomingRaw = typeof json === "string" ? safeJsonParse(json, null) : json;
  if (!incomingRaw || typeof incomingRaw !== "object") {
    throw new Error("Invalid import payload.");
  }

  const current = loadUserData(userId);
  const incoming = normalizeUserData(userId, incomingRaw);

  const keepCurrentProfile = options?.confirmProfileOverwrite !== true;
  const profile = keepCurrentProfile
    ? mergeNonNull(current.profile, incoming.profile)
    : mergeNonNull(incoming.profile, current.profile);

  const byIdentity = new Map();
  [...current.plans, ...incoming.plans].forEach((plan) => {
    const identity = `${plan?.startDate || ""}:${plan?.generatedAt || ""}:${plan?.source || ""}`;
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, plan);
    }
  });

  const merged = {
    ...current,
    profile,
    plans: Array.from(byIdentity.values()),
  };

  return saveUserData(userId, merged);
};

export const resetUserData = (userId) => {
  localStorage.removeItem(getUserStorageKey(userId));
  localStorage.removeItem(getMigrationFlagKey(userId));
};

export { getMigrationFlagKey, getUserStorageKey, normalizeUserData, STORAGE_VERSION };
