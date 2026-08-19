import test from "node:test";
import assert from "node:assert/strict";

import { normalizePage, normalizeWalletAddress } from "../api/_lib/xpoints.js";
import { splitYtCapital } from "../api/pendle.js";

test("normalizePage accepts positive integer-like values", () => {
  assert.equal(normalizePage("7"), 7);
  assert.equal(normalizePage("7.9"), 7);
  assert.equal(normalizePage(3), 3);
});

test("normalizeWalletAddress accepts EVM and Solana wallets", () => {
  assert.equal(normalizeWalletAddress(" 0x37b0779a66edc491df83e59a56d485835323a555 "), "0x37b0779a66edc491df83e59a56d485835323a555");
  assert.equal(normalizeWalletAddress("HtJRbtFQPMitxmj4F7m4kSRo4nRFvb3KJZAopw7CXdzQ"), "HtJRbtFQPMitxmj4F7m4kSRo4nRFvb3KJZAopw7CXdzQ");
  assert.equal(normalizeWalletAddress("not-a-wallet"), null);
});

test("splitYtCapital separates fresh capital from claimed yield redeployed into YT", () => {
  const transactions = [
    { timestamp: "2026-07-01", action: "buyYt", assetUsd: 100, ytData: { spent_v2: { asset: 0.5 } } },
    { timestamp: "2026-07-15", action: "redeemYtYield", profit: { asset: 0.1 }, ytData: { spent_v2: { asset: 0.5 } } },
    { timestamp: "2026-08-01", action: "buyYt", assetUsd: 110, ytData: { spent_v2: { asset: 0.62 } } }
  ];
  const split = splitYtCapital(transactions);
  assert.ok(Math.abs(split.baseAsset - 0.52) < 1e-9);
  assert.ok(Math.abs(split.baseUsd - 52.2) < 1e-9);
  assert.ok(Math.abs(split.reinvestedAsset - 0.1) < 1e-9);
  assert.ok(Math.abs(split.reinvestedUsd - 11) < 1e-9);
});

test("normalizePage falls back to the first page", () => {
  for (const value of [undefined, null, "", "nope", "0", "-4"]) {
    assert.equal(normalizePage(value), 1);
  }
});
