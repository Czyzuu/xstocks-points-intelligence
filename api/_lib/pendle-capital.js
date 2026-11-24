const DISTRIBUTOR = "0x33305665f69b4642d1275f4ce81c23651674d21c";
const BUY_ACTIONS = new Set(["buyYt", "buyYtLimitOrder"]);
const cache = new Map();

// The explorer is used only for funding attribution. Failure must not change
// the independently calculated PnL or turn an unknown split into fresh capital.
export async function getCapitalTransfers({ address, token, chainId }) {
  if (chainId !== 1 || !/^0x[a-f0-9]{40}$/i.test(token)) return null;
  const key = `${address.toLowerCase()}-${token.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < 300000) return cached.data;
  let cursor = {}, items = [];
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ type: "ERC-20", token, ...cursor });
    const response = await fetch(`https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}/token-transfers?${query}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data.items)) return null;
    items.push(...data.items);
    if (!data.next_page_params) {
      const result = { items, complete: true };
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      cache.set(key, { time: Date.now(), data: result });
      return result;
    }
    cursor = data.next_page_params;
  }
  return null; // More than 250 transfers: do not guess from a truncated history.
}

export function traceYtCapital({ address, market, history, rewards, transfers }) {
  if (!transfers?.complete || market.chainId !== 1) return null;
  const wallet = address.toLowerCase();
  const token = String(market.underlyingAsset || "").split("-")[1];
  if (!token) return null;
  const rows = rewards.filter((row) => row.chainId === market.chainId && String(row.token).toLowerCase() === token.toLowerCase() && BigInt(row.total?.claimed || "0") > 0n);
  // Claimed campaign totals do not identify individual payout transactions.
  // Attribute them only when exactly one market earned this token and the
  // onchain receipts reconcile to that market's total, without any remainder.
  if (rows.length !== 1 || String(rows[0].assetId).toLowerCase() !== `${market.chainId}-${market.address.toLowerCase()}` ||
    history.some((tx) => ["redeemYtYield", "sellYt", "sellYtLimitOrder", "transferYtOut"].includes(tx.action))) return null;
  const buys = new Map();
  for (const tx of history.filter((tx) => BUY_ACTIONS.has(tx.action))) {
    if (!tx.txHash || !(tx.txValueAsset > 0) || !(tx.assetUsd > 0)) return null;
    const hash = tx.txHash.toLowerCase();
    if (buys.has(hash)) return null; // Batched same-market purchases need finer attribution.
    buys.set(hash, tx);
  }
  if (!buys.size || history.some((tx) => tx.action === "transferYtIn" && !buys.has(String(tx.txHash).toLowerCase()))) return null;
  const events = transfers.items.filter((tx) => tx.token?.address_hash?.toLowerCase() === token.toLowerCase())
    .sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  const seen = new Set(), paidByBuy = new Map();
  let rawClaims = 0n, availableYield = 0, grossAsset = 0, grossUsd = 0, reinvestedAsset = 0, reinvestedUsd = 0;
  const reinvestments = [];
  for (const event of events) {
    const hash = event.transaction_hash.toLowerCase();
    const id = `${hash}-${event.log_index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const raw = event.total?.value, decimals = Number(event.total?.decimals);
    if (typeof raw !== "string" || !/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
    const amount = Number(raw) / 10 ** decimals;
    if (event.to?.hash?.toLowerCase() === wallet && event.from?.hash?.toLowerCase() === DISTRIBUTOR) {
      availableYield += amount;
      rawClaims += BigInt(raw);
    }
    if (event.from?.hash?.toLowerCase() !== wallet || event.to?.hash?.toLowerCase() === wallet) continue;
    const usedYield = Math.min(amount, availableYield);
    availableYield = Math.max(0, availableYield - usedYield);
    const buy = buys.get(hash);
    if (!buy) continue; // Yield withdrawn or spent elsewhere cannot fund a later YT buy.
    paidByBuy.set(hash, (paidByBuy.get(hash) || 0) + amount);
    grossAsset += amount;
    grossUsd += amount * Number(buy.assetUsd);
    reinvestedAsset += usedYield;
    reinvestedUsd += usedYield * Number(buy.assetUsd);
    if (usedYield > 0) reinvestments.push({ txHash: hash, timestamp: event.timestamp, asset: usedYield, usd: usedYield * Number(buy.assetUsd) });
  }
  if (rawClaims !== BigInt(rows[0].total.claimed)) return null;
  for (const [hash, buy] of buys) {
    if (!paidByBuy.has(hash) || Math.abs(paidByBuy.get(hash) - Number(buy.txValueAsset)) > 1e-9 * Math.max(1, Number(buy.txValueAsset))) return null;
  }
  return { method: "yield-first", scope: "this-market", grossAsset, grossUsd, reinvestedAsset, reinvestedUsd,
    otherCapitalAsset: grossAsset - reinvestedAsset, otherCapitalUsd: grossUsd - reinvestedUsd, reinvestments };
}
