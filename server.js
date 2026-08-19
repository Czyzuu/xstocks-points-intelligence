import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getPendleAnalytics } from "./api/pendle.js";
import { getOfficialWallet } from "./api/official-wallet.js";
import { getVerifiedDownline } from "./api/wallet.js";

const PORT = Number(process.env.PORT || 4173);
const UPSTREAM = "https://xpoints.io";
const PUBLIC = fileURLToPath(new URL("./public", import.meta.url));
const CACHE_MS = 60_000;
const cache = new Map();
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

async function getJson(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.data;
  const response = await fetch(`${UPSTREAM}${path}`, { headers: { accept: "application/json", "user-agent": "xStocks-Points-Intelligence/1.0" } });
  if (!response.ok) throw Object.assign(new Error(`Community data API returned ${response.status}`), { status: response.status });
  const data = await response.json();
  cache.set(path, { time: Date.now(), data });
  return data;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" });
  res.end(JSON.stringify(body));
}

function normalizePage(value) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

async function summary() {
  const stats = await getJson("/api/stats");
  const first = await getJson("/api/leaderboard?page=1");
  const walletCount = Number(first.total);
  const percentiles = [1, 5, 10, 25, 50];
  const pages = [...new Set(percentiles.map((p) => Math.ceil(Math.ceil(walletCount * p / 100) / 100)))];
  const pageData = await Promise.all(pages.map(async (page) => [page, await getJson(`/api/leaderboard?page=${page}`)]));
  const byPage = new Map(pageData);
  const percentileBands = percentiles.map((percentile) => {
    const rank = Math.ceil(walletCount * percentile / 100);
    const page = Math.ceil(rank / 100);
    const row = byPage.get(page)?.rows?.find((item) => Number(item.rank) === rank);
    return { percentile, rank, thresholdPoints: row?.totalPoints ?? null };
  });
  const categories = first.rows.reduce((totals, row) => {
    totals.holding += Number(row.holdersPoints || 0);
    totals.lending += Number(row.lendingPoints || 0);
    totals.liquidity += Number(row.lpsPoints || 0);
    totals.referrals += Number(row.referralPoints || 0);
    totals.gmAndQuests += Number(row.gmPoints || 0) + Number(row.questPoints || 0);
    return totals;
  }, { holding: 0, lending: 0, liquidity: 0, referrals: 0, gmAndQuests: 0 });
  return { stats: { ...stats, leaderboardWallets: walletCount }, percentileBands, categories };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/summary") return json(res, 200, await summary());
    if (url.pathname === "/api/leaderboard") {
      const page = normalizePage(url.searchParams.get("page"));
      const search = (url.searchParams.get("search") || "").trim().slice(0, 128);
      const params = new URLSearchParams({ page: String(page), pageSize: "100" });
      if (search) params.set("search", search);
      return json(res, 200, await getJson(`/api/leaderboard?${params}`));
    }
    if (url.pathname === "/api/wallet") {
      const address = (url.searchParams.get("address") || "").trim();
      const isEvm = /^0x[a-f0-9]{40}$/i.test(address);
      const isSvm = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      if (!isEvm && !isSvm) return json(res, 400, { error: "Invalid wallet address" });
      return json(res, 200, { downline: await getVerifiedDownline(address) });
    }
    if (url.pathname === "/api/pendle") {
      const address = (url.searchParams.get("address") || "").trim();
      if (!/^0x[a-f0-9]{40}$/i.test(address)) return json(res, 400, { error: "Pendle analytics requires an EVM wallet" });
      return json(res, 200, await getPendleAnalytics(address));
    }
    if (url.pathname === "/api/official-wallet") {
      const address = (url.searchParams.get("address") || "").trim();
      const isEvm = /^0x[a-f0-9]{40}$/i.test(address);
      const isSvm = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      if (!isEvm && !isSvm) return json(res, 400, { error: "Invalid wallet address" });
      return json(res, 200, await getOfficialWallet(address));
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
    const file = join(PUBLIC, safePath);
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "Forbidden" });
    const content = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, 502, { error: error.message || "Community data is temporarily unavailable" });
  }
});

server.listen(PORT, () => console.log(`xStocks dashboard: http://localhost:${PORT}`));
