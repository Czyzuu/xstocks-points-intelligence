import { getOfficialPointsJson, normalizeWalletAddress, sendError, setCache } from "./_lib/xpoints.js";

const sourceLabel = (source) => String(source || "")
  .split("-")
  .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
  .join(" ")
  .replace(/\bYt\b/g, "YT")
  .replace(/\bLp\b/g, "LP");

export async function getOfficialWallet(address) {
  const [dashboard, breakdown] = await Promise.all([
    getOfficialPointsJson(`/xdrop-user/${encodeURIComponent(address)}/dashboard`),
    getOfficialPointsJson(`/xdrop-user/${encodeURIComponent(address)}/points-breakdown`)
  ]);
  const detailedSources = [
    ...(breakdown.lendingPointsBySource || []),
    ...(breakdown.lpsPointsBySource || [])
  ].map((source) => ({ label: sourceLabel(source.marketSource), marketSource: source.marketSource, value: Number(source.points || 0) }));
  const totalPoints = Number(dashboard.totalPoints || 0);
  const totalBasePoints = Number(breakdown.totalBasePoints || breakdown.totalPoints || 0);
  return {
    totalPoints,
    todayPoints: Number(dashboard.todayPoints || 0),
    holdersPoints: Number(breakdown.holdersPoints || 0),
    lendingPoints: Number(breakdown.lendingPoints || 0),
    lpsPoints: Number(breakdown.lpsPoints || 0),
    gmPoints: Number(breakdown.gmPoints || 0),
    referralPoints: Number(breakdown.referralPoints || dashboard.referralPoints || 0),
    questPoints: Number(breakdown.questPoints || dashboard.questPoints || 0),
    referralCount: Number(dashboard.referralCount || 0),
    snapshotNumber: Number(dashboard.currentSnapshotNumber || 0),
    nextSnapshotDate: dashboard.nextSnapshotDate || null,
    totalBasePoints,
    averageMultiplier: totalBasePoints > 0 ? totalPoints / totalBasePoints : null,
    sources: detailedSources
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const address = normalizeWalletAddress(req.query.address);
  if (!address) return res.status(400).json({ error: "Invalid wallet address" });
  try {
    const wallet = await getOfficialWallet(address);
    setCache(res, 120);
    return res.status(200).json(wallet);
  } catch (error) { return sendError(res, error, "Failed to fetch official xStocks points"); }
}
