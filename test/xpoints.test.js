import test from "node:test";
import assert from "node:assert/strict";

import { normalizePage } from "../api/_lib/xpoints.js";

test("normalizePage accepts positive integer-like values", () => {
  assert.equal(normalizePage("7"), 7);
  assert.equal(normalizePage("7.9"), 7);
  assert.equal(normalizePage(3), 3);
});

test("normalizePage falls back to the first page", () => {
  for (const value of [undefined, null, "", "nope", "0", "-4"]) {
    assert.equal(normalizePage(value), 1);
  }
});
