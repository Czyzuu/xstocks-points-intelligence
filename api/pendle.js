import { getPendleJson, normalizeWalletAddress, sendError, setCache } from "./_lib/xpoints.js";

const hasYtActivity = (position) => Number(position.ytData?.unit || 0) !== 0 || Number(position.ytData?.spent_v2?.usd || 0) !== 0;
const YT_ACTIONS = new Set(["buyYt", "sellYt", "transferYtIn", "transferYtOut", "redeemYtYield"]);
const positionKey = ({ chainId, market }) => `${chainId}-${String(market).toLowerCase()}`;

export function splitYtCapital(transactions) {
  const ordered = [...transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let previousSpentAsset = 0;
  let availableClaimedAsset = 0;
  let baseAsset = 0;
  let baseUsd = 0;
  let reinvestedAsset = 0;
  let reinvestedUsd = 0;
  for (const transaction of ordered) {
    if (transaction.action === "redeemYtYield") availableClaimedAsset += Math.max(0, Number(transaction.profit?.asset || 0));
    const spentAsset = Number(transaction.ytData?.spent_v2?.asset || 0);
    const addedAsset = Math.max(0, spentAsset - previousSpentAsset);
    if (addedAsset > 1e-12) {
      const reinvested = Math.min(addedAsset, availableClaimedAsset);
      const base = addedAsset - reinvested;
      const assetUsd = Number(transaction.assetUsd || 0);
      reinvestedAsset += reinvested;
      reinvestedUsd += reinvested * assetUsd;
      baseAsset += base;
      baseUsd += base * assetUsd;
      availableClaimedAsset -= reinvested;
    }
    previousSpentAsset = Math.max(previousSpentAsset, spentAsset);
  }
  return { baseAsset, baseUsd, reinvestedAsset, reinvestedUsd };
}

export function summarizeYtHistory(transactions) {
  const ordered = [...transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const claims = ordered.filter(({ action }) => action === "redeemYtYield");
  let previousUnits = 0;
  let soldUnits = 0;
  let exitProceedsAsset = 0;
  let exitProceedsUsd = 0;
  for (const transaction of ordered) {
    const units = Number(transaction.ytData?.unit || 0);
    if (transaction.action === "sellYt") {
      soldUnits += Math.max(0, previousUnits - units);
      const proceedsAsset = Number(transaction.txValueAsset || 0);
      exitProceedsAsset += proceedsAsset;
      exitProceedsUsd += proceedsAsset * Number(transaction.assetUsd || 0);
    }
    previousUnits = units;
  }
  return {
    balance: Number(ordered.at(-1)?.ytData?.unit || 0),
    peakUnits: ordered.reduce((max, transaction) => Math.max(max, Number(transaction.ytData?.unit || 0)), 0),
    peakCostUsd: ordered.reduce((max, transaction) => Math.max(max, Number(transaction.ytData?.spent_v2?.usd || 0)), 0),
    peakCostAsset: ordered.reduce((max, transaction) => Math.max(max, Number(transaction.ytData?.spent_v2?.asset || 0)), 0),
    claimedYieldUsd: claims.reduce((sum, claim) => sum + Number(claim.profit?.usd || 0), 0),
    claimedYieldAsset: claims.reduce((sum, claim) => sum + Number(claim.profit?.asset || 0), 0),
    yieldClaims: claims.length,
    soldUnits,
    exitProceedsAsset,
    exitProceedsUsd,
    averageExitAsset: soldUnits > 0 ? exitProceedsAsset / soldUnits : null,
    realizedPnlUsd: ordered.reduce((sum, transaction) => sum + Number(transaction.profit?.usd || 0), 0),
    latestTimestamp: ordered.at(-1)?.timestamp || null
  };
}

export async function getPendleAnalytics(address) {
  const [pnl, live, transactionHistory] = await Promise.all([
    getPendleJson(`/v1/pnl/gained/${encodeURIComponent(address)}/positions`),
    getPendleJson(`/v1/dashboard/positions/database/${encodeURIComponent(address)}`),
    getPendleJson(`/v1/pnl/transactions?user=${encodeURIComponent(address)}&limit=1000`)
  ]);
  const aggregateByMarket = new Map((pnl.positions || []).map((position) => [positionKey(position), position]));
  const transactionsByMarket = new Map();
  for (const transaction of transactionHistory.results || []) {
    if (!YT_ACTIONS.has(transaction.action) || !transaction.market) continue;
    const key = positionKey(transaction);
    if (!transactionsByMarket.has(key)) transactionsByMarket.set(key, []);
    transactionsByMarket.get(key).push(transaction);
  }
  const candidateKeys = new Set([
    ...(pnl.positions || []).filter(hasYtActivity).map(positionKey),
    ...transactionsByMarket.keys()
  ]);
  if (!candidateKeys.size) return { positions: [] };

  const ids = [...candidateKeys].join(",");
  const markets = await getPendleJson(`/v2/markets/all?ids=${encodeURIComponent(ids)}&limit=100`);
  const marketById = new Map((markets.results || []).map((market) => [`${market.chainId}-${market.address.toLowerCase()}`, market]));
  const xStocksKeys = [...candidateKeys].filter((key) => {
    const market = marketById.get(key);
    return String(market?.protocol || "").toLowerCase() === "xstocks" || (market?.points || []).some(({ key }) => String(key).toLowerCase() === "xstocks");
  }).sort((a, b) => {
    const latest = (key) => new Date(summarizeYtHistory(transactionsByMarket.get(key) || []).latestTimestamp || 0);
    return latest(b) - latest(a);
  }).slice(0, 10);
  if (!xStocksKeys.length) return { positions: [] };
  const liveByMarket = new Map((live.positions || []).flatMap((chain) => (chain.openPositions || []).map((position) => [position.marketId.toLowerCase(), position])));
  const claimTokenIds = [...new Set(xStocksKeys.flatMap((key) => liveByMarket.get(key)?.yt?.claimTokenAmounts || []).map(({ token }) => token))];
  const [claimAssets, claimPrices] = claimTokenIds.length ? await Promise.all([
    getPendleJson(`/v1/assets/all?ids=${encodeURIComponent(claimTokenIds.join(","))}`),
    getPendleJson(`/v1/prices/assets?ids=${encodeURIComponent(claimTokenIds.join(","))}`)
  ]) : [{ assets: [] }, { prices: {} }];
  const claimAssetById = new Map((claimAssets.assets || []).map((asset) => [`${asset.chainId}-${asset.address.toLowerCase()}`, asset]));

  return { positions: xStocksKeys.map((key) => {
    const market = marketById.get(key);
    const position = aggregateByMarket.get(key);
    const history = transactionsByMarket.get(key) || [];
    const historySummary = summarizeYtHistory(history);
    const capital = splitYtCapital(history);
    const livePosition = liveByMarket.get(key);
    const aggregateBalance = Number(position?.ytData?.unit || 0);
    const balance = livePosition || aggregateBalance > 0 ? aggregateBalance || historySummary.balance : 0;
    const isClosed = !livePosition && balance <= 1e-12;
    const aggregateCost = position?.ytData?.spent_v2 || {};
    const entryCostUsd = isClosed ? historySummary.peakCostUsd : Number(aggregateCost.usd || historySummary.peakCostUsd);
    const entryCostAsset = isClosed ? historySummary.peakCostAsset : Number(aggregateCost.asset || historySummary.peakCostAsset);
    const unclaimedYield = (livePosition?.yt?.claimTokenAmounts || []).map(({ token, amount }) => {
      const asset = claimAssetById.get(token.toLowerCase());
      const decimals = Number(asset?.decimals ?? 18);
      const units = Number(amount) / 10 ** decimals;
      return { token, symbol: asset?.symbol || "SY", amount: units, usd: units * Number(claimPrices.prices?.[token] || 0) };
    });
    const unclaimedYieldUsd = unclaimedYield.reduce((sum, item) => sum + item.usd, 0);
    const currentYtValueUsd = Number(livePosition?.yt?.valuation || 0);
    const ytTotalPnlUsd = isClosed ? historySummary.realizedPnlUsd : currentYtValueUsd + historySummary.claimedYieldUsd + unclaimedYieldUsd - entryCostUsd;
    return {
      chainId: market.chainId,
      market: market.address,
      name: market?.name || "Pendle market",
      protocol: market?.protocol || null,
      expiry: market?.expiry || null,
      balance,
      closed: isClosed,
      entryCostUsd,
      entryCostAsset,
      baseBagAsset: capital.baseAsset,
      baseBagUsd: capital.baseUsd,
      reinvestedBagAsset: capital.reinvestedAsset,
      reinvestedBagUsd: capital.reinvestedUsd,
      averageEntryAsset: (balance || historySummary.peakUnits) > 0 ? entryCostAsset / (balance || historySummary.peakUnits) : null,
      claimedYieldUsd: historySummary.claimedYieldUsd,
      claimedYieldAsset: historySummary.claimedYieldAsset,
      yieldClaims: historySummary.yieldClaims,
      soldUnits: historySummary.soldUnits,
      exitProceedsAsset: historySummary.exitProceedsAsset,
      exitProceedsUsd: historySummary.exitProceedsUsd,
      averageExitAsset: historySummary.averageExitAsset,
      unclaimedYield,
      unclaimedYieldUsd,
      currentYtValueUsd,
      ytTotalPnlUsd,
      marketNetGainUsd: Number(position?.pnl?.netGain?.usd ?? historySummary.realizedPnlUsd),
      underlyingApy: market?.details?.underlyingApy ?? null,
      impliedApy: market?.details?.impliedApy ?? null
    };
  }) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const address = normalizeWalletAddress(req.query.address);
  if (!address?.startsWith("0x")) return res.status(400).json({ error: "Pendle analytics requires an EVM wallet" });
  try {
    const analytics = await getPendleAnalytics(address);
    setCache(res, 300);
    return res.status(200).json(analytics);
  } catch (error) { return sendError(res, error, "Failed to fetch Pendle analytics"); }
}
