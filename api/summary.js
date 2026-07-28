import { getXPointsJson, sendError, setCache } from "./_lib/xpoints.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const stats = await getXPointsJson("/api/stats");
    const first = await getXPointsJson("/api/leaderboard?page=1");
    const walletCount = Number(first.total);
    const percentiles = [1, 5, 10, 25, 50];
    const pages = [...new Set(percentiles.map((p) => Math.ceil(Math.ceil(walletCount * p / 100) / 100)))];
    const results = await Promise.all(pages.map(async (page) => [page, await getXPointsJson(`/api/leaderboard?page=${page}`)]));
    const byPage = new Map(results);
    const percentileBands = percentiles.map((percentile) => {
      const rank = Math.ceil(walletCount * percentile / 100);
      const row = byPage.get(Math.ceil(rank / 100))?.rows?.find((item) => Number(item.rank) === rank);
      return { percentile, rank, thresholdPoints: row?.totalPoints ?? null };
    });
    const categories = first.rows.reduce((out, row) => {
      out.holding += Number(row.holdersPoints || 0); out.lending += Number(row.lendingPoints || 0);
      out.liquidity += Number(row.lpsPoints || 0); out.referrals += Number(row.referralPoints || 0);
      out.gmAndQuests += Number(row.gmPoints || 0) + Number(row.questPoints || 0); return out;
    }, { holding: 0, lending: 0, liquidity: 0, referrals: 0, gmAndQuests: 0 });
    setCache(res);
    return res.status(200).json({ stats: { ...stats, leaderboardWallets: walletCount }, percentileBands, categories });
  } catch (error) { return sendError(res, error, "Failed to fetch xPoints summary"); }
}
