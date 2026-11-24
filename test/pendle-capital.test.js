import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { traceYtCapital } from "../api/_lib/pendle-capital.js";
import { calculateYtTotalPnl } from "../api/pendle.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/strcx-distributed-rewards.json", import.meta.url), "utf8"));
const market = fixture.markets.results[0];
const history = fixture.history.results.filter((tx) => tx.market === market.address);
const input = { address: fixture.wallet, market, history, rewards: fixture.rewards.rewards, transfers: fixture.fundingTransfers };

test("November STRCx funding separates gross purchase cost from reinvested distributions", () => {
  const funding = traceYtCapital(input);
  assert.equal(funding.method, "yield-first");
  assert.equal(funding.reinvestments.length, 2);
  assert.ok(Math.abs(funding.grossUsd - 201.42177664956318) < 1e-9);
  assert.ok(Math.abs(funding.reinvestedUsd - 45.57839987432316) < 1e-9);
  assert.ok(Math.abs(funding.otherCapitalUsd - 155.84337677524002) < 1e-9);
  assert.ok(Math.abs(funding.reinvestedAsset - 0.4598930716889454) < 1e-12);
  assert.ok(Math.abs(funding.otherCapitalUsd + funding.reinvestedUsd - funding.grossUsd) < 1e-12);
  // The November payouts happened after both purchases and cannot finance them.
  assert.equal(funding.reinvestments.every((tx) => Date.parse(tx.timestamp) < Date.parse("2026-11-01")), true);
});

test("yield spent elsewhere is consumed before later YT purchases", () => {
  const modified = structuredClone(input);
  const claim = modified.transfers.items.find((tx) => tx.transaction_hash === "0xda1830dd7210d8006515f7e4aa7728828807224362cc20061b6cd5a0be260651");
  modified.transfers.items.push({ ...claim, block_number: claim.block_number + 1, log_index: 0,
    transaction_hash: "0xother-spending", from: { hash: fixture.wallet }, to: { hash: "0xelsewhere" } });
  const funding = traceYtCapital(modified);
  assert.equal(funding.reinvestments.length, 1);
  assert.ok(Math.abs(funding.reinvestedAsset - 0.1681906330444694) < 1e-12);
  assert.ok(funding.otherCapitalUsd > traceYtCapital(input).otherCapitalUsd);
});

test("unreconciled claims, ambiguous markets, missing purchases and truncated transfers do not invent a funding split", () => {
  const badTotals = structuredClone(input);
  badTotals.rewards.find((row) => row.token === market.underlyingAsset.slice(2)).total.claimed = "941541086108696149";
  const ambiguous = structuredClone(input);
  ambiguous.rewards.push({ ...ambiguous.rewards[1], assetId: "1-0xanother-market" });
  const missingBuy = structuredClone(input);
  missingBuy.transfers.items = missingBuy.transfers.items.filter((tx) => tx.transaction_hash !== "0xadf8b732c3a55768eca04fb0a602fdf3a5c29ed619b21ff4e095926f7bdf1603");
  for (const candidate of [badTotals, ambiguous, missingBuy, { ...input, transfers: { ...input.transfers, complete: false } }]) {
    assert.equal(traceYtCapital(candidate), null);
  }
});

test("a fully reinvested cashflow is not counted twice as both reduced capital and extra income", () => {
  // Initial input 100, claim 20, reinvest 20, remaining position worth 50.
  const grossPurchases = 120, claims = 20, reinvested = 20, currentValue = 50;
  const otherCapital = grossPurchases - reinvested;
  const grossBasisPnl = calculateYtTotalPnl({ aggregateNetGainUsd: claims, isClosed: false, currentYtValueUsd: currentValue, entryCostUsd: grossPurchases });
  const cashBasisPnl = calculateYtTotalPnl({ aggregateNetGainUsd: claims - reinvested, isClosed: false, currentYtValueUsd: currentValue, entryCostUsd: otherCapital });
  assert.equal(grossBasisPnl, -50);
  assert.equal(cashBasisPnl, grossBasisPnl);
  assert.notEqual(currentValue + claims - otherCapital, grossBasisPnl);
});
