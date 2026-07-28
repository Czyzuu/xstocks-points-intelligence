const API = "https://xpoints.io";

export async function getXPointsJson(path) {
  const response = await fetch(`${API}${path}`, { headers: { accept: "application/json", "user-agent": "xStocks-Points-Intelligence/1.0" } });
  if (!response.ok) throw Object.assign(new Error(`Community data API returned ${response.status}`), { status: response.status });
  return response.json();
}

export function setCache(res, seconds = 300) {
  res.setHeader("Cache-Control", `public, s-maxage=${seconds}, stale-while-revalidate=600`);
}

export function normalizePage(value) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function sendError(res, error, fallback) {
  console.error(error);
  const status = error.status === 429 ? 429 : 500;
  return res.status(status).json({ error: status === 429 ? "Community data rate limit reached" : fallback });
}
