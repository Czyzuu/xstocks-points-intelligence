import test from "node:test";
import assert from "node:assert/strict";

import { normalizePage, normalizeWalletAddress } from "../api/_lib/xpoints.js";
import { splitYtCapital, summarizeYtHistory } from "../api/pendle.js";

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

test("summarizeYtHistory preserves cost and realized PnL for a closed position", () => {
  const summary = summarizeYtHistory([
    { timestamp: "2026-06-01", action: "buyYt", profit: { usd: 0 }, ytData: { unit: 50, spent_v2: { usd: 140, asset: 1.5 } } },
    { timestamp: "2026-07-01", action: "redeemYtYield", profit: { usd: 110, asset: 1.1 }, ytData: { unit: 50, spent_v2: { usd: 140, asset: 1.5 } } },
    { timestamp: "2026-08-01", action: "sellYt", profit: { usd: -117 }, txValueAsset: 0.2, assetUsd: 100, ytData: { unit: 0, spent_v2: { usd: 0, asset: 0 } } }
  ]);
  assert.equal(summary.balance, 0);
  assert.equal(summary.peakUnits, 50);
  assert.equal(summary.peakCostUsd, 140);
  assert.equal(summary.claimedYieldUsd, 110);
  assert.equal(summary.exitProceedsUsd, 20);
  assert.equal(summary.averageExitAsset, 0.004);
  assert.equal(summary.realizedPnlUsd, -7);
});

test("normalizePage falls back to the first page", () => {
  for (const value of [undefined, null, "", "nope", "0", "-4"]) {
    assert.equal(normalizePage(value), 1);
  }
});
