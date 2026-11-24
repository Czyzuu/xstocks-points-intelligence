// Merkle totals are raw reward-token amounts. Their current value is for display;
// Pendle's aggregate netGain already includes distributed rewards at its own basis.
export const assetId = (chainId, token) => String(token).includes("-")
  ? String(token).toLowerCase() : `${chainId}-${String(token).toLowerCase()}`;

export function summarizeDistributedRewards(rows, marketKey, assets, prices) {
  return (rows || []).filter((row) => String(row.assetId || "").toLowerCase() === marketKey).map((row) => {
    const id = assetId(row.chainId, row.token);
    const asset = assets.get(id);
    const decimals = asset?.decimals;
    const price = prices[id];
    const amount = (kind) => {
      const raw = row.total?.[kind];
      if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
      if (BigInt(raw) === 0n) return 0;
      return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? Number(raw) / 10 ** decimals : null;
    };
    const value = (units) => units === 0 ? 0 : units != null && price != null && Number.isFinite(Number(price)) && Number(price) >= 0 ? units * Number(price) : null;
    const claimed = amount("claimed"), claimable = amount("claimable"), accrued = amount("unrealized");
    return { token: id, symbol: asset?.symbol || row.token, claimed, claimable, accrued,
      claimedUsd: value(claimed), claimableUsd: value(claimable), accruedUsd: value(accrued), valuation: "current" };
  });
}

export function sumKnownValues(items, field) {
  return items.every((item) => item[field] != null && Number.isFinite(item[field]))
    ? items.reduce((total, item) => total + item[field], 0) : null;
}

export async function loadRewardPricing(ids, getJson) {
  const assets = new Map(), prices = {};
  for (let start = 0; start < ids.length; start += 20) {
    const batch = ids.slice(start, start + 20);
    const encoded = encodeURIComponent(batch.join(","));
    const [metadata, values] = await Promise.all([
      getJson(`/v1/assets/all?ids=${encoded}`).catch(() => ({ assets: [] })),
      getJson(`/v1/prices/assets?ids=${encoded}`).catch(() => ({ prices: {} }))
    ]);
    for (const asset of metadata.assets || []) assets.set(assetId(asset.chainId, asset.address), asset);
    for (const [id, price] of Object.entries(values.prices || {})) prices[id.toLowerCase()] = price;
    // /assets/all enumerates Pendle assets; plain reward tokens may only be
    // returned by the chain-scoped metadata endpoint. Never guess decimals.
    await Promise.all(batch.filter((id) => !assets.has(id)).map(async (id) => {
      const [chain, address] = id.split("-");
      try {
        const asset = await getJson(`/v1/${chain}/assets/${address}`);
        if (assetId(asset.chainId, asset.address) === id) assets.set(id, asset);
      } catch { /* Keep unavailable valuations null rather than zero. */ }
    }));
  }
  return { assets, prices };
}
