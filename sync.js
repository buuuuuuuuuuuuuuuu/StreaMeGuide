/* ===========================================================
   StreamGuide — Sync
   Geräteübergreifende Profile über Supabase, ohne Login.
   Zugriff regelt ein geteiltes Haushalts-Token, das serverseitig
   per Row Level Security geprüft wird (siehe SYNC-SETUP.md).
   =========================================================== */

const SYNC_KEY = "streamguide:sync";

const sync = {
  config: null,       // { url, anonKey, household, auto }
  lastResult: null,   // { ok, at, message }
  pushTimer: null
};

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    sync.config = raw ? JSON.parse(raw) : null;
  } catch { sync.config = null; }
  return sync.config;
}

function saveSyncConfig(cfg) {
  sync.config = cfg;
  if (cfg) localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(SYNC_KEY);
}

function syncReady() {
  const c = sync.config;
  return !!(c && c.url && c.anonKey && c.household);
}

function syncHeaders(extra = {}) {
  const c = sync.config;
  return {
    "apikey": c.anonKey,
    "Authorization": `Bearer ${c.anonKey}`,
    "x-household-id": c.household,
    "Content-Type": "application/json",
    ...extra
  };
}

function syncBaseUrl() {
  return sync.config.url.replace(/\/+$/, "") + "/rest/v1/sg_profiles";
}

// ---------- Push ----------
async function syncPush(slots = ["A", "B"]) {
  if (!syncReady()) return { ok: false, message: "Sync nicht eingerichtet" };

  const rows = [];
  slots.forEach(slot => {
    const p = state.profiles[slot];
    if (!p) return;
    rows.push({
      household_id: sync.config.household,
      slot,
      data: p,
      updated_at: p._updated_at || new Date().toISOString()
    });
  });
  if (!rows.length) return { ok: true, message: "Nichts zu senden" };

  try {
    const res = await fetch(syncBaseUrl(), {
      method: "POST",
      headers: syncHeaders({ "Prefer": "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows)
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, message: `Fehler ${res.status}: ${txt.slice(0, 140)}` };
    }
    const result = { ok: true, at: new Date().toISOString(), message: `${rows.length} Profil(e) gesichert` };
    sync.lastResult = result;
    updateSyncStatus();
    return result;
  } catch (e) {
    const result = { ok: false, at: new Date().toISOString(), message: "Keine Verbindung: " + e.message };
    sync.lastResult = result;
    updateSyncStatus();
    return result;
  }
}

// Nach lokalen Änderungen automatisch (verzögert) hochladen
function schedulePush(changedSlot = null) {
  if (!syncReady() || !sync.config.auto) return;
  clearTimeout(sync.pushTimer);
  const slots = changedSlot ? [changedSlot] : ["A", "B"];
  sync.pushTimer = setTimeout(() => syncPush(slots), 2500);
}

// ---------- Pull ----------
async function syncPull({ force = false } = {}) {
  if (!syncReady()) return { ok: false, message: "Sync nicht eingerichtet" };

  try {
    const url = `${syncBaseUrl()}?household_id=eq.${encodeURIComponent(sync.config.household)}&select=slot,data,updated_at`;
    const res = await fetch(url, { headers: syncHeaders(), cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text();
      const result = { ok: false, at: new Date().toISOString(), message: `Fehler ${res.status}: ${txt.slice(0, 140)}` };
      sync.lastResult = result;
      updateSyncStatus();
      return result;
    }

    const rows = await res.json();
    let applied = 0;
    rows.forEach(row => {
      if (!["A", "B"].includes(row.slot) || !row.data) return;
      const local = state.profiles[row.slot];
      const remoteAt = row.data._updated_at || row.updated_at || null;
      const localAt = local?._updated_at || null;

      // Neuere Fassung gewinnt; ohne lokalen Stand immer übernehmen
      if (force || !local || !localAt || (remoteAt && remoteAt > localAt)) {
        state.profiles[row.slot] = row.data;
        applied++;
      }
    });

    if (applied) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profiles));
      updateStatusPills();
      render();
    }

    const result = {
      ok: true,
      at: new Date().toISOString(),
      message: applied ? `${applied} Profil(e) übernommen` : "Bereits aktuell"
    };
    sync.lastResult = result;
    updateSyncStatus();
    return result;
  } catch (e) {
    const result = { ok: false, at: new Date().toISOString(), message: "Keine Verbindung: " + e.message };
    sync.lastResult = result;
    updateSyncStatus();
    return result;
  }
}

// ---------- Token ----------
function generateHousehold() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------- UI ----------
function updateSyncStatus() {
  const el = document.getElementById("sync-status");
  if (!el) return;
  if (!syncReady()) {
    el.textContent = "Sync: aus";
    el.classList.remove("ok");
    return;
  }
  const r = sync.lastResult;
  if (!r) { el.textContent = "Sync: bereit"; el.classList.add("ok"); return; }
  const time = r.at ? new Date(r.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
  el.textContent = (r.ok ? "Sync " : "Sync-Fehler ") + time;
  el.classList.toggle("ok", !!r.ok);
}

function openSyncDialog() {
  const c = sync.config || { url: "", anonKey: "", household: "", auto: true };
  const content = document.getElementById("modal-content");
  content.innerHTML = `
    <div class="modal-headline">Geräte-Sync</div>
    <p class="modal-sub">Profile zwischen Geräten teilen – ohne Konto. Das Haushalts-Token
      ist der Schlüssel: Wer es hat, sieht eure Profile. Einrichtung siehe SYNC-SETUP.md.</p>

    <label class="field-label">Projekt-URL</label>
    <input type="url" id="sync-url" class="text-input" placeholder="https://xxxx.supabase.co" value="${escapeHtml(c.url || "")}" autocomplete="off" autocapitalize="off">

    <label class="field-label">Anon-Key (public)</label>
    <input type="text" id="sync-key" class="text-input" placeholder="eyJhbGci..." value="${escapeHtml(c.anonKey || "")}" autocomplete="off" autocapitalize="off">

    <label class="field-label">Haushalts-Token</label>
    <input type="text" id="sync-household" class="text-input mono-input" placeholder="auf beiden Geräten identisch" value="${escapeHtml(c.household || "")}" autocomplete="off" autocapitalize="off">
    <div class="modal-actions" style="margin-bottom:16px;">
      <button class="btn secondary small" id="sync-generate">🎲 Neues Token</button>
      <button class="btn secondary small" id="sync-copy">📋 Token kopieren</button>
    </div>

    <label class="toggle-row">
      <input type="checkbox" id="sync-auto" ${c.auto !== false ? "checked" : ""}>
      <span>Änderungen automatisch sichern</span>
    </label>

    <div class="modal-actions">
      <button class="btn small" id="sync-save">Speichern</button>
      <button class="btn mint small" id="sync-now-push">↑ Hochladen</button>
      <button class="btn mint small" id="sync-now-pull">↓ Laden</button>
    </div>
    <div class="modal-actions" style="margin-top:10px;">
      <button class="btn secondary small modal-cancel">Schließen</button>
      <button class="btn secondary small" id="sync-off">Sync ausschalten</button>
    </div>
    <div id="sync-feedback" class="sync-feedback"></div>
  `;
  document.getElementById("modal-overlay").classList.add("open");

  const fb = content.querySelector("#sync-feedback");
  const say = (msg, ok) => {
    fb.textContent = msg;
    fb.classList.toggle("bad", ok === false);
    fb.classList.toggle("good", ok === true);
  };

  const readForm = () => ({
    url: content.querySelector("#sync-url").value.trim(),
    anonKey: content.querySelector("#sync-key").value.trim(),
    household: content.querySelector("#sync-household").value.trim(),
    auto: content.querySelector("#sync-auto").checked
  });

  content.querySelector("#sync-generate").onclick = () => {
    content.querySelector("#sync-household").value = generateHousehold();
    say("Neues Token erzeugt – auf dem zweiten Gerät exakt dieses eintragen.", true);
  };

  content.querySelector("#sync-copy").onclick = async () => {
    const v = content.querySelector("#sync-household").value.trim();
    if (!v) return say("Noch kein Token vorhanden.", false);
    try { await navigator.clipboard.writeText(v); say("Token kopiert.", true); }
    catch { say("Kopieren nicht möglich – Token bitte manuell markieren.", false); }
  };

  content.querySelector("#sync-save").onclick = () => {
    const cfg = readForm();
    if (!cfg.url || !cfg.anonKey || !cfg.household) return say("Bitte alle drei Felder ausfüllen.", false);
    saveSyncConfig(cfg);
    updateSyncStatus();
    say("Gespeichert.", true);
  };

  content.querySelector("#sync-now-push").onclick = async () => {
    saveSyncConfig(readForm());
    say("Lade hoch …");
    const r = await syncPush();
    say(r.message, r.ok);
  };

  content.querySelector("#sync-now-pull").onclick = async () => {
    saveSyncConfig(readForm());
    say("Hole Daten …");
    const r = await syncPull({ force: true });
    say(r.message, r.ok);
  };

  content.querySelector("#sync-off").onclick = () => {
    saveSyncConfig(null);
    sync.lastResult = null;
    updateSyncStatus();
    say("Sync ausgeschaltet. Profile bleiben lokal erhalten.", true);
  };

  content.querySelector(".modal-cancel").onclick = () => closeModal();
}
