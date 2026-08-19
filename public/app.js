const state = { page: 1, totalPages: 1, totalPoints: 0, walletCount: 0, socialWallet: null, socialTheme: "dark", socialFormat: "standard" };
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

function normalizeWalletQuery(value) {
  const query = String(value || "").trim();
  try {
    if (/^https?:\/\//i.test(query)) return new URL(query).searchParams.get("ref")?.trim() || query;
  } catch {}
  return query.replace(/^ref\s*=\s*/i, "").trim();
}

function isWalletAddress(value) {
  return /^0x[a-f0-9]{40}$/i.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

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
const socialCardFormats = {
  standard: { width: 1200, height: 675 },
  "x-carousel": { width: 700, height: 800 }
};
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 3 });
const currency = new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const multiplier = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const multiplierLabel = (wallet) => {
  const value = wallet.averageMultiplier == null
    ? (Number(wallet.totalBasePoints) > 0 ? Number(wallet.totalPoints) / Number(wallet.totalBasePoints) : null)
    : Number(wallet.averageMultiplier);
  return Number.isFinite(value) ? `${multiplier.format(value)}×` : "—";
};

function renderPointSources(wallet) {
  const sources = [
    ["Holding", wallet.holdersPoints], ["Lending", wallet.lendingPoints], ["Liquidity", wallet.lpsPoints],
    ["Referrals", wallet.referralPoints], ["GM", wallet.gmPoints], ["Quests", wallet.questPoints]
  ].map(([label, points]) => ({ label, points: Number(points || 0) })).filter(({ points }) => points > 0).sort((a, b) => b.points - a.points);
  if (!sources.length) return "";
  const max = Math.max(...sources.map(({ points }) => points), 1);
  const baseTotal = Number(wallet.totalBasePoints) || sources.reduce((sum, source) => sum + source.points, 0);
  return `<section class="points-sources"><h3>OFFICIAL BASE POINT SOURCES <span>${sources.length} ACTIVE</span></h3><div class="source-list">${sources.map(({ label, points }) => `<div class="source-row"><span>${label}</span><i><b style="width:${Math.max(1, points / max * 100)}%"></b></i><strong>${fmt(points)}</strong><small>${percent.format(points / baseTotal)}</small></div>`).join("")}</div></section>`;
}

function renderReferredWallets(downline, officialCount) {
  const wallets = Array.isArray(downline?.top) ? downline.top : [];
  const rows = wallets.map((wallet) => {
    const address = String(wallet.address_display || "Unknown");
    const name = wallet.resolved_name || shortWallet(address);
    const network = wallet.wallet_type === "Svm" ? "SOL" : wallet.wallet_type === "Evm" ? "EVM" : wallet.wallet_type || "—";
    return `<li><div><b title="${escapeHtml(address)}">${escapeHtml(name)}</b><button type="button" class="copy-referral-wallet" data-address="${escapeHtml(address)}">${escapeHtml(address)}</button></div><span class="network-pill">${escapeHtml(network)}</span><strong>${fmt(wallet.total_points || 0)} <small>OFFICIAL xPOINTS</small></strong></li>`;
  }).join("");
  const heading = `<h3>REFERRED WALLETS <span>${fmt(wallets.length)} VERIFIED OF ${fmt(officialCount || 0)} OFFICIAL REFERRALS</span></h3>`;
  return `<section class="referred-wallets">${heading}${rows ? `<ol>${rows}</ol>` : `<p>No discovered referral wallets could be verified through the official API.</p>`}</section>`;
}

function renderPendleAnalytics(data) {
  const positions = data?.positions || [];
  if (!positions.length) return `<section class="pendle-analytics"><h3>PENDLE YT ANALYTICS <span>OFFICIAL PENDLE DATA</span></h3><p>No indexed YT position history was found.</p></section>`;
  return `<section class="pendle-analytics"><h3>PENDLE YT ANALYTICS <span>${positions.length} ${positions.length === 1 ? "MARKET" : "MARKETS"} · OFFICIAL PENDLE DATA</span></h3><div class="pendle-list">${positions.map((position, index) => {
    const expiry = position.expiry ? new Date(position.expiry).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—";
    const entry = position.averageEntryAsset == null ? "—" : Number(position.averageEntryAsset).toPrecision(5);
    const unclaimed = (position.unclaimedYield || []).map((item) => `${Number(item.amount).toPrecision(5)} ${escapeHtml(item.symbol)}`).join(" + ") || "NO CLAIMABLE TOKENS";
    return `<article><div class="pendle-title"><div><span>YT-${escapeHtml(position.name)}</span><small>MATURITY ${escapeHtml(expiry)} · CHAIN ${fmt(position.chainId)}</small></div><div class="pendle-title-actions"><strong>${fmt(position.balance)} <small>YT · ${currency.format(position.currentYtValueUsd || 0)}</small></strong><button type="button" class="pendle-share-button" data-pendle-index="${index}">Share YT PnL <b>↗</b></button></div></div><dl><div><dt>GROSS YT DEPLOYED</dt><dd>${currency.format(position.entryCostUsd)}</dd><small>BASE ${currency.format(position.baseBagUsd || 0)} · REINVESTED ${currency.format(position.reinvestedBagUsd || 0)}</small></div><div><dt>AVG. DEPLOYED / YT</dt><dd>${escapeHtml(entry)} <small>ASSET</small></dd></div><div><dt>YIELD CLAIMED</dt><dd class="positive">${currency.format(position.claimedYieldUsd)}</dd><small>${fmt(position.yieldClaims)} CLAIMS · ${fmt(position.claimedYieldAsset)} ASSET</small></div><div><dt>YIELD UNCLAIMED</dt><dd class="positive">${currency.format(position.unclaimedYieldUsd || 0)}</dd><small>${unclaimed}</small></div><div><dt>YT TOTAL PNL</dt><dd class="${position.ytTotalPnlUsd >= 0 ? "positive" : "negative"}">${currency.format(position.ytTotalPnlUsd)}</dd><small>MARKED TO CURRENT YT VALUE</small></div><div><dt>UNDERLYING / IMPLIED</dt><dd>${position.underlyingApy == null ? "—" : percent.format(position.underlyingApy)} <small>/ ${position.impliedApy == null ? "—" : percent.format(position.impliedApy)}</small></dd></div></dl></article>`;
  }).join("")}</div><p class="pendle-note">YT total PnL = current YT value + claimed yield + unclaimed yield − gross YT deployed. Base and reinvested bags are derived from Pendle transaction history; external transfers can make the split incomplete.</p></section>`;
}

function syncSocialCardScale() {
  const frame = $("social-card-frame");
  const width = frame.getBoundingClientRect().width;
  if (width) $("social-card").style.setProperty("--card-scale", Math.min(1, width / socialCardWidth));
}

function setSocialCardFormat(format = "standard") {
  state.socialFormat = socialCardFormats[format] ? format : "standard";
  $("social-card").dataset.format = state.socialFormat;
  $("social-card-frame").dataset.format = state.socialFormat;
  $("social-dialog").dataset.format = state.socialFormat;
  const input = document.querySelector(`input[name="card-format"][value="${state.socialFormat}"]`);
  if (input) input.checked = true;
  syncSocialCardScale();
}

function openSocialCard(wallet) {
  const source = topSourceEntry(wallet);
  state.socialWallet = wallet;
  state.socialTheme = "dark";
  document.querySelector('input[name="card-theme"][value="dark"]').checked = true;
  $("social-card").dataset.theme = state.socialTheme;
  setSocialCardFormat("standard");
  delete $("social-card").dataset.variant;
  $("social-card").innerHTML = `<div class="social-card-top"><span class="social-brand"><svg class="xstocks-card-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="card-brand-gradient" x1="0" y1="40" x2="40" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#1fd59a"/><stop offset="1" stop-color="#5fcef0"/></linearGradient></defs><path fill="url(#card-brand-gradient)" d="M40 .3V13.3L33.3 20 40 26.7V39.7c0 .2-.1.3-.3.3H26.7L20 33.3 13.3 40H.3a.3.3 0 0 1-.3-.3V26.7L6.7 20 0 13.3V.3C0 .1.1 0 .3 0h13L20 6.7 26.7 0h13c.2 0 .3.1.3.3Z"/></svg>xSTOCKS<br />POINTS INTELLIGENCE</span><span>MY xPOINTS STATS<br /><b>${escapeHtml(shortWallet(String(wallet.address)))}</b></span></div><div class="social-rank"><span>LEADERBOARD RANK</span><strong>#${fmt(wallet.rank)}</strong><em>${percentileLabel(wallet.rank)}</em></div><div class="social-stats"><div><span>TOP POINTS SOURCE</span><strong>${escapeHtml(source.label)}</strong><small>${fmt(source.points)} POINTS</small></div><div><span>TOTAL xPOINTS</span><strong>${fmt(wallet.totalPoints)}</strong><small>AVG. MULTIPLIER ${multiplierLabel(wallet)}</small></div></div><div class="social-card-foot"><span>POINTS, RANKED AND DECODED.</span><b>MADE BY CZYZU</b></div>`;
  $("copy-status").textContent = "Copy the card as an image and share it anywhere.";
  $("social-card-modal").hidden = false;
  document.body.classList.add("modal-open");
  syncSocialCardScale();
  $("copy-social-card").focus();
}

function openPendleSocialCard(position, wallet) {
  const pnlReturn = Number(position.entryCostUsd) ? Number(position.ytTotalPnlUsd) / Number(position.entryCostUsd) : 0;
  const pnlClass = position.ytTotalPnlUsd >= 0 ? "gain" : "loss";
  const pendlePoints = Number((wallet.sources || []).find((source) => /pendle[ -]?yt/i.test(source.label || source.marketSource || ""))?.value || 0);
  const averageMultiplier = wallet.averageMultiplier == null
    ? (Number(wallet.totalBasePoints) > 0 ? Number(wallet.totalPoints) / Number(wallet.totalBasePoints) : null)
    : Number(wallet.averageMultiplier);
  const adjustedPendlePoints = pendlePoints && Number.isFinite(averageMultiplier) ? pendlePoints * averageMultiplier : 0;
  const costPer100k = adjustedPendlePoints ? -Number(position.ytTotalPnlUsd) / adjustedPendlePoints * 100000 : null;
  state.socialWallet = wallet;
  state.socialTheme = "dark";
  document.querySelector('input[name="card-theme"][value="dark"]').checked = true;
  $("social-card").dataset.theme = state.socialTheme;
  setSocialCardFormat("standard");
  $("social-card").dataset.variant = "pendle";
  $("social-card").innerHTML = `<div class="yt-card-head"><span class="social-brand"><svg class="xstocks-card-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="pendle-card-gradient" x1="0" y1="40" x2="40" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#1fd59a"/><stop offset="1" stop-color="#5fcef0"/></linearGradient></defs><path fill="url(#pendle-card-gradient)" d="M40 .3V13.3L33.3 20 40 26.7V39.7c0 .2-.1.3-.3.3H26.7L20 33.3 13.3 40H.3a.3.3 0 0 1-.3-.3V26.7L6.7 20 0 13.3V.3C0 .1.1 0 .3 0h13L20 6.7 26.7 0h13c.2 0 .3.1.3.3Z"/></svg>xSTOCKS</span><span>PENDLE POSITION <b>YT-${escapeHtml(position.name)}</b></span></div><div class="yt-card-body"><div class="yt-card-hero ${pnlClass}"><span>TOTAL PNL</span><strong>${position.ytTotalPnlUsd >= 0 ? "+" : ""}${currency.format(position.ytTotalPnlUsd)}</strong><em>${pnlReturn >= 0 ? "+" : ""}${percent.format(pnlReturn)}</em></div><div class="yt-card-efficiency"><div><span>PENDLE YT xPOINTS</span><strong>${pendlePoints ? fmt(pendlePoints) : "—"}</strong><small>AVG. MULTIPLIER ${multiplierLabel(wallet)}</small></div><div><span>NET COST / 100K</span><strong class="${costPer100k != null && costPer100k < 0 ? "profitable" : ""}">${costPer100k == null ? "—" : currency.format(costPer100k)}</strong><small>MULTIPLIER-ADJUSTED xPOINTS</small></div></div></div><div class="yt-card-stats"><div><span>CURRENT VALUE</span><strong>${currency.format(position.currentYtValueUsd || 0)}</strong></div><div><span>YIELD EARNED</span><strong>${currency.format(Number(position.claimedYieldUsd || 0) + Number(position.unclaimedYieldUsd || 0))}</strong></div><div><span>CAPITAL DEPLOYED</span><strong>${currency.format(position.entryCostUsd)}</strong></div></div><div class="yt-card-foot"><span>${escapeHtml(shortWallet(String(wallet.address)))}</span><i></i><span>${fmt(position.balance)} YT</span><b>MADE BY CZYZU</b></div>`;
  $("copy-status").textContent = "Copy the YT PnL card as an image and share it anywhere.";
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
    const format = socialCardFormats[state.socialFormat] || socialCardFormats.standard;
    const cardHeight = socialCardWidth * format.height / format.width;
    const canvas = await document.fonts.ready.then(() => window.html2canvas(card, {
      backgroundColor: null,
      height: cardHeight,
      logging: false,
      onclone: (documentClone) => {
        const clonedCard = documentClone.getElementById("social-card");
        clonedCard.style.setProperty("--card-scale", 1);
        clonedCard.parentElement.style.width = `${socialCardWidth}px`;
        clonedCard.parentElement.style.overflow = "visible";
      },
      scale: format.width / socialCardWidth,
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
  const query = normalizeWalletQuery($("wallet-input").value);
  const result = $("wallet-result");
  if (!query) return;
  const referralLookup = !isWalletAddress(query);
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  result.hidden = false;
  result.classList.remove("not-found");
  result.innerHTML = `<span class="search-loading">${referralLookup ? "Resolving referral code" : "Looking up wallet"}…</span>`;
  try {
    const data = await request(`/api/leaderboard?page=1&search=${encodeURIComponent(query)}`);
    const exact = data.rows.find((wallet) => String(wallet.address).toLowerCase() === query.toLowerCase() || String(wallet.resolvedName || "").toLowerCase() === query.toLowerCase());
    const indexedWallet = exact || data.rows[0];
    if (!indexedWallet) throw new Error("Wallet not found");
    const [details, official] = await Promise.all([
      request(`/api/wallet?address=${encodeURIComponent(indexedWallet.address)}`),
      request(`/api/official-wallet?address=${encodeURIComponent(indexedWallet.address)}`)
    ]);
    const wallet = { ...indexedWallet, ...official, sources: official.sources || [] };
    const network = wallet.walletType === "Svm" ? "SOL" : wallet.walletType === "Evm" ? "EVM" : wallet.walletType || "—";
    const displayName = wallet.resolvedName || wallet.label || wallet.address;
    const identityLabel = referralLookup ? `REFERRAL ${escapeHtml(query.toUpperCase())} → WALLET` : "WALLET";
    const hasPendleYt = wallet.walletType === "Evm" && wallet.sources.some((source) => /pendle[ -]?yt/i.test(source.label || source.marketSource || ""));
    const pendle = hasPendleYt ? await request(`/api/pendle?address=${encodeURIComponent(wallet.address)}`).catch(() => null) : null;
    result.innerHTML = `<div class="wallet-identity"><span>${identityLabel} <button type="button" id="close-wallet" aria-label="Close wallet result">×</button></span><b class="wallet" title="${escapeHtml(wallet.address)}">${escapeHtml(displayName)}</b>${referralLookup ? `<button type="button" class="copy-wallet" data-address="${escapeHtml(wallet.address)}">Copy full address</button>` : ""}</div><div><span>RANK</span><strong>#${fmt(wallet.rank)}</strong></div><div><span>PERCENTILE</span><strong>${percentileLabel(wallet.rank)}</strong></div><div><span>TOTAL xPOINTS</span><strong>${fmt(wallet.totalPoints)}</strong></div><div><span>BASE xPOINTS</span><strong>${fmt(wallet.totalBasePoints)}</strong></div><div><span>AVG. MULTIPLIER</span><strong>${multiplierLabel(wallet)}</strong></div><div class="wallet-share"><span>${escapeHtml(network)} · OFFICIAL #${fmt(wallet.snapshotNumber)}</span><button type="button" class="share-card-button">Social card <b>↗</b></button></div>${renderPointSources(wallet)}${pendle ? renderPendleAnalytics(pendle) : ""}${renderReferredWallets(details.downline, wallet.referralCount)}`;
    $("close-wallet").addEventListener("click", () => { result.hidden = true; });
    result.querySelector(".share-card-button").addEventListener("click", () => openSocialCard(wallet));
    result.querySelector(".copy-wallet")?.addEventListener("click", async (copyEvent) => {
      const button = copyEvent.currentTarget;
      try { await navigator.clipboard.writeText(button.dataset.address); button.textContent = "Address copied"; }
      catch { button.textContent = "Copy unavailable"; }
    });
    result.querySelectorAll(".copy-referral-wallet").forEach((button) => button.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(button.dataset.address); button.textContent = "Address copied"; }
      catch { button.textContent = "Copy unavailable"; }
    }));
    result.querySelectorAll(".pendle-share-button").forEach((button) => button.addEventListener("click", () => {
      openPendleSocialCard(pendle.positions[Number(button.dataset.pendleIndex)], wallet);
    }));
  } catch (error) {
    result.classList.add("not-found");
    result.innerHTML = `<span>${referralLookup ? "No wallet found for that referral code." : escapeHtml(error.message)}</span>`;
  } finally { submit.disabled = false; }
});

document.querySelectorAll("[data-close-social]").forEach((button) => button.addEventListener("click", closeSocialCard));
new ResizeObserver(syncSocialCardScale).observe($("social-card-frame"));
document.querySelectorAll('input[name="card-theme"]').forEach((input) => input.addEventListener("change", (event) => {
  state.socialTheme = event.target.value;
  $("social-card").dataset.theme = state.socialTheme;
  $("copy-status").textContent = `${state.socialTheme === "dark" ? "Dark" : "Light"} card selected — copy it as an image.`;
}));
document.querySelectorAll('input[name="card-format"]').forEach((input) => input.addEventListener("change", (event) => {
  setSocialCardFormat(event.target.value);
  $("copy-status").textContent = state.socialFormat === "x-carousel"
    ? "X two-image post selected — exports at 700 × 800."
    : "16:9 selected — exports at 1200 × 675.";
}));
$("copy-social-card").addEventListener("click", copySocialCard);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("social-card-modal").hidden) closeSocialCard(); });

try { renderSummary(await request("/api/summary")); await loadLeaderboard(); } catch (error) { showError(error); }
