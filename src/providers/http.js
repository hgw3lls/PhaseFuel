export const createThrottledRequester = ({
  minIntervalMs = 0,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) => {
  if (!fetchImpl) throw new Error("fetch unavailable");

  let lastAt = 0;
  let queue = Promise.resolve();
  const inflight = new Map();

  const request = (key, requestFactory) => {
    const dedupeKey = String(key || "");
    if (inflight.has(dedupeKey)) return inflight.get(dedupeKey);

    const run = queue.then(async () => {
      const waitMs = Math.max(0, minIntervalMs - (now() - lastAt));
      if (waitMs > 0) await sleep(waitMs);
      lastAt = now();
      return requestFactory(fetchImpl);
    });

    const wrapped = run.finally(() => {
      if (inflight.get(dedupeKey) === wrapped) inflight.delete(dedupeKey);
    });
    inflight.set(dedupeKey, wrapped);
    queue = wrapped.catch(() => undefined);
    return wrapped;
  };

  return { request };
};
