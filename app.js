const APP_VERSION = "0.3.0";
const STORAGE_KEY = "streamguide:profiles";
const RECS_URL = "recommendations.json";
const RECS_SAMPLE_URL = "recommendations.sample.json";
const SWIPE_THRESHOLD = 80;

const REASONS = {
  like: ["Figuren", "Atmosphäre/Stimmung", "Spannung/Plot", "Humor", "Optik/Machart", "Thema", "Schauspieler:innen", "Sonstiges"],
  dislike: ["Zu langsam", "Vorhersehbar", "Charaktere unsympathisch", "Thema nicht meins", "Humor passt nicht", "Schlechte Machart", "Zu aufwendig/lang", "Sonstiges"],
  not_interested: ["Genre nicht meins", "Thema nicht meins", "Kenn ich schon", "Zu gehypt", "Falscher Zeitpunkt", "Sonstiges"]
};
const CATEGORY_LABEL = { like: "Gut bewertet", dislike: "Nicht gut bewertet", not_interested: "Sowas nicht" };

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

// ---------- item identity (tmdb_id when available, title fallback for Mediathek) ----------
function itemKey(item) {
  return item.tmdb_id != null ? "t:" + item.tmdb_id : "n:" + (item.title || "").toLowerCase();
}

function ensureLists(prefs) {
  prefs.seen_liked = prefs.seen_liked || [];
  prefs.seen_disliked = prefs.seen_disliked || [];
  prefs.not_interested = prefs.not_interested || [];
  prefs.loved_titles = prefs.loved_titles || [];
}

function excludedKeySet(prefs) {
  ensureLists(prefs);
  const s = new Set();
  [...prefs.seen_liked, ...prefs.seen_disliked, ...prefs.not_interested].forEach(e => {
    s.add(e.tmdb_id != null ? "t:" + e.tmdb_id : "n:" + (e.title || "").toLowerCase());
  });
  return s;
}

// ---------- scoring ----------
function buildLovedGenreWeights(prefs, items) {
  const weights = {};
  if (!prefs) return weights;
  ensureLists(prefs);
  const lovedKeys = new Set([
    ...prefs.loved_titles.map(t => t.tmdb_id != null ? "t:" + t.tmdb_id : "n:" + (t.title || "").toLowerCase()),
    ...prefs.seen_liked.map(t => t.tmdb_id != null ? "t:" + t.tmdb_id : "n:" + (t.title || "").toLowerCase())
  ]);
  items.forEach(it => {
    if (lovedKeys.has(itemKey(it))) {
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

function scoreForProfile(item, prefs, lovedWeights, excludedKeys) {
  if (!prefs) return { pass: true, score: item.rating || 0 };
  if (excludedKeys && excludedKeys.has(itemKey(item))) return { pass: false };
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
    const wA = buildLovedGenreWeights(A, items), wB = buildLovedGenreWeights(B, items);
    const exA = excludedKeySet(A), exB = excludedKeySet(B);
    return items.map(it => {
      const sa = scoreForProfile(it, A, wA, exA);
      const sb = scoreForProfile(it, B, wB, exB);
      if (!sa.pass || !sb.pass) return null;
      return { item: it, score: Math.min(sa.score, sb.score) };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
  }

  const prefs = state.profiles[view];
  const w = buildLovedGenreWeights(prefs, items);
  const ex = prefs ? excludedKeySet(prefs) : null;
  return items.map(it => {
    const s = scoreForProfile(it, prefs, w, ex);
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
  const singleProfile = state.activeView !== "both" ? state.activeView : null;
  const prefsForLove = state.profiles[singleProfile || "A"];

  heroSlot.innerHTML = `
    <div class="swipe-wrap" data-key="${itemKey(top.item)}">
      <div class="swipe-hint hint-left">👀 Gesehen?</div>
      <div class="swipe-hint hint-right">🚫 Nicht interessiert</div>
      <div class="swipe-surface ticket">
        <div class="eyebrow">Heute Abend</div>
        <h2>${escapeHtml(top.item.title)}</h2>
        <p class="overview">${escapeHtml((top.item.overview || "").slice(0, 180))}${(top.item.overview || "").length > 180 ? "…" : ""}</p>
        <div class="stub">
          <span>${badgeHtml(top.item)}</span>
          <span>${top.item.rating ? "★ " + top.item.rating.toFixed(1) : ""}</span>
        </div>
      </div>
    </div>
  `;

  const groups = { netflix: [], prime: [], mediathek: [] };
  rest.forEach(entry => {
    qualifyingProviders(entry.item).forEach(p => {
      if (!groups[p.key].some(e => itemKey(e.item) === itemKey(entry.item))) groups[p.key].push(entry);
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
        <div class="swipe-wrap" data-key="${itemKey(entry.item)}">
          <div class="swipe-hint hint-left">👀 Gesehen?</div>
          <div class="swipe-hint hint-right">🚫 Nicht interessiert</div>
          <div class="swipe-surface card">
            <div class="rank">${String(i + 1).padStart(2, "0")}</div>
            <div class="body">
              <h3>${escapeHtml(entry.item.title)}</h3>
              <div class="genres">${(entry.item.genres || []).join(" · ")}</div>
              <div class="badges">${badgeHtml(entry.item)}</div>
            </div>
            <button class="love-btn ${loved ? "loved" : ""}" data-id="${entry.item.tmdb_id ?? ""}" title="Als Lieblingstitel markieren">${loved ? "♥" : "♡"}</button>
          </div>
        </div>
      `;
    });
  });
  listSlot.innerHTML = html;

  listSlot.querySelectorAll(".love-btn").forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id ? Number(btn.dataset.id) : null;
      const it = (state.recs.items || []).find(x => x.tmdb_id === id);
      if (it) toggleLove(it);
    };
  });

  if (singleProfile) {
    [heroSlot, listSlot].forEach(container => {
      container.querySelectorAll(".swipe-wrap").forEach(wrap => attachSwipe(wrap, singleProfile));
    });
  }
}

// ---------- swipe gestures ----------
function findItemByKey(key) {
  return (state.recs.items || []).find(it => itemKey(it) === key);
}

function attachSwipe(wrapEl, profileKey) {
  const surface = wrapEl.querySelector(".swipe-surface");
  const hintLeft = wrapEl.querySelector(".hint-left");
  const hintRight = wrapEl.querySelector(".hint-right");
  let startX = 0, startY = 0, dx = 0, dragging = false, locked = null;

  function reset() {
    surface.style.transition = "transform .2s ease";
    surface.style.transform = "translateX(0)";
    hintLeft.style.opacity = 0;
    hintRight.style.opacity = 0;
  }

  wrapEl.addEventListener("pointerdown", (e) => {
    dragging = true; locked = null; startX = e.clientX; startY = e.clientY; dx = 0;
    surface.style.transition = "none";
    wrapEl.setPointerCapture(e.pointerId);
  });

  wrapEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    dx = e.clientX - startX;
    if (locked === null) locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    if (locked === "v") return;
    surface.style.transform = `translateX(${dx}px)`;
    hintLeft.style.opacity = dx < 0 ? Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1) : 0;
    hintRight.style.opacity = dx > 0 ? Math.min(dx / SWIPE_THRESHOLD, 1) : 0;
  });

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    if (locked !== "h") { reset(); return; }
    const item = findItemByKey(wrapEl.dataset.key);
    if (dx <= -SWIPE_THRESHOLD && item) {
      surface.style.transition = "transform .15s ease";
      surface.style.transform = `translateX(-${SWIPE_THRESHOLD + 10}px)`;
      openThumbChoice(item, profileKey, () => reset());
    } else if (dx >= SWIPE_THRESHOLD && item) {
      surface.style.transition = "transform .15s ease";
      surface.style.transform = `translateX(${SWIPE_THRESHOLD + 10}px)`;
      openReasonStep({
        headline: `Nicht interessiert an „${item.title}“`,
        reasonOptions: REASONS.not_interested,
        onSave: (reasons) => { finalizeClassification(profileKey, item, "not_interested", reasons); },
        onCancel: () => reset()
      });
    } else {
      reset();
    }
  }
  wrapEl.addEventListener("pointerup", onEnd);
  wrapEl.addEventListener("pointercancel", onEnd);
}

function finalizeClassification(profileKey, item, category, reasons) {
  const prefs = state.profiles[profileKey];
  if (!prefs) return;
  ensureLists(prefs);
  const entry = { tmdb_id: item.tmdb_id ?? null, title: item.title, genres: item.genres || [], reasons, rated_at: new Date().toISOString() };
  const key = category === "like" ? "seen_liked" : category === "dislike" ? "seen_disliked" : "not_interested";
  prefs[key] = prefs[key].filter(e => (e.tmdb_id ?? null) !== (item.tmdb_id ?? null) || e.title !== item.title);
  prefs[key].push(entry);
  saveProfiles();
  closeModal();
  render();
}

// ---------- modal ----------
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.getElementById("modal-content").innerHTML = "";
}

function openThumbChoice(item, profileKey, onCancel) {
  const content = document.getElementById("modal-content");
  content.innerHTML = `
    <div class="modal-headline">Wie fandest du „${escapeHtml(item.title)}“?</div>
    <div class="thumb-row">
      <button class="thumb-btn up" id="thumb-up">👍 Mehr davon</button>
      <button class="thumb-btn down" id="thumb-down">👎 Sowas nicht</button>
    </div>
    <button class="btn secondary small modal-cancel">Abbrechen</button>
  `;
  document.getElementById("modal-overlay").classList.add("open");
  content.querySelector(".modal-cancel").onclick = () => { closeModal(); onCancel && onCancel(); };
  content.querySelector("#thumb-up").onclick = () => openReasonStep({
    headline: `Was hat dir an „${item.title}“ gefallen?`,
    reasonOptions: REASONS.like,
    onSave: (reasons) => finalizeClassification(profileKey, item, "like", reasons),
    onCancel
  });
  content.querySelector("#thumb-down").onclick = () => openReasonStep({
    headline: `Was hat dir an „${item.title}“ nicht gefallen?`,
    reasonOptions: REASONS.dislike,
    onSave: (reasons) => finalizeClassification(profileKey, item, "dislike", reasons),
    onCancel
  });
}

function openReasonStep({ headline, reasonOptions, initialSelected = [], onSave, onCancel, onRemove }) {
  const selected = new Set(initialSelected);
  const content = document.getElementById("modal-content");
  content.innerHTML = `
    <div class="modal-headline">${escapeHtml(headline)}</div>
    <div class="chip-grid">
      ${reasonOptions.map(r => `<button class="chip reason-chip ${selected.has(r) ? "active" : ""}" data-r="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("")}
    </div>
    <div class="modal-actions">
      <button class="btn small" id="reason-save">Speichern</button>
      ${onRemove ? `<button class="btn secondary small" id="reason-remove">Aus Liste entfernen</button>` : ""}
      <button class="btn secondary small modal-cancel">Abbrechen</button>
    </div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
  content.querySelectorAll(".reason-chip").forEach(chip => {
    chip.onclick = () => {
      const r = chip.dataset.r;
      if (selected.has(r)) { selected.delete(r); chip.classList.remove("active"); }
      else { selected.add(r); chip.classList.add("active"); }
    };
  });
  content.querySelector("#reason-save").onclick = () => onSave([...selected]);
  if (onRemove) content.querySelector("#reason-remove").onclick = onRemove;
  content.querySelector(".modal-cancel").onclick = () => { closeModal(); onCancel && onCancel(); };
}

// ---------- Profil verfeinern ----------
function renderRefineView() {
  const view = document.getElementById("refine-view");
  const profileKey = state.activeView !== "both" ? state.activeView : "A";
  const prefs = state.profiles[profileKey];
  if (!prefs) {
    view.querySelector("#refine-body").innerHTML = `<div class="empty">Für dieses Profil wurde noch nichts bewertet.</div>`;
    return;
  }
  ensureLists(prefs);
  view.querySelector("#refine-title").textContent = `Profil verfeinern – ${prefs.profile_name}`;

  const sections = [
    ["like", prefs.seen_liked],
    ["dislike", prefs.seen_disliked],
    ["not_interested", prefs.not_interested]
  ];
  let html = "";
  sections.forEach(([cat, entries]) => {
    html += `<div class="section-label">${CATEGORY_LABEL[cat]} (${entries.length})</div>`;
    if (!entries.length) { html += `<div class="empty">Noch keine Einträge.</div>`; return; }
    entries.slice().reverse().forEach((e, idx) => {
      const realIdx = entries.length - 1 - idx;
      html += `
        <div class="card refine-row" data-cat="${cat}" data-idx="${realIdx}">
          <div class="body">
            <h3>${escapeHtml(e.title)}</h3>
            <div class="genres">${(e.reasons || []).join(" · ") || "Kein Grund angegeben"}</div>
          </div>
        </div>
      `;
    });
  });
  view.querySelector("#refine-body").innerHTML = html;

  view.querySelectorAll(".refine-row").forEach(row => {
    row.onclick = () => {
      const cat = row.dataset.cat;
      const idx = Number(row.dataset.idx);
      const entry = prefs[cat === "like" ? "seen_liked" : cat === "dislike" ? "seen_disliked" : "not_interested"][idx];
      openReasonStep({
        headline: `Grund bearbeiten: „${entry.title}“`,
        reasonOptions: REASONS[cat],
        initialSelected: entry.reasons || [],
        onSave: (reasons) => {
          entry.reasons = reasons;
          saveProfiles();
          closeModal();
          renderRefineView();
        },
        onRemove: () => {
          const list = prefs[cat === "like" ? "seen_liked" : cat === "dislike" ? "seen_disliked" : "not_interested"];
          list.splice(idx, 1);
          saveProfiles();
          closeModal();
          renderRefineView();
        }
      });
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

  document.getElementById("refine-btn").onclick = () => {
    if (state.activeView === "both") {
      alert("Zum Verfeinern bitte oben ein einzelnes Profil (A oder B) wählen.");
      return;
    }
    renderRefineView();
    document.getElementById("refine-view").classList.add("open");
  };
  document.getElementById("refine-close").onclick = () => {
    document.getElementById("refine-view").classList.remove("open");
  };
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });

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

  document.getElementById("footer-version").textContent = "v" + APP_VERSION;
  registerServiceWorker();
}

// ---------- Service Worker / Update-Check ----------
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("service-worker.js").then((reg) => {
    // Falls beim Laden schon ein Update wartet (z.B. Tab war lange offen)
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner(reg);
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });

    // Aktiv nach Update suchen: beim Öffnen und wenn die App wieder
    // in den Vordergrund kommt (Browser prüft sonst nur sporadisch)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
}

function showUpdateBanner(reg) {
  const banner = document.getElementById("update-banner");
  banner.classList.add("show");
  document.getElementById("update-reload").onclick = () => {
    banner.querySelector("button").disabled = true;
    (reg.waiting || reg.installing)?.postMessage("SKIP_WAITING");
  };
}

document.addEventListener("DOMContentLoaded", init);
