/* ===========================================================
   StreaMeGuide — Jetzt im TV
   Zeigt pro Sender, was gerade läuft, bis wann, und was danach kommt.
   Die Programmdaten legt der Workflow tv-update.yml in Supabase ab
   (Tabelle sg_tv) – gelesen wird mit dem Haushalts-Token aus dem Sync.
   Öffnen: vom linken Bildschirmrand nach rechts wischen oder 📺 oben.
   =========================================================== */

const TV_CACHE_KEY = "streamguide:tv";
const EDGE_ZONE = 24;        // px vom linken Rand, in denen die Wischgeste startet
const TV_SWIPE_MIN = 60;     // so weit muss man wischen

const tv = {
  data: null,                // { generated_at, channels: [{ id, name, shows: [{s,e,t,st?,g?}] }] }
  loading: false,
  error: null,
  timer: null
};

function loadTvCache() {
  try {
    const raw = localStorage.getItem(TV_CACHE_KEY);
    if (raw) tv.data = JSON.parse(raw);
  } catch { tv.data = null; }
}

async function fetchTv() {
  if (!syncReady()) return;
  tv.loading = true;
  tv.error = null;
  renderTv();
  try {
    const url = `${sync.config.url.replace(/\/+$/, "")}/rest/v1/sg_tv?household_id=eq.${encodeURIComponent(sync.config.household)}&select=data`;
    const res = await fetch(url, { headers: syncHeaders(), cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 404 ? "Tabelle sg_tv fehlt (SYNC-SETUP.md, Schritt 6)" : `Fehler ${res.status}`);
    const rows = await res.json();
    if (rows.length && rows[0].data) {
      tv.data = rows[0].data;
      try { localStorage.setItem(TV_CACHE_KEY, JSON.stringify(tv.data)); } catch { /* Speicher voll: egal */ }
    } else if (!tv.data) {
      tv.error = "Noch keine Programmdaten – der Workflow „TV-Programm aktualisieren“ ist noch nicht gelaufen.";
    }
  } catch (e) {
    tv.error = e.message.startsWith("Fehler") || e.message.startsWith("Tabelle") ? e.message : "Keine Verbindung";
  }
  tv.loading = false;
  renderTv();
}

function hhmm(unix) {
  return new Date(unix * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// Laufende und nächste Sendung zum Zeitpunkt now (Unix-Sekunden)
function nowAndNext(shows, now) {
  const i = shows.findIndex(sh => sh.s <= now && sh.e > now);
  if (i >= 0) return { cur: shows[i], next: shows[i + 1] || null };
  // Lücke im Programm: nichts läuft, nächste Sendung zeigen
  return { cur: null, next: shows.find(sh => sh.s > now) || null };
}

function tvRowHtml(ch, now) {
  const { cur, next } = nowAndNext(ch.shows || [], now);
  let body;
  if (cur) {
    const pct = Math.min(100, Math.max(0, ((now - cur.s) / (cur.e - cur.s)) * 100));
    const left = Math.max(1, Math.round((cur.e - now) / 60));
    body = `
      <div class="tv-now">${escapeHtml(cur.t)}</div>
      ${cur.st ? `<div class="tv-sub">${escapeHtml(cur.st)}</div>` : ""}
      <div class="tv-time">${hhmm(cur.s)} – ${hhmm(cur.e)} · noch ${left} Min</div>
      <div class="tv-bar" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></div>`;
  } else {
    body = `<div class="tv-now tv-none">Gerade keine Programmdaten</div>`;
  }
  const nextHtml = next
    ? `<div class="tv-next"><span class="tv-next-label">Danach</span> ${hhmm(next.s)} ${escapeHtml(next.t)}</div>`
    : "";
  return `
    <div class="tv-row">
      <span class="tv-channel">${escapeHtml(ch.name)}</span>
      <div class="tv-body">${body}${nextHtml}</div>
    </div>`;
}

function renderTv() {
  const body = document.getElementById("tv-body");
  if (!body || !document.getElementById("tv-view").classList.contains("open")) return;

  if (!syncReady()) {
    body.innerHTML = `
      <div class="empty">Das TV-Programm kommt über den Geräte-Sync. Bitte zuerst den Sync einrichten
        (Anleitung: SYNC-SETUP.md, Schritt 6).</div>
      <button class="btn small" id="tv-open-sync">Geräte-Sync öffnen</button>`;
    body.querySelector("#tv-open-sync").onclick = () => openSyncDialog();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let html = "";
  if (tv.data && tv.data.channels && tv.data.channels.length) {
    html += tv.data.channels.map(ch => tvRowHtml(ch, now)).join("");
    const stand = new Date(tv.data.generated_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    html += `<div class="tv-foot">Programmstand: ${escapeHtml(stand)}${tv.loading ? " · aktualisiere …" : ""}</div>`;
  } else if (tv.loading) {
    html += `<div class="empty">Lade Programm …</div>`;
  }
  if (tv.error) html += `<div class="empty tv-error">${escapeHtml(tv.error)}</div>`;
  body.innerHTML = html;
}

function openTv() {
  const view = document.getElementById("tv-view");
  if (view.classList.contains("open")) return;
  view.classList.add("open");
  renderTv();
  fetchTv();
  // Fortschritt und "Jetzt/Danach" jede halbe Minute nachziehen
  clearInterval(tv.timer);
  tv.timer = setInterval(renderTv, 30000);
}

function closeTv() {
  document.getElementById("tv-view").classList.remove("open");
  clearInterval(tv.timer);
  tv.timer = null;
}

// Wischgeste: Start am linken Rand, nach rechts ziehen -> öffnen.
// In der TV-Ansicht nach links ziehen -> schließen.
// Touch- statt Pointer-Events: Safari bricht Pointer-Events ab, sobald es
// selbst scrollt – touchend kommt dagegen immer an.
// Karten-Gesten (attachSwipe) ignorieren Starts im Randbereich, damit sich
// beides nicht in die Quere kommt.
function initTvGestures() {
  let startX = 0, startY = 0, mode = null;
  const isOpen = (id) => document.getElementById(id).classList.contains("open");

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || isOpen("modal-overlay")) { mode = null; return; }
    const t = e.touches[0];
    if (isOpen("tv-view")) mode = "close";
    else if (t.clientX <= EDGE_ZONE && !isOpen("refine-view")) mode = "open";
    else mode = null;
    startX = t.clientX; startY = t.clientY;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!mode) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
    if (mode === "open" && horizontal && dx >= TV_SWIPE_MIN) openTv();
    if (mode === "close" && horizontal && dx <= -TV_SWIPE_MIN) closeTv();
    mode = null;
  }, { passive: true });

  document.addEventListener("touchcancel", () => { mode = null; }, { passive: true });
}

function initTv() {
  loadTvCache();
  document.getElementById("tv-btn").onclick = () => openTv();
  document.getElementById("tv-close").onclick = () => closeTv();
  initTvGestures();
  // Zurück in die App: frische Daten holen, falls die Ansicht offen ist
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.getElementById("tv-view").classList.contains("open")) fetchTv();
  });
}
