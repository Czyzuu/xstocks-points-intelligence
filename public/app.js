const state = { page: 1, totalPages: 1, totalPoints: 0, walletCount: 0, socialWallet: null, socialTheme: "dark" };
const $ = (id) => document.getElementById(id);
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmt = (value) => integer.format(Number(value));
const short = (value) => compact.format(Number(value));
const shortWallet = (address) => `${address.slice(0, 6)}…${address.slice(-5)}`;
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

async function request(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load data");
  return data;
}

function showError(error) { $("error").textContent = error.message; $("error").hidden = false; }

function topSourceEntry(row) {
  return [
    ["Liquidity", row.lpsPoints], ["Lending", row.lendingPoints], ["Holding", row.holdersPoints],
    ["Referrals", row.referralPoints], ["GM + quests", Number(row.gmPoints || 0) + Number(row.questPoints || 0)]
  ].map(([label, points]) => ({ label, points: Number(points || 0) })).sort((a, b) => b.points - a.points)[0];
}

const topSource = (row) => topSourceEntry(row).label;
const percentileLabel = (rank) => {
  const value = state.walletCount ? Number(rank) / state.walletCount * 100 : 0;
  return `TOP ${value < 0.01 ? "<0.01" : value.toFixed(2)}%`;
};
const socialCardWidth = 732;
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 3 });

function renderPointSources(wallet) {
  const sources = [
    ["Holding", wallet.holdersPoints], ["Lending", wallet.lendingPoints], ["Liquidity", wallet.lpsPoints],
    ["Referrals", wallet.referralPoints], ["GM", wallet.gmPoints], ["Quests", wallet.questPoints]
  ].map(([label, points]) => ({ label, points: Number(points || 0) })).filter(({ points }) => points > 0).sort((a, b) => b.points - a.points);
  if (!sources.length) return "";
  const max = Math.max(...sources.map(({ points }) => points), 1);
  return `<section class="points-sources"><h3>POINTS SOURCES <span>${sources.length} ACTIVE</span></h3><div class="source-list">${sources.map(({ label, points }) => `<div class="source-row"><span>${label}</span><i><b style="width:${Math.max(1, points / max * 100)}%"></b></i><strong>${fmt(points)}</strong><small>${percent.format(points / Number(wallet.totalPoints || 1))}</small></div>`).join("")}</div></section>`;
}

function syncSocialCardScale() {
  const frame = $("social-card-frame");
  const width = frame.getBoundingClientRect().width;
  if (width) $("social-card").style.setProperty("--card-scale", Math.min(1, width / socialCardWidth));
}

function openSocialCard(wallet) {
  const source = topSourceEntry(wallet);
  state.socialWallet = wallet;
  state.socialTheme = "dark";
  document.querySelector('input[name="card-theme"][value="dark"]').checked = true;
  $("social-card").dataset.theme = state.socialTheme;
  $("social-card").innerHTML = `<div class="social-card-top"><span class="social-brand"><svg class="xstocks-card-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="card-brand-gradient" x1="0" y1="40" x2="40" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#1fd59a"/><stop offset="1" stop-color="#5fcef0"/></linearGradient></defs><path fill="url(#card-brand-gradient)" d="M40 .3V13.3L33.3 20 40 26.7V39.7c0 .2-.1.3-.3.3H26.7L20 33.3 13.3 40H.3a.3.3 0 0 1-.3-.3V26.7L6.7 20 0 13.3V.3C0 .1.1 0 .3 0h13L20 6.7 26.7 0h13c.2 0 .3.1.3.3Z"/></svg>xSTOCKS<br />POINTS INTELLIGENCE</span><span>MY xPOINTS STATS<br /><b>${escapeHtml(shortWallet(String(wallet.address)))}</b></span></div><div class="social-rank"><span>LEADERBOARD RANK</span><strong>#${fmt(wallet.rank)}</strong><em>${percentileLabel(wallet.rank)}</em></div><div class="social-stats"><div><span>TOP POINTS SOURCE</span><strong>${escapeHtml(source.label)}</strong><small>${fmt(source.points)} POINTS</small></div><div><span>TOTAL xPOINTS</span><strong>${fmt(wallet.totalPoints)}</strong><small>${escapeHtml(wallet.walletType === "Svm" ? "SOLANA WALLET" : wallet.walletType === "Evm" ? "EVM WALLET" : "COMMUNITY WALLET")}</small></div></div><div class="social-card-foot"><span>POINTS, RANKED AND DECODED.</span><b>MADE BY CZYZU</b></div>`;
  $("copy-status").textContent = "Copy the card as an image and share it anywhere.";
  $("social-card-modal").hidden = false;
  document.body.classList.add("modal-open");
  syncSocialCardScale();
  $("copy-social-card").focus();
}

function closeSocialCard() {
  $("social-card-modal").hidden = true;
  document.body.classList.remove("modal-open");
  document.querySelector(".share-card-button")?.focus();
}

async function copySocialCard() {
  const status = $("copy-status");
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined" || !window.html2canvas) throw new Error("Image copy is not supported in this browser");
    status.textContent = "Preparing image…";
    const card = $("social-card");
    const canvas = await document.fonts.ready.then(() => window.html2canvas(card, {
      backgroundColor: null,
      height: socialCardWidth * 9 / 16,
      logging: false,
      onclone: (documentClone) => {
        const clonedCard = documentClone.getElementById("social-card");
        clonedCard.style.setProperty("--card-scale", 1);
        clonedCard.parentElement.style.width = `${socialCardWidth}px`;
        clonedCard.parentElement.style.overflow = "visible";
      },
      scale: 1200 / socialCardWidth,
      useCORS: true,
      width: socialCardWidth
    }));
    const image = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create card image")), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
    status.textContent = "Card copied — ready to paste.";
  } catch (error) {
    status.textContent = `${error.message}. Try a current Chrome, Edge, or Safari browser.`;
  }
}

function renderSummary({ stats, percentileBands, categories }) {
  const communityPoints = Number(stats.totalPointsSum);
  state.totalPoints = communityPoints;
  state.walletCount = Number(stats.leaderboardWallets);
  $("total-points").textContent = fmt(communityPoints);
  $("wallet-count").textContent = fmt(stats.leaderboardWallets);
  $("avg-points").textContent = short(communityPoints / Number(stats.leaderboardWallets));
  $("snapshot").textContent = `#${fmt(stats.snapshotNumber)}`;
  $("chain-count").textContent = fmt(stats.discoveryProgress.length);
  $("tracked-count").textContent = fmt(stats.walletsTracked);
  $("issuer-count").textContent = fmt(stats.institutional);
  const refreshed = new Date(stats.lastFetchAt);
  $("as-of").textContent = refreshed.toLocaleDateString("en", { month: "short", day: "numeric" }).toUpperCase();
  $("refresh-time").textContent = refreshed.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });

  const categoryRows = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...categoryRows.map(([, value]) => value), 1);
  const labels = { holding: "Holding", lending: "Lending", liquidity: "Liquidity", referrals: "Referrals", gmAndQuests: "GM + quests" };
  $("activity-bars").innerHTML = categoryRows.map(([key, value]) => `<div class="activity-row"><span>${labels[key]}</span><i><b style="width:${value / max * 100}%"></b></i><strong>${short(value)}</strong></div>`).join("");
  $("bands").innerHTML = percentileBands.map((band) => `<article class="band"><span>TOP ${band.percentile}%</span><strong>${fmt(band.rank)}</strong><small>wallets · ranks 1–${fmt(band.rank)}</small><span class="cutoff">CUTOFF POINTS<b>${band.thresholdPoints == null ? "—" : fmt(band.thresholdPoints)}</b></span></article>`).join("");
}

async function loadLeaderboard() {
  const body = $("leaderboard-body");
  body.innerHTML = `<tr><td colspan="6">Loading leaderboard…</td></tr>`;
  try {
    const data = await request(`/api/leaderboard?page=${state.page}`);
    state.page = Number(data.page);
    state.totalPages = Math.ceil(Number(data.total) / Number(data.pageSize));
    body.innerHTML = data.rows.map((row) => {
      const address = String(row.address || "Unknown");
      const wallet = row.resolvedName || row.label || shortWallet(address);
      const network = row.walletType === "Svm" ? "SOL" : row.walletType === "Evm" ? "EVM" : row.walletType || "—";
      const today = Number(row.todayPoints || 0);
      return `<tr><td class="rank">#${fmt(row.rank)}${row.rankDelta ? `<small class="rank-delta ${row.rankDelta < 0 ? "down" : ""}">${row.rankDelta > 0 ? "↑" : "↓"}${Math.abs(row.rankDelta)}</small>` : ""}</td><td><span class="wallet" title="${escapeHtml(address)}">${escapeHtml(wallet)}</span></td><td><span class="network-pill">${escapeHtml(network)}</span></td><td>${topSource(row)}</td><td class="right today">${today >= 0 ? "+" : "−"}${short(Math.abs(today))}</td><td class="right points">${fmt(row.totalPoints)}</td></tr>`;
    }).join("");
    const first = (state.page - 1) * data.pageSize + 1;
    const last = Math.min(first + data.rows.length - 1, data.total);
    $("page-range").textContent = `${fmt(first)}–${fmt(last)} OF ${fmt(data.total)} WALLETS`;
    $("page-label").textContent = `PAGE ${fmt(state.page)} / ${fmt(state.totalPages)}`;
    $("prev").disabled = state.page <= 1; $("next").disabled = state.page >= state.totalPages;
  } catch (error) { showError(error); }
}

$("prev").addEventListener("click", () => { if (state.page > 1) { state.page--; loadLeaderboard(); } });
$("next").addEventListener("click", () => { if (state.page < state.totalPages) { state.page++; loadLeaderboard(); } });

$("wallet-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("wallet-input").value.trim();
  const result = $("wallet-result");
  if (!query) return;
  result.hidden = false;
  result.classList.remove("not-found");
  result.innerHTML = `<span class="search-loading">Looking up wallet…</span>`;
  try {
    const data = await request(`/api/leaderboard?page=1&search=${encodeURIComponent(query)}`);
    const exact = data.rows.find((wallet) => String(wallet.address).toLowerCase() === query.toLowerCase() || String(wallet.resolvedName || "").toLowerCase() === query.toLowerCase());
    const wallet = exact || data.rows[0];
    if (!wallet) throw new Error("Wallet not found");
    const network = wallet.walletType === "Svm" ? "SOL" : wallet.walletType === "Evm" ? "EVM" : wallet.walletType || "—";
    const displayName = wallet.resolvedName || wallet.label || wallet.address;
    result.innerHTML = `<div class="wallet-identity"><span>WALLET <button type="button" id="close-wallet" aria-label="Close wallet result">×</button></span><b class="wallet" title="${escapeHtml(wallet.address)}">${escapeHtml(displayName)}</b></div><div><span>RANK</span><strong>#${fmt(wallet.rank)}</strong></div><div><span>PERCENTILE</span><strong>${percentileLabel(wallet.rank)}</strong></div><div><span>TOTAL xPOINTS</span><strong>${fmt(wallet.totalPoints)}</strong></div><div><span>NETWORK SHARE</span><strong>${percent.format(Number(wallet.totalPoints) / state.totalPoints)}</strong></div><div class="wallet-share"><span>${escapeHtml(network)} WALLET</span><button type="button" class="share-card-button">Social card <b>↗</b></button></div>${renderPointSources(wallet)}`;
    $("close-wallet").addEventListener("click", () => { result.hidden = true; });
    result.querySelector(".share-card-button").addEventListener("click", () => openSocialCard(wallet));
  } catch (error) {
    result.classList.add("not-found");
    result.innerHTML = `<span>${escapeHtml(error.message)}</span>`;
  }
});

document.querySelectorAll("[data-close-social]").forEach((button) => button.addEventListener("click", closeSocialCard));
new ResizeObserver(syncSocialCardScale).observe($("social-card-frame"));
document.querySelectorAll('input[name="card-theme"]').forEach((input) => input.addEventListener("change", (event) => {
  state.socialTheme = event.target.value;
  $("social-card").dataset.theme = state.socialTheme;
  $("copy-status").textContent = `${state.socialTheme === "dark" ? "Dark" : "Light"} card selected — copy it as an image.`;
}));
$("copy-social-card").addEventListener("click", copySocialCard);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("social-card-modal").hidden) closeSocialCard(); });

try { renderSummary(await request("/api/summary")); await loadLeaderboard(); } catch (error) { showError(error); }
