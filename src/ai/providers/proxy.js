export const generateViaProxy = async (payload) => {
  const response = await fetch("/api/planNarrative", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Narrative request failed.");
  }

  return response.json();
};
