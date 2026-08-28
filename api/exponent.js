import { sendError, setCache } from "./_lib/xpoints.js";

const API = "https://api.exponent.finance";
const APP = "https://app.exponent.finance";
const STRCX_MINT = "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH";
const STRCX_VAULT = "Hg3tQ8gy3bxyzwJz3vvqPbojpxwDt8ie6p7Cy4c3gAJR";
const isSolanaAddress = (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || "");
const units = (value, decimals) => Number(value || 0) / 10 ** decimals;

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "xStocks-Points-Intelligence/1.0" } });
  if (!response.ok) throw Object.assign(new Error(`Exponent data returned ${response.status}`), { status: response.status });
  return response.json();
}

export function normalizeExponentTrades(rows, market) {
  const decimals = Number(market.decimals ?? market.underlyingAsset?.decimals ?? 8);
  return (rows || []).filter((row) => row.vault_address === market.vaultAddress && !(row.is_buy && ["clmm_classic", "amm_classic"].includes(row.venue))).map((row) => {
    const input = units(row.in_amount, decimals);
    const output = units(row.out_amount, decimals);
    return { id: row.execution_id, timestamp: row.trade_ts, type: row.is_buy ? "buy" : "sell", ytAmount: row.is_buy ? output : input, assetAmount: row.is_buy ? input : output, priceAsset: Number(row.price || 0), impliedApy: Number(row.implied_yield || 0), signatures: row.tx_signatures || [] };
  }).filter((trade) => trade.ytAmount > 0).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function calculateExponentPnl(trades, claimedYieldAsset, currentYtPriceAsset) {
  let unitsHeld = 0, costBasisAsset = 0, realizedPnlAsset = 0, lifetimeSpentAsset = 0, lifetimeProceedsAsset = 0;
  for (const trade of trades) {
    if (trade.type === "buy") {
      unitsHeld += trade.ytAmount; costBasisAsset += trade.assetAmount; lifetimeSpentAsset += trade.assetAmount;
    } else {
      const disposed = Math.min(unitsHeld, trade.ytAmount);
      const disposedCost = unitsHeld > 0 ? costBasisAsset * disposed / unitsHeld : 0;
      const proceeds = trade.assetAmount * (trade.ytAmount > 0 ? disposed / trade.ytAmount : 0);
      realizedPnlAsset += proceeds - disposedCost; lifetimeProceedsAsset += trade.assetAmount;
      unitsHeld = Math.max(0, unitsHeld - disposed); costBasisAsset = Math.max(0, costBasisAsset - disposedCost);
    }
  }
  const currentValueAsset = unitsHeld * Number(currentYtPriceAsset || 0);
  const totalPnlAsset = realizedPnlAsset + Number(claimedYieldAsset || 0) + currentValueAsset - costBasisAsset;
  return { unitsHeld, costBasisAsset, currentValueAsset, realizedPnlAsset, claimedYieldAsset: Number(claimedYieldAsset || 0), totalPnlAsset, lifetimeSpentAsset, lifetimeProceedsAsset };
}

function claimedInterest(rows, market) {
  const decimals = Number(market.decimals ?? 8);
  return (rows || []).filter((row) => row.vault_address === market.vaultAddress && row.action === "claim" && row.type === "farm" && row.claim_type === "interest").reduce((sum, row) => sum + units(row.in_amount, decimals), 0);
}

function strcxUsdPrice(data) {
  const pairs = (data?.pairs || []).filter((pair) => pair.chainId === "solana" && pair.baseToken?.address === STRCX_MINT && pair.quoteToken?.symbol === "USDC");
  return Number(pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0]?.priceUsd || 0);
}

export async function getExponentAnalytics(address) {
  if (!isSolanaAddress(address)) throw Object.assign(new Error("Exponent analytics requires a Solana wallet"), { status: 400 });
  const marketsResponse = await getJson(`${API}/markets`);
  const market = (Array.isArray(marketsResponse) ? marketsResponse : marketsResponse?.markets || []).find((item) => item.vaultAddress === STRCX_VAULT);
  if (!market) throw new Error("Exponent STRCx 16NOV26 market is unavailable");
  const [tradeRows, yieldRows, priceData] = await Promise.all([
    getJson(`${APP}/api/trades/user/yt/${encodeURIComponent(address)}`),
    getJson(`${APP}/api/distributed-yield/user/${encodeURIComponent(address)}`).catch((error) => error.status === 404 ? null : Promise.reject(error)),
    getJson(`https://api.dexscreener.com/latest/dex/tokens/${STRCX_MINT}`).catch(() => ({ pairs: [] }))
  ]);
  const trades = normalizeExponentTrades(tradeRows, market);
  const yieldIndexed = Array.isArray(yieldRows);
  const claimedYieldAsset = claimedInterest(yieldRows || [], market);
  if (!trades.length && !claimedYieldAsset) return { positions: [] };
  const assetUsd = strcxUsdPrice(priceData);
  const pnl = calculateExponentPnl(trades, claimedYieldAsset, market.ytPriceInAsset);
  const toUsd = (value) => assetUsd ? value * assetUsd : null;
  return { positions: [{ venue: "Exponent", name: "STRCx", vault: market.vaultAddress, ytMint: market.ytMint, expiry: new Date(Number(market.maturityDateUnixTs) * 1000).toISOString(), trades: trades.length, yieldIndexed, impliedApy: market.impliedApy ?? null, underlyingApy: market.underlyingApy ?? null, ytPriceAsset: Number(market.ytPriceInAsset || 0), assetUsd, ...pnl, costBasisUsd: toUsd(pnl.costBasisAsset), currentValueUsd: toUsd(pnl.currentValueAsset), realizedPnlUsd: toUsd(pnl.realizedPnlAsset), claimedYieldUsd: toUsd(pnl.claimedYieldAsset), totalPnlUsd: toUsd(pnl.totalPnlAsset) }] };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const address = String(req.query.address || "").trim();
  if (!isSolanaAddress(address)) return res.status(400).json({ error: "Exponent analytics requires a Solana wallet" });
  try { const analytics = await getExponentAnalytics(address); setCache(res, 120); return res.status(200).json(analytics); }
  catch (error) { return sendError(res, error, "Failed to fetch Exponent analytics"); }
}
