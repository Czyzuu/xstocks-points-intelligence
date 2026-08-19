import { getOfficialPointsJson, getXPointsJson, normalizeWalletAddress, sendError, setCache } from "./_lib/xpoints.js";

async function mapLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

export async function getVerifiedDownline(address) {
  const wallet = await getXPointsJson(`/api/wallet/${encodeURIComponent(address)}`);
  const candidates = (wallet.downline?.top || []).slice(0, 30);
  const referralCode = String(wallet.referral_code || "").toLowerCase();
  if (!referralCode || !candidates.length) return { count: 0, candidateCount: candidates.length, totalPoints: 0, top: [] };
  const checked = await mapLimited(candidates, 4, async (candidate) => {
    try {
      const candidateAddress = candidate.address_display;
      const [user, dashboard] = await Promise.all([
        getOfficialPointsJson(`/xdrop-user/${encodeURIComponent(candidateAddress)}`),
        getOfficialPointsJson(`/xdrop-user/${encodeURIComponent(candidateAddress)}/dashboard`)
      ]);
      if (String(user.referredBy || "").toLowerCase() !== referralCode) return null;
      return {
        ...candidate,
        wallet_type: user.walletType || candidate.wallet_type,
        total_points: Number(dashboard.totalPoints || 0),
        total_points_raw: String(dashboard.totalPoints || 0),
        snapshot_number: Number(dashboard.currentSnapshotNumber || 0),
        official_verified: true
      };
    } catch { return null; }
  });
  const verified = checked.filter(Boolean);
  return {
    count: verified.length,
    candidateCount: candidates.length,
    discoveredCount: Number(wallet.downline?.count || candidates.length),
    totalPoints: verified.reduce((sum, candidate) => sum + candidate.total_points, 0),
    top: verified
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const address = normalizeWalletAddress(req.query.address);
  if (!address) return res.status(400).json({ error: "Invalid wallet address" });
  try {
    const downline = await getVerifiedDownline(address);
    setCache(res);
    return res.status(200).json({ downline });
  } catch (error) { return sendError(res, error, "Failed to fetch referred wallets"); }
}
