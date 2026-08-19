import { getPendleJson, normalizeWalletAddress, sendError, setCache } from "./_lib/xpoints.js";

const hasYtActivity = (position) => Number(position.ytData?.unit || 0) !== 0 || Number(position.ytData?.spent_v2?.usd || 0) !== 0;

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

export async function getPendleAnalytics(address) {
  const [pnl, live] = await Promise.all([
    getPendleJson(`/v1/pnl/gained/${encodeURIComponent(address)}/positions`),
    getPendleJson(`/v1/dashboard/positions/database/${encodeURIComponent(address)}`)
  ]);
  const positions = (pnl.positions || []).filter(hasYtActivity).slice(0, 10);
  if (!positions.length) return { positions: [] };

  const ids = positions.map(({ chainId, market }) => `${chainId}-${market}`).join(",");
  const markets = await getPendleJson(`/v2/markets/all?ids=${encodeURIComponent(ids)}&limit=20`);
  const marketById = new Map((markets.results || []).map((market) => [`${market.chainId}-${market.address.toLowerCase()}`, market]));
  const xStocksPositions = positions.filter((position) => {
    const market = marketById.get(`${position.chainId}-${position.market.toLowerCase()}`);
    return String(market?.protocol || "").toLowerCase() === "xstocks" || (market?.points || []).some(({ key }) => String(key).toLowerCase() === "xstocks");
  });
  if (!xStocksPositions.length) return { positions: [] };
  const liveByMarket = new Map((live.positions || []).flatMap((chain) => (chain.openPositions || []).map((position) => [position.marketId.toLowerCase(), position])));
  const claimTokenIds = [...new Set(xStocksPositions.flatMap((position) => liveByMarket.get(`${position.chainId}-${position.market.toLowerCase()}`)?.yt?.claimTokenAmounts || []).map(({ token }) => token))];
  const [claimAssets, claimPrices] = claimTokenIds.length ? await Promise.all([
    getPendleJson(`/v1/assets/all?ids=${encodeURIComponent(claimTokenIds.join(","))}`),
    getPendleJson(`/v1/prices/assets?ids=${encodeURIComponent(claimTokenIds.join(","))}`)
  ]) : [{ assets: [] }, { prices: {} }];
  const claimAssetById = new Map((claimAssets.assets || []).map((asset) => [`${asset.chainId}-${asset.address.toLowerCase()}`, asset]));
  const histories = await Promise.all(xStocksPositions.map(({ market }) => getPendleJson(`/v1/pnl/transactions?user=${encodeURIComponent(address)}&market=${encodeURIComponent(market)}&limit=1000`)));

  return { positions: xStocksPositions.map((position, index) => {
    const market = marketById.get(`${position.chainId}-${position.market.toLowerCase()}`);
    const claims = (histories[index].results || []).filter(({ action }) => action === "redeemYtYield");
    const capital = splitYtCapital(histories[index].results || []);
    const claimedYieldUsd = claims.reduce((sum, claim) => sum + Number(claim.profit?.usd || 0), 0);
    const claimedYieldAsset = claims.reduce((sum, claim) => sum + Number(claim.profit?.asset || 0), 0);
    const balance = Number(position.ytData?.unit || 0);
    const cost = position.ytData?.spent_v2 || {};
    const livePosition = liveByMarket.get(`${position.chainId}-${position.market.toLowerCase()}`);
    const unclaimedYield = (livePosition?.yt?.claimTokenAmounts || []).map(({ token, amount }) => {
      const asset = claimAssetById.get(token.toLowerCase());
      const decimals = Number(asset?.decimals ?? 18);
      const units = Number(amount) / 10 ** decimals;
      return { token, symbol: asset?.symbol || "SY", amount: units, usd: units * Number(claimPrices.prices?.[token] || 0) };
    });
    const unclaimedYieldUsd = unclaimedYield.reduce((sum, item) => sum + item.usd, 0);
    const currentYtValueUsd = Number(livePosition?.yt?.valuation || 0);
    const ytTotalPnlUsd = currentYtValueUsd + claimedYieldUsd + unclaimedYieldUsd - Number(cost.usd || 0);
    return {
      chainId: position.chainId,
      market: position.market,
      name: market?.name || "Pendle market",
      protocol: market?.protocol || null,
      expiry: market?.expiry || null,
      balance,
      entryCostUsd: Number(cost.usd || 0),
      entryCostAsset: Number(cost.asset || 0),
      baseBagAsset: capital.baseAsset,
      baseBagUsd: capital.baseUsd,
      reinvestedBagAsset: capital.reinvestedAsset,
      reinvestedBagUsd: capital.reinvestedUsd,
      averageEntryAsset: balance > 0 ? Number(cost.asset || 0) / balance : null,
      claimedYieldUsd,
      claimedYieldAsset,
      yieldClaims: claims.length,
      unclaimedYield,
      unclaimedYieldUsd,
      currentYtValueUsd,
      ytTotalPnlUsd,
      marketNetGainUsd: Number(position.pnl?.netGain?.usd || 0),
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
