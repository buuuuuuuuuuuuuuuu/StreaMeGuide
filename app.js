const APP_VERSION = "0.1.0";
const STORAGE_KEY = "streamguide:profiles";
const RECS_URL = "recommendations.json";
const RECS_SAMPLE_URL = "recommendations.sample.json";

let state = {
  profiles: { A: null, B: null }, // preferences.json content per slot
  activeView: "A", // "A" | "B" | "both"
  recs: null
};

// ---------- persistence ----------
function loadProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.profiles = JSON.parse(raw);
  } catch (e) { console.warn("Konnte Profile nicht laden", e); }
}
function saveProfiles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profiles));
}

// ---------- data loading ----------
async function loadRecommendations() {
  for (const url of [RECS_URL, RECS_SAMPLE_URL]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (e) { /* try next */ }
  }
  return { generated_at: null, items: [] };
}

// ---------- scoring ----------
function buildLovedGenreWeights(prefs, items) {
  const weights = {};
  if (!prefs || !prefs.loved_titles) return weights;
  const lovedIds = new Set(prefs.loved_titles.map(t => t.tmdb_id).filter(Boolean));
  items.forEach(it => {
    if (lovedIds.has(it.tmdb_id)) {
      (it.genres || []).forEach(g => { weights[g] = (weights[g] || 0) + 1; });
    }
  });
  return weights;
}

function qualifyingProviders(item) {
  const p = item.providers || {};
  const out = [];
  if (p.netflix === "flatrate") out.push({ key: "netflix", label: "Netflix" });
  if (p.prime === "flatrate") out.push({ key: "prime", label: "Prime – gratis" });
  if (p.mediathek) out.push({ key: "mediathek", label: p.mediathek + " Mediathek" });
  return out;
}

function scoreForProfile(item, prefs, lovedWeights) {
  if (!prefs) return { pass: true, score: item.rating || 0 };
  const genres = item.genres || [];
  const keywords = (item.keywords || []).map(k => k.toLowerCase());
  const hay = ((item.title || "") + " " + (item.overview || "")).toLowerCase();

  if ((prefs.excluded_genres || []).some(g => genres.includes(g))) return { pass: false };
  if ((prefs.keyword_blocks || []).some(k => keywords.includes(k.toLowerCase()) || hay.includes(k.toLowerCase()))) {
    return { pass: false };
  }
  if (typeof item.rating === "number" && item.rating > 0 && item.rating < (prefs.min_rating ?? 0)) {
    return { pass: false };
  }
  if (!qualifyingProviders(item).length) return { pass: false };

  let score = item.rating || 5;
  (prefs.preferred_genres || []).forEach(g => { if (genres.includes(g)) score += 2; });
  (prefs.keyword_boosts || []).forEach(k => {
    if (keywords.includes(k.toLowerCase()) || hay.includes(k.toLowerCase())) score += 1.5;
  });
  genres.forEach(g => { if (lovedWeights[g]) score += lovedWeights[g] * 0.8; });

  return { pass: true, score };
}

function computeList() {
  const items = (state.recs && state.recs.items) || [];
  const view = state.activeView;

  if (view === "both") {
    const A = state.profiles.A, B = state.profiles.B;
    if (!A || !B) return [];
    const wA = buildLovedGenreWeights(A, items);
    const wB = buildLovedGenreWeights(B, items);
    return items.map(it => {
      const sa = scoreForProfile(it, A, wA);
      const sb = scoreForProfile(it, B, wB);
      if (!sa.pass || !sb.pass) return null;
      return { item: it, score: Math.min(sa.score, sb.score) };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
  }

  const prefs = state.profiles[view];
  const w = buildLovedGenreWeights(prefs, items);
  return items.map(it => {
    const s = scoreForProfile(it, prefs, w);
    if (!s.pass) return null;
    return { item: it, score: s.score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

// ---------- rendering ----------
function renderProfileSwitch() {
  const el = document.getElementById("profile-switch");
  el.innerHTML = "";
  const opts = [
    { key: "A", label: state.profiles.A?.profile_name || "Profil A" },
    { key: "B", label: state.profiles.B?.profile_name || "Profil B" },
    { key: "both", label: "Beide", cls: "both" }
  ];
  opts.forEach(o => {
    const b = document.createElement("button");
    b.textContent = o.label;
    if (o.cls) b.classList.add(o.cls);
    if (state.activeView === o.key) b.classList.add("active");
    b.onclick = () => { state.activeView = o.key; render(); };
    el.appendChild(b);
  });
}

function badgeHtml(item) {
  return qualifyingProviders(item).map(p =>
    `<span class="badge ${p.key}">${p.label}</span>`
  ).join("");
}

function isLoved(item, prefs) {
  if (!prefs) return false;
  return (prefs.loved_titles || []).some(t => t.tmdb_id === item.tmdb_id);
}

function toggleLove(item) {
  const key = state.activeView === "both" ? "A" : state.activeView;
  const prefs = state.profiles[key];
  if (!prefs) return;
  prefs.loved_titles = prefs.loved_titles || [];
  const idx = prefs.loved_titles.findIndex(t => t.tmdb_id === item.tmdb_id);
  if (idx >= 0) prefs.loved_titles.splice(idx, 1);
  else prefs.loved_titles.push({ title: item.title, tmdb_id: item.tmdb_id, year: null });
  saveProfiles();
  render();
}

function render() {
  renderProfileSwitch();
  const list = computeList();
  const heroSlot = document.getElementById("hero");
  const listSlot = document.getElementById("list");
  const uploadNeeded = state.activeView === "both"
    ? (!state.profiles.A || !state.profiles.B)
    : !state.profiles[state.activeView];

  if (uploadNeeded) {
    heroSlot.innerHTML = "";
    listSlot.innerHTML = `<div class="empty">Noch kein Profil hinterlegt. Lade oben deine Vorlieben-Datei hoch, um Empfehlungen zu sehen.</div>`;
    return;
  }

  if (!list.length) {
    heroSlot.innerHTML = "";
    listSlot.innerHTML = `<div class="empty">Nichts, was zu diesem Geschmack passt – schau später wieder rein.</div>`;
    return;
  }

  const [top, ...rest] = list;
  const prefsForLove = state.profiles[state.activeView === "both" ? "A" : state.activeView];

  heroSlot.innerHTML = `
    <div class="ticket">
      <div class="eyebrow">Heute Abend</div>
      <h2>${escapeHtml(top.item.title)}</h2>
      <p class="overview">${escapeHtml((top.item.overview || "").slice(0, 180))}${(top.item.overview || "").length > 180 ? "…" : ""}</p>
      <div class="stub">
        <span>${badgeHtml(top.item)}</span>
        <span>${top.item.rating ? "★ " + top.item.rating.toFixed(1) : ""}</span>
      </div>
    </div>
  `;

  const groups = { netflix: [], prime: [], mediathek: [] };
  rest.forEach(entry => {
    qualifyingProviders(entry.item).forEach(p => {
      if (!groups[p.key].some(e => e.item.tmdb_id === entry.item.tmdb_id)) groups[p.key].push(entry);
    });
  });

  const sectionTitles = { netflix: "Netflix", prime: "Prime – gratis enthalten", mediathek: "Öffentlich-rechtliche Mediathek" };
  let html = "";
  Object.keys(groups).forEach(key => {
    if (!groups[key].length) return;
    html += `<div class="section-label">${sectionTitles[key]}</div>`;
    groups[key].forEach((entry, i) => {
      const loved = isLoved(entry.item, prefsForLove);
      html += `
        <div class="card">
          <div class="rank">${String(i + 1).padStart(2, "0")}</div>
          <div class="body">
            <h3>${escapeHtml(entry.item.title)}</h3>
            <div class="genres">${(entry.item.genres || []).join(" · ")}</div>
            <div class="badges">${badgeHtml(entry.item)}</div>
          </div>
          <button class="love-btn ${loved ? "loved" : ""}" data-id="${entry.item.tmdb_id}" title="Als Lieblingstitel markieren">${loved ? "♥" : "♡"}</button>
        </div>
      `;
    });
  });
  listSlot.innerHTML = html;

  listSlot.querySelectorAll(".love-btn").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      const it = (state.recs.items || []).find(x => x.tmdb_id === id);
      if (it) toggleLove(it);
    };
  });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- upload handling ----------
function setupUpload(slot) {
  const input = document.getElementById(`file-${slot}`);
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.profile_name) throw new Error("Feld profile_name fehlt");
      state.profiles[slot] = json;
      saveProfiles();
      updateStatusPills();
      state.activeView = slot;
      render();
    } catch (e) {
      alert("Konnte Datei nicht lesen: " + e.message);
    }
  });
}

function updateStatusPills() {
  ["A", "B"].forEach(slot => {
    const pill = document.getElementById(`status-${slot}`);
    const p = state.profiles[slot];
    pill.textContent = p ? `${p.profile_name}: geladen` : `Profil ${slot}: kein Upload`;
    pill.classList.toggle("ok", !!p);
  });
}

function exportProfile(slot) {
  const p = state.profiles[slot];
  if (!p) return alert("Kein Profil in diesem Slot.");
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.profile_name || slot}.json`;
  a.click();
}

// ---------- init ----------
async function init() {
  loadProfiles();
  updateStatusPills();
  setupUpload("A");
  setupUpload("B");
  document.getElementById("export-A").onclick = () => exportProfile("A");
  document.getElementById("export-B").onclick = () => exportProfile("B");

  document.getElementById("copy-prompt").onclick = async () => {
    const res = await fetch("onboarding-prompt.md");
    const text = await res.text();
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById("copy-prompt");
    const original = btn.textContent;
    btn.textContent = "Kopiert ✓";
    setTimeout(() => { btn.textContent = original; }, 1600);
  };

  state.recs = await loadRecommendations();
  document.getElementById("generated-at").textContent = state.recs.generated_at
    ? "Stand: " + new Date(state.recs.generated_at).toLocaleString("de-DE")
    : "Beispieldaten (noch kein täglicher Abgleich eingerichtet)";

  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
