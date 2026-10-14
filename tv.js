/* ===========================================================
   StreaMeGuide — Jetzt im TV
   Zeigt pro Sender, was gerade läuft, bis wann, und was danach kommt.
   Die Programmdaten legt der Workflow tv-update.yml in Supabase ab
   (Tabelle sg_tv) – gelesen wird mit dem Haushalts-Token aus dem Sync.
   Öffnen: vom linken Bildschirmrand nach rechts wischen oder 📺 oben.
   Lange auf eine Kachel drücken: Bearbeiten-Modus – Kacheln ziehen, um
   die Reihenfolge zu ändern, 👁 zum Aus-/Einblenden (pro Gerät gespeichert).
   =========================================================== */

const TV_CACHE_KEY = "streamguide:tv";
const EDGE_ZONE = 24;        // px vom linken Rand, in denen die Wischgeste startet
const TV_SWIPE_MIN = 60;     // so weit muss man wischen
// Neue Schlüssel mit "streameguide:" (siehe CLAUDE.md); die älteren
// "streamguide:"-Schlüssel bleiben, damit nichts verloren geht.
const TV_ORDER_KEY = "streameguide:tv-order";
const TV_HIDDEN_KEY = "streameguide:tv-hidden";
const LONG_PRESS_MS = 450;

const tv = {
  data: null,                // { generated_at, channels: [{ id, name, shows: [{s,e,t,st?,g?}] }] }
  loading: false,
  error: null,
  timer: null,
  editing: false,            // Bearbeiten-Modus (Griffe + Augen sichtbar)
  dragging: false            // gerade wird eine Kachel gezogen
};

function readList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* privat/voll: egal */ }
}

// Sender in gespeicherter Reihenfolge; neue Sender (nach einer Erweiterung
// der Senderliste) hängen hinten an.
function orderedChannels() {
  const chans = (tv.data && tv.data.channels) || [];
  const order = readList(TV_ORDER_KEY);
  const pos = new Map(order.map((id, i) => [id, i]));
  return chans
    .map((ch, i) => ({ ch, i }))
    .sort((a, b) => (pos.has(a.ch.id) ? pos.get(a.ch.id) : 1e6 + a.i) - (pos.has(b.ch.id) ? pos.get(b.ch.id) : 1e6 + b.i));
}

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

function tvRowHtml(ch, colorIdx, hidden, now) {
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
    <div class="tv-row tv-c${colorIdx % 6}${hidden ? " tv-hidden" : ""}" data-id="${escapeHtml(ch.id)}">
      <span class="tv-handle" aria-hidden="true">☰</span>
      <span class="tv-channel">${escapeHtml(ch.name)}</span>
      <div class="tv-body">${body}${nextHtml}</div>
      <button class="tv-eye" aria-label="${hidden ? "Einblenden" : "Ausblenden"}">${hidden ? "🙈" : "👁"}</button>
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

  if (tv.dragging) return;   // nicht unter dem Finger neu aufbauen

  const now = Math.floor(Date.now() / 1000);
  let html = "";
  body.classList.toggle("tv-editing", tv.editing);
  if (tv.data && tv.data.channels && tv.data.channels.length) {
    const hidden = new Set(readList(TV_HIDDEN_KEY));
    const list = orderedChannels();
    html += `<div class="tv-edit-hint">Kacheln ziehen zum Sortieren · 👁 tippen zum Aus- und Einblenden</div>`;
    html += `<div class="tv-list">${list.map(({ ch, i }) => tvRowHtml(ch, i, hidden.has(ch.id), now)).join("")}</div>`;
    if (list.every(({ ch }) => hidden.has(ch.id)) && !tv.editing) {
      html += `<div class="empty">Alle Sender sind ausgeblendet.</div><button class="btn small" id="tv-edit-start">Sender bearbeiten</button>`;
    }
    const stand = new Date(tv.data.generated_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    html += `<div class="tv-foot">Programmstand: ${escapeHtml(stand)}${tv.loading ? " · aktualisiere …" : ""}<br>Lange auf einen Sender drücken: sortieren und ausblenden</div>`;
  } else if (tv.loading) {
    html += `<div class="empty">Lade Programm …</div>`;
  }
  if (tv.error) html += `<div class="empty tv-error">${escapeHtml(tv.error)}</div>`;
  body.innerHTML = html;
  fitChannelNames();
  const startBtn = body.querySelector("#tv-edit-start");
  if (startBtn) startBtn.onclick = () => { setTvEditing(true); renderTv(); };
}

function setTvEditing(on) {
  tv.editing = on;
  document.getElementById("tv-body").classList.toggle("tv-editing", on);
  document.getElementById("tv-close").textContent = on ? "Fertig sortiert" : "Fertig";
  fitChannelNames();   // im Bearbeiten-Modus ist die Senderkachel schmaler
}

// Lange Sendernamen ("tagesschau24", "phoenix") passen in Großbuchstaben
// nicht in die Kachel. Statt sie mitten im Wort umzubrechen, wird die
// Schrift so weit verkleinert, bis das längste Wort passt.
function fitChannelNames() {
  document.querySelectorAll("#tv-body .tv-channel").forEach(el => {
    el.style.fontSize = "";
    if (!el.offsetParent) return;   // ausgeblendet: nichts zu messen
    const cs = getComputedStyle(el);
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const range = document.createRange();
    range.selectNodeContents(el);
    const textWidth = () => range.getBoundingClientRect().width;   // breiteste Zeile
    let size = parseFloat(cs.fontSize);
    while (textWidth() > room + 0.5 && size > 7) {
      size -= 0.5;
      el.style.fontSize = size + "px";
    }
  });
}

function saveTvOrder() {
  const ids = [...document.querySelectorAll("#tv-body .tv-row")].map(r => r.dataset.id);
  writeList(TV_ORDER_KEY, ids);
}

function toggleTvHidden(id) {
  const hidden = new Set(readList(TV_HIDDEN_KEY));
  hidden.has(id) ? hidden.delete(id) : hidden.add(id);
  writeList(TV_HIDDEN_KEY, [...hidden]);
  renderTv();
}

// ---------- Kacheln verschieben ----------
// Lange drücken hebt die Kachel an ("in die Hand nehmen") und schaltet den
// Bearbeiten-Modus ein; ohne Loslassen kann sie direkt gezogen werden.
// Im Bearbeiten-Modus startet der Griff ☰ das Ziehen sofort.
function initTvReorder() {
  const body = document.getElementById("tv-body");
  const scroller = document.querySelector("#tv-view .tv-panel");
  let pressTimer = null, start = null, drag = null, lastY = 0, autoScroll = null;

  const point = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;

  function lift(row, y) {
    // Erst den Bearbeiten-Modus einschalten: Griff und Auge machen die
    // Kacheln etwas höher – gemessen wird danach, sonst verrutscht die Kachel.
    if (!tv.editing) setTvEditing(true);
    const rect = row.getBoundingClientRect();
    const ph = document.createElement("div");
    ph.className = "tv-placeholder";
    ph.style.height = rect.height + "px";
    row.parentNode.insertBefore(ph, row);
    Object.assign(row.style, { position: "fixed", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px" });
    row.classList.add("tv-lifted");
    drag = { row, ph, grab: Math.min(Math.max(y - rect.top, 10), rect.height - 10) };
    tv.dragging = true;
    move(y);
    if (navigator.vibrate) navigator.vibrate(15);
    tickAutoScroll();
  }

  function move(y) {
    lastY = y;
    drag.row.style.top = (y - drag.grab) + "px";
    const rows = [...body.querySelectorAll(".tv-row:not(.tv-lifted)")];
    const target = rows.find(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    if (target) { if (target.previousElementSibling !== drag.ph) target.parentNode.insertBefore(drag.ph, target); }
    else if (rows.length) rows[rows.length - 1].after(drag.ph);
  }

  // Am oberen/unteren Rand mitscrollen, damit lange Listen erreichbar sind
  function tickAutoScroll() {
    cancelAnimationFrame(autoScroll);
    if (!drag) return;
    const box = scroller.getBoundingClientRect();
    const zone = 70;
    let dy = 0;
    if (lastY && lastY < box.top + zone) dy = -Math.ceil((box.top + zone - lastY) / 6);
    else if (lastY && lastY > box.bottom - zone) dy = Math.ceil((lastY - (box.bottom - zone)) / 6);
    if (dy) { scroller.scrollTop += dy; move(lastY); }
    autoScroll = requestAnimationFrame(tickAutoScroll);
  }

  function drop() {
    cancelAnimationFrame(autoScroll);
    const { row, ph } = drag;
    ph.replaceWith(row);
    row.classList.remove("tv-lifted");
    row.removeAttribute("style");
    drag = null;
    tv.dragging = false;
    saveTvOrder();
  }

  function onStart(e) {
    if (e.type === "mousedown" && e.button !== 0) return;
    const row = e.target.closest(".tv-row");
    if (!row || e.target.closest(".tv-eye") || drag) return;
    const p = point(e);
    start = { x: p.clientX, y: p.clientY, row };
    lastY = p.clientY;
    clearTimeout(pressTimer);
    if (tv.editing && e.target.closest(".tv-handle")) { lift(row, p.clientY); return; }
    pressTimer = setTimeout(() => { if (start) lift(start.row, lastY); }, LONG_PRESS_MS);
  }

  function onMove(e) {
    const p = point(e);
    if (drag) { e.preventDefault(); move(p.clientY); return; }
    if (start && (Math.abs(p.clientX - start.x) > 10 || Math.abs(p.clientY - start.y) > 10)) {
      clearTimeout(pressTimer);   // Finger bewegt sich: das ist Scrollen, kein langes Drücken
      start = null;
    }
    lastY = p.clientY;
  }

  function onEnd() {
    clearTimeout(pressTimer);
    start = null;
    if (drag) drop();
  }

  body.addEventListener("touchstart", onStart, { passive: true });
  body.addEventListener("touchmove", onMove, { passive: false });
  body.addEventListener("touchend", onEnd);
  body.addEventListener("touchcancel", onEnd);
  body.addEventListener("mousedown", onStart);
  window.addEventListener("mousemove", (e) => { if (start || drag) onMove(e); });
  window.addEventListener("mouseup", onEnd);
  // Kein Kontextmenü/Textauswahl beim langen Drücken
  body.addEventListener("contextmenu", (e) => { if (e.target.closest(".tv-row")) e.preventDefault(); });

  body.addEventListener("click", (e) => {
    const eye = e.target.closest(".tv-eye");
    if (eye) toggleTvHidden(eye.closest(".tv-row").dataset.id);
  });
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
  if (tv.editing) setTvEditing(false);
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
    if (isOpen("tv-view")) mode = tv.editing ? null : "close";   // beim Sortieren nicht wegwischen
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
  document.getElementById("tv-close").onclick = () => {
    if (tv.editing) { setTvEditing(false); renderTv(); }   // erst den Bearbeiten-Modus beenden
    else closeTv();
  };
  initTvGestures();
  initTvReorder();
  // Erst mit geladener Schrift (Syne) stimmt die Breite der Sendernamen
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitChannelNames);
  // Zurück in die App: frische Daten holen, falls die Ansicht offen ist
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.getElementById("tv-view").classList.contains("open")) fetchTv();
  });
}
