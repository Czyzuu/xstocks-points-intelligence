import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { getPendleAnalytics as fetchPendleAnalytics } from "../api/pendle.js";
const getPendleAnalytics = (address, api) => fetchPendleAnalytics(address, api, async () => structuredClone(fixture.fundingTransfers));
import { summarizeDistributedRewards } from "../api/_lib/pendle-rewards.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/strcx-distributed-rewards.json", import.meta.url), "utf8"));
const market = fixture.markets.results[0];
const key = `1-${market.address}`;

function mockApi(overrides = {}) {
  return async (path) => {
    if (path.startsWith("/v2/dashboard/merkle-rewards/")) {
      if (overrides.failRewards) throw new Error("Reward feed unavailable");
      return structuredClone(overrides.rewards || fixture.rewards);
    }
    if (path.startsWith("/v1/pnl/gained/")) return structuredClone(overrides.gains || fixture.gains);
    if (path.startsWith("/v1/dashboard/positions/")) return structuredClone(fixture.live);
    if (path.startsWith("/v1/pnl/transactions?")) return structuredClone(overrides.history || fixture.history);
    if (path.startsWith("/v2/markets/all?")) return structuredClone(fixture.markets);
    if (path.startsWith("/v1/assets/all?")) return { assets: [] }; // raw reward tokens are not enumerated here
    if (path.startsWith("/v1/prices/assets?")) return structuredClone(overrides.prices || fixture.prices);
    const asset = fixture.assets.find((asset) => path === `/v1/${asset.chainId}/assets/${asset.address.toLowerCase()}`);
    if (asset) return structuredClone(asset);
    throw new Error(`Unexpected API call: ${path}`);
  };
}

test("STRCx distributed totals reconcile with four Ethereum payouts missing from direct claim history", async () => {
  const { positions: [position] } = await getPendleAnalytics(fixture.wallet, mockApi());
  const reward = position.distributedRewards.find((reward) => reward.symbol === "STRCx");
  const raw = fixture.rewards.rewards.find((reward) => reward.token === market.underlyingAsset.slice(2)).total.claimed;
  const onchain = fixture.verifiedStrcxPayouts.reduce((sum, tx) => sum + BigInt(tx.amount), 0n);
  assert.equal(onchain, BigInt(raw));
  assert.ok(Math.abs(reward.claimed - 0.9415410861086961) < 1e-15);
  assert.equal(position.yieldClaims, 0); // not fabricated from campaign totals
  assert.equal(position.claimedYieldUsd, 0); // direct-interest history only
  assert.equal(position.distributedRewards.length, 2); // STRCx and a separate PENDLE incentive
  assert.ok(position.distributedClaimedUsd > 92);
  assert.equal(position.pnlComplete, true);
  assert.equal(position.unclaimedYieldUsd, 0);
  // Historical aggregate gains already contain the distributed payout.
  const gains = fixture.gains.positions.find((row) => row.market === market.address).pnl.netGain.usd;
  assert.equal(position.ytTotalPnlUsd, gains + fixture.live.positions[0].openPositions[0].yt.valuation - position.entryCostUsd);
  assert.ok(Math.abs(position.ytTotalPnlUsd - (-105.82958880039942)) < 1e-9);
  assert.ok(Math.abs(position.capitalFunding.grossAsset - 2.0624494483088402) < 1e-10); // limit-order buys included
});

test("claimable distributions increase PnL once; claimed totals and open-window estimates do not", async () => {
  const rewards = structuredClone(fixture.rewards);
  rewards.rewards[1].total.claimable = "10000000000000000";
  rewards.rewards[1].total.unrealized = "30000000000000000";
  const { positions: [baseline] } = await getPendleAnalytics(fixture.wallet, mockApi());
  const { positions: [position] } = await getPendleAnalytics(fixture.wallet, mockApi({ rewards }));
  const delta = 0.01 * fixture.prices.prices[market.underlyingAsset];
  assert.ok(Math.abs(position.ytTotalPnlUsd - baseline.ytTotalPnlUsd - delta) < 1e-10);
});

test("funding lookup failure does not alter PnL and is shown as an unavailable split", async () => {
  const { positions: [normal] } = await getPendleAnalytics(fixture.wallet, mockApi());
  const { positions: [withoutFunding] } = await fetchPendleAnalytics(fixture.wallet, mockApi(), async () => null);
  assert.equal(withoutFunding.capitalFunding, null);
  assert.equal(withoutFunding.ytTotalPnlUsd, normal.ytTotalPnlUsd);
  assert.equal(withoutFunding.pnlComplete, true);
});

test("unavailable rewards, unpriced nonzero claimables, mixed positions and truncated history cannot produce confident PnL", async () => {
  const rewards = structuredClone(fixture.rewards);
  rewards.rewards[1].total.claimable = "10000000000000000";
  const gains = structuredClone(fixture.gains);
  gains.positions.find((row) => row.market === market.address).lpData.unit = 1;
  for (const options of [
    { failRewards: true },
    { prices: { prices: {} }, rewards },
    { history: { ...fixture.history, total: fixture.history.total + 1 } },
    { gains }
  ]) {
    const { positions: [position] } = await getPendleAnalytics(fixture.wallet, mockApi(options));
    assert.equal(position.pnlComplete, false);
    assert.equal(position.ytTotalPnlUsd, null);
  }
});

test("reward units require metadata and belong to their exact chain and market", () => {
  const rows = [
    { chainId: 1, assetId: key, token: "0xToken", total: { claimed: "1200000", claimable: "0", unrealized: "0" } },
    { chainId: 10, assetId: `10-${market.address}`, token: "0xToken", total: { claimed: "999999999" } },
    { chainId: 1, title: "Unrelated campaign", token: "0xToken", total: { claimed: "999999999" } }
  ];
  const assets = new Map([["1-0xtoken", { decimals: 6, symbol: "USDC" }]]);
  const [known] = summarizeDistributedRewards(rows, key, assets, { "1-0xtoken": 1 });
  assert.equal(known.claimed, 1.2);
  assert.equal(known.claimedUsd, 1.2);
  assert.equal(summarizeDistributedRewards(rows, key, assets, {}).length, 1);
  assert.equal(summarizeDistributedRewards(rows, key, assets, {})[0].claimedUsd, null);
  assert.equal(summarizeDistributedRewards(rows, key, new Map(), {})[0].claimed, null);
});

test("UI shows distributed claims and does not render unavailable PnL as $0 or enable sharing", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const rendering = app.slice(app.indexOf("function pendleClaimedValue"), app.indexOf("function renderExponentAnalytics"));
  const context = vm.createContext({
    currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    percent: new Intl.NumberFormat("en-US", { style: "percent" }),
    fmt: (value) => String(value), escapeHtml: (value) => String(value)
  });
  vm.runInContext(rendering, context);
  const normal = await getPendleAnalytics(fixture.wallet, mockApi());
  const html = context.renderPendleAnalytics(normal);
  assert.match(html, /0\.9415411 STRCx/);
  assert.match(html, /DISTRIBUTED VALUE AT CURRENT PRICES/);
  assert.match(html, /\~\$92\.20/);
  assert.match(html, /OTHER FUNDING \$155\.84 · REINVESTED \$45\.58/);
  assert.match(html, /YIELD-FIRST ESTIMATE/);
  const incomplete = await getPendleAnalytics(fixture.wallet, mockApi({ failRewards: true }));
  const partial = context.renderPendleAnalytics(incomplete);
  assert.match(partial, /INCOMPLETE DATA/);
  assert.match(partial, /YT TOTAL PNL<\/dt><dd[^>]*>UNAVAILABLE/);
  assert.match(partial, /disabled title="Complete PnL data is unavailable"/);
});
