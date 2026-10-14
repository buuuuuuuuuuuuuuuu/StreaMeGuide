// Läuft alle zwei Stunden per GitHub Action (tv-update.yml).
// Holt das TV-Programm (jetzt bis +36 Stunden) und legt es in Supabase ab
// (Tabelle sg_tv, siehe SYNC-SETUP.md Schritt 6) – NICHT als Datei im
// öffentlichen Repo: Programmdaten der Privatsender sind lizenzpflichtig.
//
// Braucht als Repo-Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SG_HOUSEHOLD
// (dasselbe Haushalts-Token wie in der App unter "Geräte-Sync").
// Mit DRY_RUN=1 wird nichts gespeichert, nur das Ergebnis ausgegeben.

import { gunzipSync } from "node:zlib";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const HOUSEHOLD = (process.env.SG_HOUSEHOLD || "").trim();
const DRY_RUN = process.env.DRY_RUN === "1";

// Datenquellen: frei verfügbare XMLTV-Dateien (Standardformat für
// Programmdaten). Die erste ist die Hauptquelle; die zweite wird nur
// geladen, wenn dort Sender fehlen. Beide am 14.10.2026 vom GitHub-Runner
// aus geprüft, ebenso alle Sender-IDs unten. (Die frühere TV-Spielfilm-Schnittstelle gibt es nicht mehr.)
const SOURCES = [
  { name: "epgshare01", url: "https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz" },
  { name: "iptv-epg",   url: "https://iptv-epg.org/files/epg-de.xml.gz" }
];

// Sender in Anzeigereihenfolge. Neuen Sender = eine Zeile ergänzen.
// xmltv: Sender-IDs in den XMLTV-Dateien (je Quelle unterschiedlich,
// deshalb mehrere – die erste passende gewinnt).
export const TV_CHANNELS = [
  { id: "ard",    name: "Das Erste",  xmltv: ["Das.Erste.de", "DasErste.de"] },
  { id: "zdf",    name: "ZDF",        xmltv: ["ZDF.de"] },
  { id: "arte",   name: "arte",       xmltv: ["ARTE.de", "arte.de"] },
  { id: "rbb",    name: "rbb",        xmltv: ["RBB.de", "rbbBerlin.de"] },
  { id: "rtl",    name: "RTL",        xmltv: ["RTL.de"] },
  { id: "sat1",   name: "SAT.1",      xmltv: ["SAT.1.de", "SAT1.de", "Sat1.de"] },
  { id: "pro7",   name: "Pro7",       xmltv: ["ProSieben.de"] },
  { id: "kabel1", name: "Kabel Eins", xmltv: ["kabel.eins.de", "KabelEins.de"] },
  { id: "vox",    name: "VOX",        xmltv: ["VOX.de"] },
  // Weitere Öffentlich-Rechtliche (\u00AD = weicher Trennstrich für die schmale Senderkachel)
  { id: "3sat",         name: "3sat",            xmltv: ["3sat.de"] },
  { id: "zdfneo",       name: "ZDFneo",          xmltv: ["ZDFneo.de", "zdf_neo.de"] },
  { id: "one",          name: "ONE",             xmltv: ["ONE.de"] },
  { id: "phoenix",      name: "phoenix",         xmltv: ["PHOENIX.de", "phoenix.de"] },
  { id: "tagesschau24", name: "tages\u00ADschau24", xmltv: ["tagesschau24.de"] },
  { id: "ardalpha",     name: "ARD alpha",       xmltv: ["ARD.alpha.de", "ARD-alpha.de"] },
  // Private Unterhaltung
  { id: "rtlzwei",      name: "RTLZWEI",         xmltv: ["RTLZWEI.de"] },
  { id: "sixx",         name: "sixx",            xmltv: ["sixx.de"] },
  { id: "sat1gold",     name: "SAT.1 Gold",      xmltv: ["SAT.1.Gold.de", "SAT1GOLD.de"] },
  { id: "pro7maxx",     name: "Pro7 MAXX",       xmltv: ["ProSieben.MAXX.de", "ProSiebenMAXX.de"] },
  { id: "kabel1doku",   name: "Kabel Eins Doku", xmltv: ["kabel.eins.Doku.de", "KabelEinsDoku.de"] },
  { id: "nitro",        name: "Nitro",           xmltv: ["NITRO.de"] },
  { id: "dmax",         name: "DMAX",            xmltv: ["DMAX.de"] },
  { id: "tele5",        name: "Tele 5",          xmltv: ["Tele.5.de", "Tele5.de"] },
  { id: "rtlup",        name: "RTLup",           xmltv: ["RTLup.de"] },
  { id: "voxup",        name: "VOXup",           xmltv: ["VOXup.de"] },
  { id: "comedycentral",name: "Comedy Central",  xmltv: ["Comedy.Central.de", "ComedyCentral.de"] },
  // Nachrichten & Sport
  { id: "ntv",          name: "ntv",             xmltv: ["ntv.de", "n-tv.de"] },
  { id: "welt",         name: "WELT",            xmltv: ["WELT.de"] },
  { id: "sport1",       name: "SPORT1",          xmltv: ["SPORT1.de"] },
  { id: "eurosport1",   name: "Euro\u00ADsport 1", xmltv: ["Eurosport.1.de", "Eurosport1.de"] },
  // Nur die österreichische Fassung ist in den Quellen – Programm weicht teils ab
  { id: "servustv",     name: "ServusTV AT",     xmltv: ["Servus.TV.Österreich.de"] }
];

const WINDOW_BEFORE = 3600;       // laufende Sendungen, die bis zu 1 h vorher begannen
const WINDOW_AFTER = 36 * 3600;   // bis 36 h in die Zukunft

// "20261013024500 +0000" -> Unix-Sekunden
export function xmltvTime(v) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-])?(\d\d)?(\d\d)?/.exec(v || "");
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  const off = m[7] ? (m[7] === "-" ? -1 : 1) * ((+m[8] || 0) * 3600 + (+m[9] || 0) * 60) : 0;
  return utc - off;
}

function decodeXml(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .trim();
}

const tag = (body, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body);
  return m ? decodeXml(m[1]) : "";
};
const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : "";
};

// Liest aus einer XMLTV-Datei nur die gewünschten Sender im Zeitfenster.
// Ergebnis: Map Sender-ID -> [{ s, e, t, st?, g? }]
export function parseXmltv(xml, wantedIds, now = Math.floor(Date.now() / 1000)) {
  const wanted = new Set(wantedIds);
  const out = new Map();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const ch = attr(m[1], "channel");
    if (!wanted.has(ch)) continue;
    const s = xmltvTime(attr(m[1], "start"));
    const e = xmltvTime(attr(m[1], "stop"));
    if (!s || !e || e <= s) continue;
    if (e <= now - WINDOW_BEFORE || s >= now + WINDOW_AFTER) continue;
    const t = tag(m[2], "title");
    if (!t) continue;
    const show = { s, e, t };
    const st = tag(m[2], "sub-title");
    if (st && st !== t) show.st = st;
    const g = tag(m[2], "category");
    if (g) show.g = g;
    if (!out.has(ch)) out.set(ch, []);
    out.get(ch).push(show);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.s - b.s);
    // Doppelte Einträge (gleiche Startzeit) entfernen
    for (let i = list.length - 1; i > 0; i--) if (list[i].s === list[i - 1].s) list.splice(i, 1);
  }
  return out;
}

async function loadSource(src) {
  const res = await fetch(src.url, {
    headers: { "User-Agent": "streameguide/1.0 (personal use)" },
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf); // gzip
  const xml = buf.toString("utf8");
  if (!xml.includes("<programme")) throw new Error("keine <programme>-Einträge");
  return xml;
}

export async function collectChannels(now = Math.floor(Date.now() / 1000), load = loadSource) {
  const allIds = TV_CHANNELS.flatMap(c => c.xmltv);
  const found = new Map();   // Sender-id (ard, zdf …) -> shows
  for (const src of SOURCES) {
    const missing = TV_CHANNELS.filter(c => !found.has(c.id));
    if (!missing.length) break;
    let parsed;
    try {
      parsed = parseXmltv(await load(src), allIds, now);
    } catch (e) {
      console.warn(`  Quelle ${src.name}: FEHLER ${e.message}`);
      continue;
    }
    for (const ch of missing) {
      const id = ch.xmltv.find(x => (parsed.get(x) || []).length);
      if (id) found.set(ch.id, parsed.get(id));
    }
    console.log(`  Quelle ${src.name}: ${missing.filter(c => found.has(c.id)).length} von ${missing.length} fehlenden Sendern gefunden`);
  }
  return TV_CHANNELS.filter(c => found.has(c.id)).map(c => ({ id: c.id, name: c.name, shows: found.get(c.id) }));
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
  if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_ANON_KEY || !HOUSEHOLD)) {
    // Kein Fehler: Solange der Sync nicht eingerichtet ist, soll der
    // Workflow nicht alle zwei Stunden rot werden.
    console.warn("TV-Programm übersprungen: Secrets SUPABASE_URL, SUPABASE_ANON_KEY und SG_HOUSEHOLD fehlen (siehe SYNC-SETUP.md, Schritt 6).");
    return;
  }
  if (/\.supabase\.com/i.test(SUPABASE_URL)) {
    throw new Error("SUPABASE_URL endet auf .supabase.com – richtig ist .supabase.co");
  }

  const now = Math.floor(Date.now() / 1000);
  const channels = await collectChannels(now);
  const fmt = (u) => new Date(u * 1000).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  for (const ch of TV_CHANNELS) {
    const c = channels.find(x => x.id === ch.id);
    if (!c) { console.warn(`  ${ch.name}: FEHLER keine Sendungen gefunden`); continue; }
    const cur = c.shows.find(s => s.s <= now && s.e > now);
    const next = c.shows.find(s => s.s >= (cur ? cur.e : now));
    console.log(`  ${ch.name}: ${c.shows.length} Sendungen` +
      (cur ? ` · jetzt ${fmt(cur.s)}–${fmt(cur.e)} ${cur.t}` : "") +
      (next ? ` · danach ${fmt(next.s)} ${next.t}` : ""));
  }
  if (!channels.length) throw new Error("Für keinen Sender Programmdaten erhalten – Datenquellen prüfen.");

  const payload = { generated_at: new Date().toISOString(), channels };
  if (DRY_RUN) {
    console.log(`Testlauf: ${channels.length} von ${TV_CHANNELS.length} Sendern, ${JSON.stringify(payload).length} Bytes – nichts gespeichert.`);
    return;
  }
  await saveToSupabase(payload);
  console.log(`Gespeichert: ${channels.length} von ${TV_CHANNELS.length} Sendern.`);
}

// Nur ausführen, wenn direkt gestartet (Tests importieren die Funktionen)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
