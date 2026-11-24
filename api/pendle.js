import { getPendleJson, normalizeWalletAddress, sendError, setCache } from "./_lib/xpoints.js";
import { assetId, loadRewardPricing, summarizeDistributedRewards, sumKnownValues } from "./_lib/pendle-rewards.js";
import { getCapitalTransfers, traceYtCapital } from "./_lib/pendle-capital.js";

const hasYtActivity = (position) => Number(position.ytData?.unit || 0) !== 0 || Number(position.ytData?.spent_v2?.usd || 0) !== 0;
const YT_ACTIONS = new Set(["buyYt", "sellYt", "buyYtLimitOrder", "sellYtLimitOrder", "transferYtIn", "transferYtOut", "redeemYtYield"]);
const positionKey = ({ chainId, market }) => `${chainId}-${String(market).toLowerCase()}`;

export function collectCandidateMarketKeys(pnlPositions, livePositions, transactionsByMarket) {
  return new Set([
    ...(pnlPositions || []).filter(hasYtActivity).map(positionKey),
    ...(livePositions || []).flatMap((chain) => (chain.openPositions || []).filter((position) => position.yt).map((position) => String(position.marketId).toLowerCase())),
    ...transactionsByMarket.keys()
  ]);
}

export function marketIsMatured(expiry, now = Date.now()) {
  const maturity = Date.parse(expiry || "");
  return Number.isFinite(maturity) && maturity <= now;
}

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
    if (["sellYt", "sellYtLimitOrder"].includes(transaction.action)) {
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

export function calculateYtTotalPnl({ aggregateNetGainUsd, isClosed, isMatured = false, historyRealizedPnlUsd, currentYtValueUsd, claimedYieldUsd, unclaimedYieldUsd, entryCostUsd }) {
  const officialNetGain = Number(aggregateNetGainUsd);
  const realizedPnl = aggregateNetGainUsd != null && Number.isFinite(officialNetGain)
    ? officialNetGain
    : Number(historyRealizedPnlUsd || claimedYieldUsd || 0);
  if (isMatured) return realizedPnl + Number(unclaimedYieldUsd || 0) - Number(entryCostUsd || 0);
  if (isClosed) return realizedPnl;
  return realizedPnl + Number(currentYtValueUsd || 0) + Number(unclaimedYieldUsd || 0) - Number(entryCostUsd || 0);
}

export async function getPendleAnalytics(address, getJson = getPendleJson, loadTransfers = getCapitalTransfers) {
  const [pnl, live, transactionHistory, merkle] = await Promise.all([
    getJson(`/v1/pnl/gained/${encodeURIComponent(address)}/positions`),
    getJson(`/v1/dashboard/positions/database/${encodeURIComponent(address)}`),
    getJson(`/v1/pnl/transactions?user=${encodeURIComponent(address)}&limit=1000`),
    getJson(`/v2/dashboard/merkle-rewards/${encodeURIComponent(address)}`).catch(() => null)
  ]);
  // The API caps both limit and skip at 1,000. Fetch the second page when
  // needed and expose an incomplete history rather than silently truncating it.
  if (transactionHistory.total > (transactionHistory.results || []).length && transactionHistory.results?.length === 1000) {
    const next = await getJson(`/v1/pnl/transactions?user=${encodeURIComponent(address)}&limit=1000&skip=1000`);
    transactionHistory.results.push(...(next.results || []));
  }
  const historyComplete = Number.isFinite(transactionHistory.total) && transactionHistory.total === (transactionHistory.results || []).length;
  const rewardsAvailable = Array.isArray(merkle?.rewards);
  const aggregateByMarket = new Map((pnl.positions || []).map((position) => [positionKey(position), position]));
  const transactionsByMarket = new Map();
  for (const transaction of transactionHistory.results || []) {
    if (!YT_ACTIONS.has(transaction.action) || !transaction.market) continue;
    const key = positionKey(transaction);
    if (!transactionsByMarket.has(key)) transactionsByMarket.set(key, []);
    transactionsByMarket.get(key).push(transaction);
  }
  const liveByMarket = new Map((live.positions || []).flatMap((chain) => (chain.openPositions || []).map((position) => [position.marketId.toLowerCase(), position])));
  const candidateKeys = collectCandidateMarketKeys(pnl.positions, live.positions, transactionsByMarket);
  if (!candidateKeys.size) return { positions: [] };

  const ids = [...candidateKeys].join(",");
  const markets = await getJson(`/v2/markets/all?ids=${encodeURIComponent(ids)}&limit=100`);
  const marketById = new Map((markets.results || []).map((market) => [`${market.chainId}-${market.address.toLowerCase()}`, market]));
  const xStocksKeys = [...candidateKeys].filter((key) => {
    const market = marketById.get(key);
    return String(market?.protocol || "").toLowerCase() === "xstocks" || (market?.points || []).some(({ key }) => String(key).toLowerCase() === "xstocks");
  }).sort((a, b) => {
    const liveDifference = Number(liveByMarket.has(b)) - Number(liveByMarket.has(a));
    if (liveDifference) return liveDifference;
    const expiryDifference = Date.parse(marketById.get(b)?.expiry || 0) - Date.parse(marketById.get(a)?.expiry || 0);
    if (expiryDifference) return expiryDifference;
    const latest = (key) => new Date(summarizeYtHistory(transactionsByMarket.get(key) || []).latestTimestamp || 0);
    return latest(b) - latest(a);
  }).slice(0, 10);
  if (!xStocksKeys.length) return { positions: [] };
  const rewardRows = (merkle?.rewards || []).filter((row) => xStocksKeys.includes(String(row.assetId || "").toLowerCase()));
  const claimTokenIds = [...new Set([
    ...xStocksKeys.flatMap((key) => (liveByMarket.get(key)?.yt?.claimTokenAmounts || []).map(({ token }) => assetId(marketById.get(key).chainId, token))),
    ...rewardRows.map((row) => assetId(row.chainId, row.token))
  ])];
  const { assets: claimAssetById, prices: claimPrices } = await loadRewardPricing(claimTokenIds, getJson);
  const fundingByMarket = new Map(await Promise.all(xStocksKeys.map(async (key) => {
    const market = marketById.get(key);
    const underlying = String(market.underlyingAsset || "").split("-")[1];
    if (!rewardsAvailable || market.chainId !== 1 || !underlying || !rewardRows.some((row) => row.assetId?.toLowerCase() === key && row.token?.toLowerCase() === underlying.toLowerCase() && Number(row.total?.claimed) > 0)) return [key, null];
    try {
      const transfers = await loadTransfers({ address, token: underlying, chainId: market.chainId });
      return [key, traceYtCapital({ address, market, history: transactionsByMarket.get(key) || [], rewards: rewardRows, transfers })];
    } catch { return [key, null]; }
  })));

  return { positions: xStocksKeys.map((key) => {
    const market = marketById.get(key);
    const position = aggregateByMarket.get(key);
    const history = transactionsByMarket.get(key) || [];
    const historySummary = summarizeYtHistory(history);
    const capital = splitYtCapital(history);
    const capitalFunding = fundingByMarket.get(key);
    const livePosition = liveByMarket.get(key);
    const aggregateBalance = Number(position?.ytData?.unit || 0);
    const balance = livePosition || aggregateBalance > 0 ? aggregateBalance || historySummary.balance : 0;
    const matured = marketIsMatured(market?.expiry);
    const isClosed = matured || (!livePosition && balance <= 1e-12);
    const aggregateCost = position?.ytData?.spent_v2 || {};
    const entryCostUsd = isClosed ? historySummary.peakCostUsd : Number(aggregateCost.usd || historySummary.peakCostUsd);
    const entryCostAsset = isClosed ? historySummary.peakCostAsset : Number(aggregateCost.asset || historySummary.peakCostAsset);
    const unclaimedYield = (livePosition?.yt?.claimTokenAmounts || []).map(({ token, amount }) => {
      const id = assetId(market.chainId, token);
      const asset = claimAssetById.get(id);
      const units = Number(amount) === 0 ? 0 : Number.isInteger(asset?.decimals) ? Number(amount) / 10 ** asset.decimals : null;
      const price = claimPrices[id];
      return { token: id, symbol: asset?.symbol || "SY", amount: units, usd: units === 0 ? 0 : units != null && price != null ? units * Number(price) : null };
    });
    const distributedRewards = summarizeDistributedRewards(rewardRows, key, claimAssetById, claimPrices);
    const distributedClaimedUsd = rewardsAvailable ? sumKnownValues(distributedRewards, "claimedUsd") : null;
    const distributedClaimableUsd = rewardsAvailable ? sumKnownValues(distributedRewards, "claimableUsd") : null;
    const directUnclaimedUsd = sumKnownValues(unclaimedYield, "usd");
    const unclaimedYieldUsd = directUnclaimedUsd != null && distributedClaimableUsd != null ? directUnclaimedUsd + distributedClaimableUsd : null;
    // The aggregate is market-wide. Do not label it as verified YT PnL for
    // a mixed PT/LP/YT history, or substitute current reward prices for history.
    const otherActivity = [position?.ptData, position?.lpData].some((data) => Number(data?.unit || 0) !== 0 || Number(data?.spent_v2?.usd || 0) !== 0) ||
      (transactionHistory.results || []).some((tx) => positionKey(tx) === key && /^(buyPt|sellPt|transferPt|addLiquidity|removeLiquidity|transferLp)/.test(tx.action));
    const aggregatePresent = position?.pnl?.netGain?.usd != null && Number.isFinite(Number(position.pnl.netGain.usd));
    const pnlComplete = historyComplete && rewardsAvailable && unclaimedYieldUsd != null && !otherActivity &&
      (aggregatePresent || distributedRewards.every((reward) => reward.claimed === 0));
    const currentYtValueUsd = Number(livePosition?.yt?.valuation || 0);
    const aggregateNetGainUsd = position?.pnl?.netGain?.usd;
    const ytTotalPnlUsd = pnlComplete ? calculateYtTotalPnl({
      aggregateNetGainUsd,
      isClosed,
      isMatured: matured,
      historyRealizedPnlUsd: historySummary.realizedPnlUsd,
      currentYtValueUsd,
      claimedYieldUsd: historySummary.claimedYieldUsd,
      unclaimedYieldUsd,
      entryCostUsd
    }) : null;
    return {
      chainId: market.chainId,
      market: market.address,
      name: market?.name || "Pendle market",
      protocol: market?.protocol || null,
      expiry: market?.expiry || null,
      balance,
      closed: isClosed,
      matured,
      entryCostUsd,
      entryCostAsset,
      peakCapitalUsd: historySummary.peakCostUsd,
      baseBagAsset: capitalFunding?.otherCapitalAsset ?? capital.baseAsset,
      baseBagUsd: capitalFunding?.otherCapitalUsd ?? capital.baseUsd,
      reinvestedBagAsset: capitalFunding?.reinvestedAsset ?? capital.reinvestedAsset,
      reinvestedBagUsd: capitalFunding?.reinvestedUsd ?? capital.reinvestedUsd,
      capitalFunding,
      averageEntryAsset: (balance || historySummary.peakUnits) > 0 ? entryCostAsset / (balance || historySummary.peakUnits) : null,
      claimedYieldUsd: historySummary.claimedYieldUsd,
      claimedYieldAsset: historySummary.claimedYieldAsset,
      yieldClaims: historySummary.yieldClaims,
      distributedRewards,
      distributedClaimedUsd,
      distributedClaimableUsd,
      rewardsAvailable,
      historyComplete,
      pnlComplete,
      pnlWarning: pnlComplete ? null : otherActivity ? "Market also contains PT or LP activity; YT-only PnL cannot be isolated." : "Reward pricing or position history is incomplete; total PnL is unavailable.",
      soldUnits: historySummary.soldUnits,
      exitProceedsAsset: historySummary.exitProceedsAsset,
      exitProceedsUsd: historySummary.exitProceedsUsd,
      averageExitAsset: historySummary.averageExitAsset,
      unclaimedYield,
      unclaimedYieldUsd,
      currentYtValueUsd,
      ytTotalPnlUsd,
      marketNetGainUsd: Number(aggregateNetGainUsd ?? historySummary.realizedPnlUsd),
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
