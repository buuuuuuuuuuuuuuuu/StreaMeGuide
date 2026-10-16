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

// Sender in Anzeigereihenfolge – entspricht der o2-TV-Senderliste des
// Haushalts (Stand 16.10.2026). Neuen Sender = eine Zeile an der passenden Stelle.
// xmltv: Sender-IDs in den XMLTV-Dateien, nach Vorrang geordnet – die erste
// ID, die in irgendeiner Quelle Programm hat, gewinnt. So wird das genaue
// Regionalfenster (z. B. NDR Hamburg) bevorzugt, sonst das allgemeine Programm.
// \u00AD = weicher Trennstrich für die schmale Senderkachel.
// Aus der o2-Liste in keiner Quelle vorhanden (Stand 16.10.2026): Cirkus Krimi,
// ducktv, Arthouse CNMA, Bloody Movies, Cinema of Hearts.
export const TV_CHANNELS = [
  { id: "ard",           name: "Das Erste",        xmltv: ["Das.Erste.de", "DasErste.de"] },
  { id: "zdf",           name: "ZDF",              xmltv: ["ZDF.de"] },
  { id: "rtl",           name: "RTL",              xmltv: ["RTL.de"] },
  { id: "sat1",          name: "SAT.1",            xmltv: ["SAT.1.de", "SAT1.de", "Sat1.de"] },
  { id: "pro7",          name: "ProSieben",        xmltv: ["ProSieben.de"] },
  { id: "kabel1",        name: "Kabel Eins",       xmltv: ["kabel.eins.de", "KabelEins.de"] },
  { id: "vox",           name: "VOX",              xmltv: ["VOX.de"] },
  { id: "arte",          name: "arte",             xmltv: ["ARTE.de", "arte.de"] },
  { id: "rbb",           name: "rbb Berlin",       xmltv: ["rbbBerlin.de", "RBB.de"] },
  { id: "zdfneo",        name: "ZDFneo",           xmltv: ["ZDFneo.de", "zdf_neo.de"] },
  { id: "zdfinfo",       name: "ZDFinfo",          xmltv: ["ZDFinfo.de"] },
  { id: "3sat",          name: "3sat",             xmltv: ["3sat.de"] },
  { id: "one",           name: "ONE",              xmltv: ["ONE.de"] },
  { id: "tagesschau24",  name: "tages\u00ADschau24",  xmltv: ["tagesschau24.de"] },
  { id: "ardalpha",      name: "ARD alpha",        xmltv: ["ARD.alpha.de", "ARD-alpha.de"] },
  { id: "voxup",         name: "VOXup",            xmltv: ["VOXup.de"] },
  { id: "superrtl",      name: "SUPER RTL",        xmltv: ["SUPER.RTL.de", "SuperRTL.de"] },
  { id: "sat1gold",      name: "SAT.1 Gold",       xmltv: ["SAT.1.Gold.de", "SAT1GOLD.de"] },
  { id: "pro7maxx",      name: "ProSieben MAXX",   xmltv: ["ProSieben.MAXX.de", "ProSiebenMAXX.de"] },
  { id: "rtlup",         name: "RTLup",            xmltv: ["RTLup.de"] },
  { id: "nitro",         name: "Nitro",            xmltv: ["NITRO.de"] },
  { id: "sixx",          name: "sixx",             xmltv: ["sixx.de"] },
  { id: "rtlzwei",       name: "RTLZWEI",          xmltv: ["RTLZWEI.de"] },
  { id: "hr",            name: "hr-fernsehen",     xmltv: ["HR.de", "hr.de"] },
  { id: "ntv",           name: "ntv",              xmltv: ["ntv.de", "n-tv.de"] },
  { id: "phoenix",       name: "phoenix",          xmltv: ["PHOENIX.de", "phoenix.de"] },
  { id: "bbcworld",      name: "BBC World News",   xmltv: ["BBC.World.News.de", "BBCWorld.de"] },
  { id: "cnn",           name: "CNN Inter\u00ADnational", xmltv: ["CNN.International.de", "CNNInternational.de"] },
  { id: "dmax",          name: "DMAX",             xmltv: ["DMAX.de"] },
  { id: "welt",          name: "WELT",             xmltv: ["WELT.de"] },
  { id: "kika",          name: "KiKA",             xmltv: ["KIKA.de", "KiKA.de"] },
  { id: "nick",          name: "Nickel\u00ADodeon", xmltv: ["nick.de", "Nick.de"] },
  { id: "n24doku",       name: "N24 Doku",         xmltv: ["N24.DOKU.de", "N24Doku.de"] },
  { id: "br",            name: "BR Nord",          xmltv: ["BRFernsehenNord.de", "BR.de"] },
  { id: "mdr",           name: "MDR Sachsen",      xmltv: ["MDRSachsen.de", "MDR.de"] },
  { id: "ndr",           name: "NDR Hamburg",      xmltv: ["NDRHamburg.de", "NDR.de"] },
  { id: "radiobremen",   name: "Radio Bremen",     xmltv: ["RadioBremenTV.de"] },
  { id: "sr",            name: "SR",               xmltv: ["SRFernsehen.de"] },
  { id: "swr",           name: "SWR BW",           xmltv: ["SWRBW.de", "SWR/SR.de"] },
  { id: "wdr",           name: "WDR Aachen",       xmltv: ["WDRAachen.de", "WDR.de"] },
  { id: "comedycentral", name: "Comedy Central",   xmltv: ["Comedy.Central.de", "ComedyCentral.de"] },
  { id: "df1",           name: "DF1",              xmltv: ["DF1.de"] },
  { id: "sport1",        name: "SPORT1",           xmltv: ["SPORT1.de"] },
  { id: "tele5",         name: "Tele 5",           xmltv: ["Tele.5.de", "Tele5.de"] },
  { id: "tlc",           name: "TLC",              xmltv: ["TLC.de"] },
  { id: "eurosport1",    name: "Euro\u00ADsport 1", xmltv: ["Eurosport.1.de", "Eurosport1.de"] },
  { id: "ric",           name: "RiC",              xmltv: ["RiC.de"] },
  { id: "toggoplus",     name: "TOGGO plus",       xmltv: ["TOGGO.plus.de", "TOGGOplus.de"] },
  { id: "artflix",       name: "Artflix",          xmltv: ["Artflix.de"] }
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
  // Alle Quellen laden: Regionalfenster (NDR Hamburg, WDR Aachen …) gibt es
  // teils nur in der zweiten Quelle, sollen aber Vorrang vor dem allgemeinen
  // Programm der ersten haben.
  const parsed = [];
  for (const src of SOURCES) {
    try {
      parsed.push({ src, map: parseXmltv(await load(src), allIds, now) });
    } catch (e) {
      console.warn(`  Quelle ${src.name}: FEHLER ${e.message}`);
    }
  }
  const out = [];
  for (const ch of TV_CHANNELS) {
    let hit = null;
    for (const id of ch.xmltv) {
      for (const p of parsed) {
        const shows = p.map.get(id);
        if (shows && shows.length) { hit = { shows, id, src: p.src.name }; break; }
      }
      if (hit) break;
    }
    if (hit) out.push({ id: ch.id, name: ch.name, shows: hit.shows, from: `${hit.src}/${hit.id}` });
  }
  return out;
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
    console.log(`  ${ch.name.replace(/\u00AD/g, "")} [${c.from}]: ${c.shows.length} Sendungen` +
      (cur ? ` · jetzt ${fmt(cur.s)}–${fmt(cur.e)} ${cur.t}` : "") +
      (next ? ` · danach ${fmt(next.s)} ${next.t}` : ""));
  }
  if (!channels.length) throw new Error("Für keinen Sender Programmdaten erhalten – Datenquellen prüfen.");

  // "from" ist nur fürs Log – nicht mit abspeichern
  const payload = { generated_at: new Date().toISOString(), channels: channels.map(({ from, ...c }) => c) };
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
