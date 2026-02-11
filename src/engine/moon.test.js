import test from "node:test";
import assert from "node:assert/strict";
import { getMoonPhaseName } from "./moon.js";

test("getMoonPhaseName maps phase boundaries", () => {
  assert.equal(getMoonPhaseName(0), "NEW");
  assert.equal(getMoonPhaseName(1 / 16), "WAXING_CRESCENT");
  assert.equal(getMoonPhaseName(3 / 16), "FIRST_QUARTER");
  assert.equal(getMoonPhaseName(5 / 16), "WAXING_GIBBOUS");
  assert.equal(getMoonPhaseName(7 / 16), "FULL");
  assert.equal(getMoonPhaseName(9 / 16), "WANING_GIBBOUS");
  assert.equal(getMoonPhaseName(11 / 16), "LAST_QUARTER");
  assert.equal(getMoonPhaseName(13 / 16), "WANING_CRESCENT");
  assert.equal(getMoonPhaseName(15 / 16), "NEW");
});
