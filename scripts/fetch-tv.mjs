// Läuft alle zwei Stunden per GitHub Action (tv-update.yml).
// Holt das TV-Programm für heute und morgen und legt es in Supabase ab
// (Tabelle sg_tv, siehe SYNC-SETUP.md Schritt 6) – NICHT als Datei im
// öffentlichen Repo: Programmdaten der Privatsender sind lizenzpflichtig.
//
// Braucht als Repo-Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SG_HOUSEHOLD
// (dasselbe Haushalts-Token wie in der App unter "Geräte-Sync").

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const HOUSEHOLD = (process.env.SG_HOUSEHOLD || "").trim();

// Sender in Anzeigereihenfolge. Neuen Sender = eine Zeile ergänzen.
// codes: Senderkürzel bei der Datenquelle; mehrere werden der Reihe nach
// probiert, falls sich ein Kürzel ändert.
export const TV_CHANNELS = [
  { id: "ard",    name: "Das Erste",  codes: ["ARD"] },
  { id: "zdf",    name: "ZDF",        codes: ["ZDF"] },
  { id: "arte",   name: "arte",       codes: ["ARTE"] },
  { id: "rbb",    name: "rbb",        codes: ["RBB"] },
  { id: "rtl",    name: "RTL",        codes: ["RTL"] },
  { id: "sat1",   name: "SAT.1",      codes: ["SAT1"] },
  { id: "pro7",   name: "Pro7",       codes: ["PRO7"] },
  { id: "kabel1", name: "Kabel Eins", codes: ["K1"] },
  { id: "vox",    name: "VOX",        codes: ["VOX"] }
];

// Datenquelle: Programm-Schnittstelle von TV Spielfilm (inoffiziell,
// liefert pro Sender und Tag eine JSON-Liste). Feldnamen werden tolerant
// gelesen, damit kleine Formatänderungen nicht gleich alles brechen.
const SOURCE = (code, date) => `https://live.tvspielfilm.de/static/broadcast/list/${code}/${date}`;

// Unix-Sekunden aus Zahl (Sekunden oder Millisekunden), Zahl-String oder ISO-Datum
export function toUnix(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return n > 1e11 ? Math.round(n / 1000) : n;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.round(t / 1000);
}

export function normalizeShow(raw) {
  const s = toUnix(raw.timestart ?? raw.timeStart ?? raw.starttime ?? raw.startTime ?? raw.start);
  const e = toUnix(raw.timeend ?? raw.timeEnd ?? raw.endtime ?? raw.endTime ?? raw.end);
  const t = String(raw.title ?? raw.name ?? "").trim();
  if (!s || !e || e <= s || !t) return null;
  const show = { s, e, t };
  const st = String(raw.episodeTitle ?? raw.subtitle ?? raw.subTitle ?? "").trim();
  if (st && st !== t) show.st = st;
  const g = String(raw.genre ?? raw.sart_id ?? "").trim();
  if (g && !/^\d+$/.test(g)) show.g = g;
  return show;
}

// Datum in deutscher Zeit (der Programmtag der Quelle)
export function berlinDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d); // YYYY-MM-DD
}

async function fetchDay(code, date) {
  const res = await fetch(SOURCE(code, date), {
    headers: { "User-Agent": "StreaMeGuide/1.0 (personal use)", "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data.broadcasts || data.items || data.data || []);
  if (!Array.isArray(list)) throw new Error("unerwartetes Format");
  return list;
}

export async function collectChannel(ch, now = Math.floor(Date.now() / 1000)) {
  const errors = [];
  for (const code of ch.codes) {
    try {
      const dayErrors = [];
      const days = await Promise.all([berlinDate(-1), berlinDate(0), berlinDate(1)].map(d =>
        fetchDay(code, d).catch(e => { dayErrors.push(`${d} ${e.message}`); return []; }) // ein fehlender Tag ist kein Totalausfall
      ));
      const seen = new Set();
      const shows = days.flat()
        .map(normalizeShow)
        .filter(Boolean)
        .filter(sh => sh.e > now - 3600 && sh.s < now + 36 * 3600) // Fenster: jetzt bis +36 h
        .sort((a, b) => a.s - b.s)
        .filter(sh => { const k = `${sh.s}|${sh.t}`; if (seen.has(k)) return false; seen.add(k); return true; });
      if (shows.length) return { id: ch.id, name: ch.name, shows };
      errors.push(`${code}: ${dayErrors.length ? dayErrors.join(", ") : "keine Sendungen"}`);
    } catch (e) {
      errors.push(`${code}: ${e.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function saveToSupabase(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sg_tv`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "x-household-id": HOUSEHOLD,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ household_id: HOUSEHOLD, data: payload, updated_at: payload.generated_at })
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !HOUSEHOLD) {
    // Kein Fehler: Solange der Sync nicht eingerichtet ist, soll der
    // Workflow nicht alle zwei Stunden rot werden.
    console.warn("TV-Programm übersprungen: Secrets SUPABASE_URL, SUPABASE_ANON_KEY und SG_HOUSEHOLD fehlen (siehe SYNC-SETUP.md, Schritt 6).");
    return;
  }
  if (/\.supabase\.com/i.test(SUPABASE_URL)) {
    throw new Error("SUPABASE_URL endet auf .supabase.com – richtig ist .supabase.co");
  }

  const channels = [];
  for (const ch of TV_CHANNELS) {
    try {
      const c = await collectChannel(ch);
      channels.push(c);
      console.log(`  ${ch.name}: ${c.shows.length} Sendungen`);
    } catch (e) {
      console.warn(`  ${ch.name}: FEHLER ${e.message}`);
    }
  }
  if (!channels.length) throw new Error("Für keinen Sender Programmdaten erhalten – Datenquelle prüfen.");

  const payload = { generated_at: new Date().toISOString(), channels };
  await saveToSupabase(payload);
  console.log(`Gespeichert: ${channels.length} von ${TV_CHANNELS.length} Sendern.`);
}

// Nur ausführen, wenn direkt gestartet (Tests importieren die Funktionen)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
