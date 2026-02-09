export const PHASE_GUIDANCE = {
  menstrual: {
    targetTags: ["warming", "iron-rich", "omega-3", "comforting", "gentle"],
    avoidTags: ["very-spicy", "high-sugar", "high-caffeine"],
  },
  follicular: {
    targetTags: ["fresh", "lean-protein", "fiber", "bright"],
    avoidTags: ["heavy", "greasy"],
  },
  ovulatory: {
    targetTags: ["antioxidant", "hydrating", "colorful", "high-fiber"],
    avoidTags: ["very-salty", "alcohol-heavy"],
  },
  luteal: {
    targetTags: ["magnesium", "stable-energy", "comforting", "complex-carb"],
    avoidTags: ["high-sugar", "ultra-processed"],
  },
};

export const SYMPTOM_TAGS = {
  cramps: ["magnesium", "anti-inflammatory", "warming"],
  bloating: ["low-sodium", "ginger", "anti-inflammatory"],
  cravings: ["complex-carb", "protein", "fiber"],
  insomnia: ["magnesium", "sleep-support", "calming"],
  fatigue: ["iron-rich", "stable-energy", "protein"],
  mood: ["omega-3", "comforting", "steady"],
  headache: ["hydrating", "anti-inflammatory"],
  nausea: ["gentle", "ginger", "light"],
};

export const normalizeSymptomTags = (symptoms = []) => {
  const tags = new Set();
  symptoms.forEach((symptom) => {
    const key = symptom.toLowerCase().trim();
    const mapped = SYMPTOM_TAGS[key];
    if (mapped) {
      mapped.forEach((tag) => tags.add(tag));
    }
  });
  return Array.from(tags);
};
