const API = "https://xpoints.io";
const PENDLE_API = "https://api-v2.pendle.finance/core";
const XSTOCKS_POINTS_API = "https://points-api.xstocks.fi/api/v1";

export async function getXPointsJson(path) {
  const response = await fetch(`${API}${path}`, { headers: { accept: "application/json", "user-agent": "xStocks-Points-Intelligence/1.0" } });
  if (!response.ok) throw Object.assign(new Error(`Community data API returned ${response.status}`), { status: response.status });
  return response.json();
}

export async function getPendleJson(path) {
  const response = await fetch(`${PENDLE_API}${path}`, { headers: { accept: "application/json", "user-agent": "xStocks-Points-Intelligence/1.0" } });
  if (!response.ok) throw Object.assign(new Error(`Pendle API returned ${response.status}`), { status: response.status });
  return response.json();
}

export async function getOfficialPointsJson(path) {
  const response = await fetch(`${XSTOCKS_POINTS_API}${path}`, { headers: { accept: "application/json", "user-agent": "xStocks-Points-Intelligence/1.0" } });
  if (!response.ok) throw Object.assign(new Error(`Official xStocks points API returned ${response.status}`), { status: response.status });
  const body = await response.json();
  if (!body.success) throw new Error("Official xStocks points API returned an invalid response");
  return body.data;
}

export function setCache(res, seconds = 300) {
  res.setHeader("Cache-Control", `public, s-maxage=${seconds}, stale-while-revalidate=600`);
}

export function normalizePage(value) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function normalizeWalletAddress(value) {
  const address = String(value || "").trim();
  const isEvm = /^0x[a-f0-9]{40}$/i.test(address);
  const isSvm = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return isEvm || isSvm ? address : null;
}

export function sendError(res, error, fallback) {
  console.error(error);
  const status = error.status === 429 ? 429 : 500;
  return res.status(status).json({ error: status === 429 ? "Community data rate limit reached" : fallback });
}
