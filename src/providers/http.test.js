import test from "node:test";
import assert from "node:assert/strict";
import { createThrottledRequester } from "./http.js";

test("throttling + coalescing prevent rapid duplicate work", async () => {
  let nowValue = 0;
  const sleepDurations = [];
  let workCalls = 0;

  const requester = createThrottledRequester({
    minIntervalMs: 50,
    fetchImpl: async () => ({ ok: true }),
    now: () => nowValue,
    sleep: async (ms) => {
      sleepDurations.push(ms);
      nowValue += ms;
    },
  });

  const work = async () => {
    workCalls += 1;
    return "ok";
  };

  await Promise.all([
    requester.request("dup", work),
    requester.request("dup", work),
    requester.request("dup", work),
  ]);
  assert.equal(workCalls, 1);

  await requester.request("a", work);
  nowValue += 10;
  await requester.request("b", work);
  assert.ok(sleepDurations.some((ms) => ms >= 40));
});
