import { getXPointsJson, normalizePage, sendError, setCache } from "./_lib/xpoints.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const page = normalizePage(req.query.page);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 128) : "";
  try {
    const params = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (search) params.set("search", search);
    const data = await getXPointsJson(`/api/leaderboard?${params}`);
    setCache(res);
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, "Failed to fetch leaderboard"); }
}
