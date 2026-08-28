import test from "node:test";
import assert from "node:assert/strict";

import { normalizePage, normalizeWalletAddress } from "../api/_lib/xpoints.js";
import { calculateYtTotalPnl, collectCandidateMarketKeys, marketIsMatured, splitYtCapital, summarizeYtHistory } from "../api/pendle.js";
import { calculateExponentPnl, normalizeExponentTrades } from "../api/exponent.js";

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

test("official realized net gain is combined with the reopened YT bag's unrealized PnL", () => {
  const pnl = calculateYtTotalPnl({
    aggregateNetGainUsd: -75.28854273166279,
    isClosed: false,
    historyRealizedPnlUsd: -75.29,
    currentYtValueUsd: 7.8029755,
    claimedYieldUsd: 221.72030586,
    unclaimedYieldUsd: 0,
    entryCostUsd: 11.40703732
  });
  assert.ok(Math.abs(pnl - (-78.89260455166279)) < 1e-9);
});

test("open YT PnL includes its marked price loss and unclaimed yield", () => {
  const pnl = calculateYtTotalPnl({
    aggregateNetGainUsd: 13.960143616784674,
    isClosed: false,
    historyRealizedPnlUsd: 13.960143616784674,
    currentYtValueUsd: 12.195274227493032,
    claimedYieldUsd: 13.960143616784674,
    unclaimedYieldUsd: 18.832555170906165,
    entryCostUsd: 67.02698497062788
  });
  assert.ok(Math.abs(pnl - (-22.039011955444008)) < 1e-9);
});

test("new live YT markets are tracked before PnL and transaction indexing catches up", () => {
  const keys = collectCandidateMarketKeys([], [{ chainId: 1, openPositions: [{ marketId: "1-0xNEW", yt: { valuation: 12 } }] }], new Map());
  assert.deepEqual([...keys], ["1-0xnew"]);
});

test("matured markets are recognized even when an aggregate YT balance remains", () => {
  assert.equal(marketIsMatured("2026-08-27T00:00:00.000Z", Date.parse("2026-08-27T01:00:00.000Z")), true);
  assert.equal(marketIsMatured("2026-11-26T00:00:00.000Z", Date.parse("2026-08-27T01:00:00.000Z")), false);
});

test("matured YT PnL subtracts acquisition cost because there is no exit trade", () => {
  const pnl = calculateYtTotalPnl({
    aggregateNetGainUsd: 32.940205266603954,
    isClosed: true,
    isMatured: true,
    historyRealizedPnlUsd: 32.940205266603954,
    currentYtValueUsd: 0,
    unclaimedYieldUsd: 0,
    entryCostUsd: 67.02698497062788
  });
  assert.ok(Math.abs(pnl - (-34.086779704023925)) < 1e-9);
});

test("normalizePage falls back to the first page", () => {
  for (const value of [undefined, null, "", "nope", "0", "-4"]) {
    assert.equal(normalizePage(value), 1);
  }
});

test("Exponent YT trades are normalized from raw token amounts", () => {
  const trades = normalizeExponentTrades([{ vault_address: "vault", trade_ts: "2026-08-01", is_buy: true, in_amount: "625000000", out_amount: "10000000000", price: "0.0625" }], { vaultAddress: "vault", decimals: 8 });
  assert.deepEqual(trades.map(({ type, ytAmount, assetAmount }) => ({ type, ytAmount, assetAmount })), [{ type: "buy", ytAmount: 100, assetAmount: 6.25 }]);
});

test("Exponent PnL retains proportional cost basis after a partial sale", () => {
  const pnl = calculateExponentPnl([
    { type: "buy", ytAmount: 100, assetAmount: 6 },
    { type: "buy", ytAmount: 100, assetAmount: 8 },
    { type: "sell", ytAmount: 50, assetAmount: 4 }
  ], 1, 0.08);
  assert.equal(pnl.unitsHeld, 150);
  assert.equal(pnl.costBasisAsset, 10.5);
  assert.equal(pnl.realizedPnlAsset, 0.5);
  assert.equal(pnl.totalPnlAsset, 3);
});
