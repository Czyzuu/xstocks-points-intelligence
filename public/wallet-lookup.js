export const isWalletAddress = value => /^0x[a-f0-9]{40}$/i.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const sameAddress = (a, b) => /^0x/i.test(b) ? String(a).toLowerCase() === b.toLowerCase() : a === b;

export async function lookupWallet(query, request) {
  const search = `/api/leaderboard?page=1&search=${encodeURIComponent(query)}`;
  const optional = path => request(path, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  let address = query;
  let indexed;
  if (!isWalletAddress(query)) {
    let data;
    try { data = await request(search, { signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Referral search is unavailable. Paste your full wallet address to check official points.'); }
    indexed = data.rows?.[0];
    if (!indexed || !isWalletAddress(indexed.address)) throw new Error('Referral code is not indexed. Paste your full wallet address to check official points.');
    address = indexed.address;
  }
  const [official, community, details] = await Promise.all([
    request(`/api/official-wallet?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(20000) }),
    indexed ? null : optional(search),
    optional(`/api/wallet?address=${encodeURIComponent(address)}`)
  ]);
  indexed ||= community?.rows?.find(row => sameAddress(row.address, address));
  const wallet = {
    ...indexed,
    address,
    addressDisplay: address,
    walletType: /^0x/i.test(address) ? 'Evm' : 'Svm',
    rank: indexed?.rank ?? null,
    ...official,
    sources: official.sources || []
  };
  return { wallet, details: details || { downline: null } };
}
