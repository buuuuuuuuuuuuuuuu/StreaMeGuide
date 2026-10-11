// Läuft täglich per GitHub Action. Schreibt recommendations.json im Repo-Root.
// Braucht: Umgebungsvariable TMDB_API_KEY (Read Access Token, v4 auth)
//
// Was es tut:
// 1. Holt "trending" + "popular" Filme/Serien von TMDb (Region DE) und
//    gezielt hoch bewertete Titel (deutsche Produktionen, Netflix/Prime)
// 2. Prüft für jeden Titel die Watch-Provider in DE -> Netflix/Prime im
//    Abo ("flatrate") oder kostenlos in einer Mediathek zählen,
//    Miete/Kauf wird verworfen
// 3. Holt Mediathek-Einträge über die MediathekViewWeb-API; Filme und
//    Serien daraus müssen bei TMDb mit Bewertung gefunden werden
// 4. Schreibt alles in ein einheitliches recommendations.json

import { writeFile } from "node:fs/promises";

const TMDB_TOKEN = process.env.TMDB_API_KEY;
if (!TMDB_TOKEN) {
  console.error("TMDB_API_KEY fehlt (als Repo-Secret hinterlegen).");
  process.exit(1);
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const REGION = "DE";

async function tmdb(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("language", "de-DE");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } });
  if (!res.ok) throw new Error(`TMDb ${path} -> ${res.status}`);
  return res.json();
}

async function genreMaps() {
  const [movies, tv] = await Promise.all([
    tmdb("/genre/movie/list"),
    tmdb("/genre/tv/list")
  ]);
  const map = {};
  [...movies.genres, ...tv.genres].forEach(g => { map[g.id] = g.name; });
  return map;
}

// Öffentlich-rechtliche Mediatheken, wie sie bei TMDb/JustWatch heißen
// ("ARD Mediathek", "ZDF", "Arte", "3sat" …) – kostenlos, daher "free"/"ads".
const PUBLIC_PROVIDERS = [
  [/\bARD\b/i, "ARD"], [/\bZDF/i, "ZDF"], [/\barte\b/i, "arte"],
  [/3sat/i, "3sat"], [/phoenix/i, "Phoenix"]
];

async function watchProviders(type, id) {
  const none = { netflix: null, prime: null, mediathek: null, link: null };
  try {
    const data = await tmdb(`/${type}/${id}/watch/providers`);
    const de = data.results?.DE;
    if (!de) return none;
    const flat = (de.flatrate || []).map(p => p.provider_name);
    const open = [...(de.flatrate || []), ...(de.free || []), ...(de.ads || [])].map(p => p.provider_name);
    const pub = PUBLIC_PROVIDERS.find(([re]) => open.some(n => re.test(n)));
    return {
      netflix: flat.some(n => n.includes("Netflix")) ? "flatrate" : null,
      prime: flat.some(n => n.includes("Amazon Prime Video")) ? "flatrate" : null,
      mediathek: pub ? pub[1] : null,
      // JustWatch-Seite zum Titel: zeigt alle Anbieter inkl. Direktlinks
      link: de.link || null
    };
  } catch {
    return none;
  }
}

function isAvailable(p) {
  return !!(p.netflix || p.prime || p.mediathek);
}

async function keywords(type, id) {
  try {
    const data = await tmdb(`/${type}/${id}/keywords`);
    const list = data.keywords || data.results || [];
    return list.map(k => k.name);
  } catch {
    return [];
  }
}

function tmdbItem(type, raw, genreMap, providers, kw) {
  return {
    tmdb_id: raw.id,
    title: raw.title || raw.name,
    type,
    overview: raw.overview || "",
    genres: (raw.genre_ids || []).map(id => genreMap[id]).filter(Boolean),
    keywords: kw,
    rating: raw.vote_average || null,
    vote_count: raw.vote_count || 0,
    // Deutsche Produktionen haben bei TMDb viel weniger Stimmen als
    // US-Titel – die App legt dafür eigene Schwellen an.
    original_language: raw.original_language || null,
    poster_path: raw.poster_path || null,
    justwatch: providers.link,
    providers: { netflix: providers.netflix, prime: providers.prime, mediathek: providers.mediathek }
  };
}

// Trending/Popular allein liefert vor allem Massenware. Deshalb zusätzlich
// gezielt hoch bewertete Titel: deutsche Produktionen (Niveau "Bad Banks",
// "4 Blocks") und gut bewertete Netflix/Prime-Titel.
// Netflix = Provider 8, Amazon Prime Video = Provider 9.
const DISCOVER_LISTS = [
  ...[1, 2, 3].map(page => ["tv", "/discover/tv", {
    with_original_language: "de", "vote_count.gte": 40, "vote_average.gte": 7,
    sort_by: "popularity.desc", page
  }]),
  ...[1, 2].map(page => ["movie", "/discover/movie", {
    with_original_language: "de", "vote_count.gte": 60, "vote_average.gte": 7,
    sort_by: "popularity.desc", page
  }]),
  ...[1, 2, 3].map(page => ["tv", "/discover/tv", {
    with_watch_providers: "8|9", with_watch_monetization_types: "flatrate",
    "vote_count.gte": 300, "vote_average.gte": 7.5, sort_by: "popularity.desc", page
  }]),
  ...[1, 2].map(page => ["movie", "/discover/movie", {
    with_watch_providers: "8|9", with_watch_monetization_types: "flatrate",
    "vote_count.gte": 500, "vote_average.gte": 7.3, sort_by: "popularity.desc", page
  }])
];

async function collectTmdbItems(genreMap) {
  const lists = [
    ["movie", "/trending/movie/day", {}],
    ["tv", "/trending/tv/day", {}],
    ["movie", "/movie/popular", {}],
    ["tv", "/tv/popular", {}],
    ...DISCOVER_LISTS
  ];
  const seen = new Map();

  for (const [type, path, params] of lists) {
    let data;
    try {
      data = await tmdb(path, { region: REGION, watch_region: REGION, ...params });
    } catch (e) {
      console.warn(`  ${path} -> FEHLER: ${e.message}`);
      continue;
    }
    for (const raw of data.results || []) {
      const key = `${type}-${raw.id}`;
      if (seen.has(key)) continue;
      if (LOWBROW.test(raw.title || raw.name || "")) continue; // Vorabend-Ware, auch bei guter Fan-Wertung

      const providers = await watchProviders(type, raw.id);
      if (!isAvailable(providers)) continue; // nur im Abo oder kostenlos in der Mediathek

      const kw = await keywords(type, raw.id);
      seen.set(key, tmdbItem(type, raw, genreMap, providers, kw));
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------
// Mediathek
//
// Wichtig: Die neuesten Beiträge je Sender abzugreifen liefert vor allem
// Regionalmagazine, Nachrichten und Sport – also genau das, was hier nicht
// gewünscht ist. Stattdessen wird gezielt nach Inhaltstypen ("Reihen")
// gesucht. Das hat zwei Vorteile: die Treffer sind kuratiert, und die
// Genres stehen fest, statt aus Beschreibungstexten geraten zu werden.
// ---------------------------------------------------------------

// Welche Sender zu welcher Anzeige-Gruppe gehören.
// Auch nicht-deutsche Öffentlich-Rechtliche sind zugelassen – die
// Qualitätsprüfung passiert ohnehin über Kategorie und Sperrliste.
const CHANNEL_LABELS = {
  "ard": "ARD", "br": "ARD", "ndr": "ARD", "wdr": "ARD", "swr": "ARD",
  "mdr": "ARD", "hr": "ARD", "rbb": "ARD", "sr": "ARD", "rbtv": "ARD",
  "zdf": "ZDF",
  "arte.de": "arte",
  "3sat": "3sat",
  "orf": "ORF",
  "srf": "SRF",
  "phoenix": "Phoenix",
  "dw": "DW"
};

// Gesuchte Reihen mit festen Genres. WICHTIG: Die Genre-Namen müssen exakt
// denen entsprechen, die TMDb bei language=de-DE liefert ("Krimi", nicht
// "Crime") – sonst matchen Mediathek-Titel nie gegen die Vorlieben und
// werden ab Strenge "Normal" komplett aussortiert.
//
// validate: Filme und Serien müssen bei TMDb gefunden werden und bringen
// von dort Bewertung, Stimmen und Genres mit. Was nicht gefunden wird,
// fliegt raus – ohne Bewertung gibt es kein Qualitätssignal.
// Bewusst NICHT mehr abgefragt: "Krimi" (liefert fast nur Regionalkrimis
// wie Usedom-/Bozen-Krimi), "Herzkino" (Pilcher & Co.) und "Comedy"
// (Comedy Scheune & Co.).
const MEDIATHEK_CATEGORIES = [
  { topic: "Tatort",           genres: ["Krimi", "Drama"],             size: 8,  validate: true },
  { topic: "Polizeiruf 110",   genres: ["Krimi", "Drama"],             size: 5,  validate: true },
  { topic: "Filme im Ersten",  genres: ["Drama"],                      size: 6,  validate: true },
  { topic: "Spielfilm",        genres: ["Drama"],                      size: 10, validate: true },
  { topic: "Fernsehfilm",      genres: ["Drama"],                      size: 5,  validate: true },
  { topic: "Kino",             genres: ["Drama"],                      size: 10, validate: true },
  { topic: "Serien",           genres: ["Drama"],                      size: 8,  validate: true },
  { topic: "Terra X",          genres: ["Dokumentarfilm"],             size: 8 },
  { topic: "Dokumentation",    genres: ["Dokumentarfilm"],             size: 12 },
  { topic: "Doku",             genres: ["Dokumentarfilm"],             size: 10 },
  { topic: "Die Story",        genres: ["Dokumentarfilm"],             size: 6 },
  { topic: "Kabarett",         genres: ["Komödie"],                    size: 5 },
  { topic: "Konzert",          genres: ["Musik"],                      size: 5 },
  { topic: "Geschichte",       genres: ["Historie", "Dokumentarfilm"], size: 8 }
];

// Vorabend- und Degeto-Ware ("Morden im Norden"-Liga). Fliegt immer raus,
// auch wenn Fans sie bei TMDb hoch bewertet haben. Gleiche Liste in app.js
// (LOWBROW) – doppelte Filterung, bitte beide pflegen.
const LOWBROW = new RegExp([
  "[\\wäöüß]+-?krimi\\b",            // Usedom-Krimi, Spreewaldkrimi, Der Kroatien-Krimi …
  "ein krimi (vom|aus|im|in|am)\\b",     // "Dämonen – Ein Krimi vom Bodensee"
  "herzkino", "rosamunde pilcher", "inga lindström", "katie fforde",
  "utta danella", "traumschiff", "kreuzfahrt ins glück", "traumhotel",
  "bergdoktor", "bergretter", "morden im norden", "rentnercops",
  "hubert (und|ohne) staller", "\\bsoko\\b", "rosenheim-cops", "\\bwapo\\b",
  "großstadtrevier", "in aller freundschaft", "um himmels willen",
  "landarztpraxis", "notruf hafenkante", "letzte spur berlin",
  "watzmann ermittelt", "dr\\. mertens", "familie dr\\. kleist",
  "der staatsanwalt", "die chefin", "ein starkes team", "nord bei nordwest",
  "der kommissar und das meer", "friesland", "feuerwehrfrauen",
  "klarer? sprache", "kurzschluss", "kurzfilm"
].join("|"), "i");

// Ballast, der trotz Themensuche durchrutschen kann
const MEDIATHEK_JUNK = new RegExp([
  "audiodeskription", "hörfassung", "gebärdensprache", "mit untertitel",
  "livestream", "live aus", "trailer", "vorschau", "making of",
  "nachrichten", "tagesschau", "tagesthemen", "heute journal", "heute xpress",
  "wetter", "börse", "sportschau", "sportstudio", "bundesliga", "fußball",
  "olympia", "tour de france", "etappe", "spieltag", "wahlarena",
  "mittagsmagazin", "morgenmagazin", "brisant", "landesschau", "sachsenspiegel",
  "aktuell", "regional", "markt", "servicezeit", "um 4", "um vier"
].join("|"), "i");

// Titel wie "… vom 7. August" oder "… vom 07.08.2026" kennzeichnen
// Ausgaben täglicher Sendungen – keine Empfehlung wert.
const DATED_TITLE = /vom\s+\d{1,2}\.\s*(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|\d{1,2}\.)/i;

async function mvwQuery(query, size, { fields = ["topic"], durationMin = 2400 } = {}) {
  const body = {
    queries: [{ fields, query }],
    sortBy: "timestamp",
    sortOrder: "desc",
    future: false,
    offset: 0,
    size,
    duration_min: durationMin  // Standard ab 40 Minuten: Filme, Krimis, lange Dokus
  };
  const res = await fetch("https://mediathekviewweb.de/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "StreaMeGuide/1.0 (personal use)"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.err) throw new Error(JSON.stringify(data.err).slice(0, 200));
  return data.result?.results || [];
}

function isJunk(r) {
  const title = r.title || "";
  const topic = r.topic || "";
  if (!title.trim()) return true;
  if (DATED_TITLE.test(title)) return true;
  if (MEDIATHEK_JUNK.test(title)) return true;
  if (MEDIATHEK_JUNK.test(topic)) return true;
  if (LOWBROW.test(title) || LOWBROW.test(topic)) return true;
  return false;
}

// Mediathek-Titel für die TMDb-Suche zerlegen:
//   "Cash (2024) (klare Sprache)"                       -> Cash, 2024
//   "Sterben - Drama, Deutschland 2023"                 -> Sterben, 2023
//   "Der Code des Killers (2/3)"                        -> Der Code des Killers (Serie)
//   "Tatort: Explosive Mischung"                        -> Explosive Mischung
function parseMediathekTitle(title) {
  let t = title;
  let year = null;
  let series = false;
  t = t.replace(/\s*\((?:video in )?(?:klarer? sprache|englisch|ov|omu|originalversion|mit untertiteln?|hörfassung|audiodeskription)\)/gi, "");
  const y1 = t.match(/\((\d{4})\)/);
  if (y1) { year = Number(y1[1]); t = t.replace(y1[0], ""); }
  const suffix = t.match(/\s[-–]\s(?:spielfilm|fernsehfilm|kinofilm|drama|thriller|komödie|krimi|tragikomödie|film)\b(.*)$/i);
  if (suffix) {
    const y2 = suffix[1].match(/(\d{4})\s*$/);
    if (y2 && !year) year = Number(y2[1]);
    t = t.slice(0, suffix.index);
  }
  if (/\((?:\d+\/\d+|S\d+\/E\d+)\)/i.test(t)) series = true;
  t = t.replace(/\s*\((?:\d+\/\d+|S\d+\/E\d+|\d+)\)/gi, "");
  t = t.replace(/^(?:tatort|polizeiruf 110)\s*[:\-–]\s*/i, "");
  return { base: t.replace(/\s+/g, " ").trim(), year, series };
}

function releaseYear(hit) {
  const d = hit.release_date || hit.first_air_date || "";
  return d ? Number(d.slice(0, 4)) : null;
}

// Mediathek-Eintrag bei TMDb suchen. Strenger als die Presse-Suche, weil
// Episodentitel oft Allerweltswörter sind ("Licht", "Cash"):
//  - Tatort/Polizeiruf: nur ein Treffer, der den Reihennamen im Titel trägt
//  - mit Jahresangabe: Jahr muss passen (±1)
//  - ohne Jahr: deutsche Produktion oder bekannter Titel (≥ 200 Stimmen)
async function tmdbValidateMediathek(r) {
  const { base, year, series } = parseMediathekTitle(r.title);
  if (!base) return null;
  const reihe = /^polizeiruf/i.test(r.topic || "") ? "Polizeiruf 110"
    : /^tatort/i.test(r.topic || "") ? "Tatort" : null;

  const query = reihe ? `${reihe} ${base}` : base;
  const wanted = new Set(reihe ? [normTitle(`${reihe} ${base}`)] : [normTitle(base)]);
  const data = await tmdb("/search/multi", { query, include_adult: "false" });
  const hits = (data.results || []).filter(h =>
    (h.media_type === "movie" || h.media_type === "tv") && (!series || h.media_type === "tv")
  );
  return hits.find(h => {
    const names = [h.title, h.name, h.original_title, h.original_name].filter(Boolean).map(normTitle);
    if (!names.some(n => wanted.has(n))) return false;
    const hy = releaseYear(h);
    if (year && hy) return Math.abs(hy - year) <= 1;
    return h.original_language === "de" || (h.vote_count || 0) >= 200;
  }) || null;
}

// Untergrenze schon beim Abruf (die App legt je nach Strenge noch drauf)
const MEDIATHEK_MIN_RATING = 6.5;
const MEDIATHEK_MIN_VOTES = 15;

async function collectMediathekItems(genreMap) {
  const collected = [];
  const seenTmdb = new Set();
  let failed = 0;

  for (const cat of MEDIATHEK_CATEGORIES) {
    try {
      // Mit TMDb-Prüfung fällt viel weg – deshalb großzügiger abrufen
      const results = await mvwQuery(cat.topic, cat.size * (cat.validate ? 5 : 3));
      let kept = 0, checked = 0;

      for (const r of results) {
        if (kept >= cat.size) break;
        const label = CHANNEL_LABELS[(r.channel || "").toLowerCase()];
        if (!label) continue;          // Sender ohne Eintrag in CHANNEL_LABELS überspringen
        if (isJunk(r)) continue;

        const item = {
          tmdb_id: null,
          title: r.title.trim(),
          type: "tv",
          overview: r.description || "",
          genres: cat.genres,          // fest, nicht geraten
          keywords: [r.topic].filter(Boolean),
          rating: null,
          vote_count: 0,
          poster_path: null,
          url: r.url_website || null,
          duration: r.duration || null,
          providers: { netflix: null, prime: null, mediathek: label }
        };

        if (cat.validate) {
          if (checked >= cat.size * 4) break; // TMDb-Abfragen begrenzen
          checked++;
          let hit = null;
          try { hit = await tmdbValidateMediathek(r); } catch { hit = null; }
          if (!hit) continue;                                   // unbekannt -> raus
          if ((hit.vote_average || 0) < MEDIATHEK_MIN_RATING) continue;
          if ((hit.vote_count || 0) < MEDIATHEK_MIN_VOTES) continue;
          const key = `${hit.media_type}-${hit.id}`;
          if (seenTmdb.has(key)) continue;                      // weitere Teile/Fassungen
          seenTmdb.add(key);
          Object.assign(item, {
            tmdb_id: hit.id,
            title: hit.title || hit.name,
            type: hit.media_type,
            overview: hit.overview || item.overview,
            genres: (hit.genre_ids || []).map(id => genreMap[id]).filter(Boolean),
            rating: hit.vote_average,
            vote_count: hit.vote_count || 0,
            original_language: hit.original_language || null,
            poster_path: hit.poster_path || null
          });
          if (!item.genres.length) item.genres = cat.genres;
          if (LOWBROW.test(item.title)) continue;
        }

        collected.push(item);
        kept++;
      }
      console.log(`  "${cat.topic}" -> ${kept} übernommen (von ${results.length}${cat.validate ? `, ${checked} bei TMDb geprüft` : ""})`);
    } catch (e) {
      failed++;
      console.warn(`  "${cat.topic}" -> FEHLER: ${e.message}`);
    }
  }

  // Duplikate entfernen
  const seen = new Set();
  const unique = collected.filter(it => {
    const key = it.tmdb_id != null ? `t:${it.tmdb_id}` : it.title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Mediathek: ${unique.length} Titel (${failed} Abfragen fehlgeschlagen)`);
  if (!unique.length) {
    console.warn("WARNUNG: Keine Mediathek-Inhalte gefunden.");
  }
  return unique;
}

// Titel, die TMDb als "kostenlos in der Mediathek" kennt, haben noch keinen
// Direktlink – den liefert MediathekViewWeb über eine Titelsuche.
async function addMediathekLinks(items) {
  for (const it of items) {
    if (!it.providers.mediathek || it.url) continue;
    try {
      const results = await mvwQuery(it.title, 15, { fields: ["title", "topic"], durationMin: 1200 });
      const want = normTitle(it.title);
      const hit = results.find(r =>
        CHANNEL_LABELS[(r.channel || "").toLowerCase()] && !isJunk(r) &&
        (normTitle(r.topic) === want || normTitle(r.title) === want || normTitle(r.title).startsWith(want + " "))
      );
      if (hit && hit.url_website) {
        it.url = hit.url_website;
        it.providers.mediathek = CHANNEL_LABELS[hit.channel.toLowerCase()];
      }
    } catch { /* ohne Direktlink bleibt der JustWatch-Link */ }
  }
}

// ---------------------------------------------------------------
// Presse-Feeds als Entdeckungsquelle
//
// Ansatz: Es wird KEIN Artikeltext übernommen. Stattdessen werden die in
// Schlagzeilen erwähnten Werktitel extrahiert – die deutsche Filmpresse
// setzt sie zuverlässig in typografische Anführungszeichen („…"). Diese
// Kandidaten laufen anschließend durch dieselbe Prüfung wie alles andere:
// TMDb-Abgleich, Verfügbarkeit im Abo, Bewertung, Genre. Was das nicht
// besteht, fliegt raus – lieber keine Treffer als Müll.
// ---------------------------------------------------------------

// Pro Quelle mehrere Kandidaten-URLs: Feed-Adressen ändern sich gelegentlich.
// Es wird die erste genommen, die tatsächlich Einträge liefert – im Log ist
// sichtbar, welche das war.
const PRESS_FEEDS = [
  { label: "Serienjunkies", urls: [
      "https://www.serienjunkies.de/rss/neuigkeiten.xml",
      "https://www.serienjunkies.de/feed/",
      "https://www.serienjunkies.de/rss/news.xml"
  ]},
  { label: "Filmstarts", urls: [
      "https://www.filmstarts.de/rss/news.xml",
      "https://www.filmstarts.de/rss/nachrichten.xml",
      "https://www.filmstarts.de/rss/"
  ]},
  { label: "Filmdienst", urls: [
      "https://www.filmdienst.de/rss/artikel",
      "https://www.filmdienst.de/rss",
      "https://www.filmdienst.de/feed"
  ]},
  { label: "Moviepilot", urls: [
      "https://www.moviepilot.de/news.rss",
      "https://www.moviepilot.de/news/feed"
  ]}
];

const MAX_PRESS_CANDIDATES = 40; // begrenzt die Zahl der TMDb-Abfragen

function stripTags(s) {
  return (s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    // Anführungszeichen kommen in Feeds oft als Entity (&#8222; &bdquo; …)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&bdquo;/g, "\u201E").replace(/&ldquo;/g, "\u201C").replace(/&rdquo;/g, "\u201D")
    .replace(/&raquo;/g, "\u00BB").replace(/&laquo;/g, "\u00AB")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

// Werktitel aus einer Schlagzeile ziehen. Nur echte Anführungszeichen-Paare:
// „Titel“ (deutsch), “Titel”, »Titel«, «Titel» und "Titel". Der einfache
// Apostroph zählt bewusst nicht – sonst wird aus „Netflix' neue Serie …"
// ein Wortfetzen zum Kandidaten.
const QUOTE_PATTERNS = [
  /\u201E([^\u201E\u201C\u201D"]{2,60})[\u201C\u201D"]/g,  // „…“  „…”  „…"
  /\u201C([^\u201E\u201C\u201D"]{2,60})\u201D/g,            // “…”
  /\u00BB([^\u00AB\u00BB]{2,60})\u00AB/g,                     // »…«
  /\u00AB([^\u00AB\u00BB]{2,60})\u00BB/g,                     // «…»
  /(?:^|[^\w\u201E])"([^"\u201E\u201C\u201D]{2,60})"/g        // "…"
];

function extractQuotedTitles(text) {
  const out = new Set();
  QUOTE_PATTERNS.forEach(re => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = m[1].trim();
      // Offensichtliche Nicht-Titel aussortieren
      if (!t) continue;
      if (t.split(/\s+/).length > 8) continue;
      if (/^(staffel|season|folge|teil)\b/i.test(t)) continue;
      out.add(t);
    }
  });
  return [...out];
}

async function fetchFeedXml(feed) {
  const errors = [];
  for (const url of feed.urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "StreaMeGuide/1.0 (personal use)", "Accept": "application/rss+xml, application/xml, text/xml, */*" }
      });
      if (!res.ok) { errors.push(`${url} -> HTTP ${res.status}`); continue; }
      const xml = await res.text();
      if (!/<item[\s>]/i.test(xml)) { errors.push(`${url} -> keine <item>-Einträge`); continue; }
      console.log(`  ${feed.label}: Feed ok (${url})`);
      return xml;
    } catch (e) {
      errors.push(`${url} -> ${e.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function fetchFeedTitles(feed) {
  const xml = await fetchFeedXml(feed);

  const items = xml.split(/<item[\s>]/i).slice(1);
  const found = [];
  items.slice(0, 40).forEach(chunk => {
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (!titleMatch) return;
    const headline = stripTags(titleMatch[1]);
    const link = linkMatch ? stripTags(linkMatch[1]) : null;
    extractQuotedTitles(headline).forEach(name => {
      found.push({ name, source: feed.label, url: link });
    });
  });
  return found;
}

// Für den Titelvergleich: Groß/Klein, Satzzeichen und Leerraum ignorieren
function normTitle(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " und ")
    .replace(/[^a-z0-9ß]+/g, " ")
    .trim();
}

async function tmdbSearch(name) {
  const data = await tmdb("/search/multi", { query: name, include_adult: "false" });
  const hits = (data.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv");
  // Nur ein echter Namenstreffer zählt (deutscher oder Originaltitel).
  // Kein Rückgriff auf das erstbeste Ergebnis: TMDb liefert zu fast jedem
  // Suchbegriff irgendetwas – lieber keine Treffer als Müll.
  const wanted = normTitle(name);
  if (!wanted) return null;
  return hits.find(h =>
    [h.title, h.name, h.original_title, h.original_name].some(t => t && normTitle(t) === wanted)
  ) || null;
}

async function collectPressItems(genreMap, existingKeys) {
  const candidates = [];
  for (const feed of PRESS_FEEDS) {
    try {
      const found = await fetchFeedTitles(feed);
      candidates.push(...found);
      console.log(`  ${feed.label} -> ${found.length} erwähnte Titel`);
    } catch (e) {
      console.warn(`  ${feed.label} -> FEHLER: ${e.message}`);
    }
  }

  // Nach Häufigkeit sortieren: was mehrfach erwähnt wird, ist relevanter
  const counts = new Map();
  candidates.forEach(c => {
    const key = c.name.toLowerCase();
    if (!counts.has(key)) counts.set(key, { ...c, mentions: 0 });
    counts.get(key).mentions++;
  });
  const ranked = [...counts.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, MAX_PRESS_CANDIDATES);

  console.log(`  ${ranked.length} Kandidaten werden bei TMDb geprüft`);

  const items = [];
  for (const cand of ranked) {
    try {
      const hit = await tmdbSearch(cand.name);
      if (!hit) continue;

      const type = hit.media_type;
      if (existingKeys.has(`${type}-${hit.id}`)) continue; // schon über TMDb-Listen drin
      if (LOWBROW.test(hit.title || hit.name || "")) continue;

      const providers = await watchProviders(type, hit.id);
      if (!isAvailable(providers)) continue; // nicht im Abo/in der Mediathek -> raus

      const kw = await keywords(type, hit.id);
      items.push({
        tmdb_id: hit.id,
        title: hit.title || hit.name,
        type,
        overview: hit.overview || "",
        genres: (hit.genre_ids || []).map(id => genreMap[id]).filter(Boolean),
        keywords: kw,
        rating: hit.vote_average || null,
        vote_count: hit.vote_count || 0,
        poster_path: hit.poster_path || null,
        justwatch: providers.link,
        original_language: hit.original_language || null,
        providers: { netflix: providers.netflix, prime: providers.prime, mediathek: providers.mediathek },
        buzz: { source: cand.source, url: cand.url, mentions: cand.mentions }
      });
      existingKeys.add(`${type}-${hit.id}`);
    } catch (e) {
      // einzelne Fehlschläge stillschweigend überspringen
    }
  }

  console.log(`Presse: ${items.length} Titel im Abo verfügbar`);
  return items;
}

async function main() {
  const genreMap = await genreMaps();

  console.log("Hole TMDb-Titel (Netflix/Prime im Abo, Mediathek kostenlos) …");
  const tmdbItems = await collectTmdbItems(genreMap);
  console.log(`TMDb: ${tmdbItems.length} Titel im Abo verfügbar`);

  const existingKeys = new Set(tmdbItems.map(it => `${it.type}-${it.tmdb_id}`));

  console.log("Werte Presse-Feeds aus …");
  const pressItems = await collectPressItems(genreMap, existingKeys);

  console.log("Hole Mediathek-Inhalte …");
  const mediathekRaw = await collectMediathekItems(genreMap);

  // Mediathek-Titel, die TMDb schon kennt (z. B. auch bei Netflix), nicht
  // doppelt führen: Mediathek-Angaben am vorhandenen Eintrag ergänzen.
  const byKey = new Map([...tmdbItems, ...pressItems].map(it => [`${it.type}-${it.tmdb_id}`, it]));
  const mediathekItems = mediathekRaw.filter(it => {
    const existing = it.tmdb_id != null && byKey.get(`${it.type}-${it.tmdb_id}`);
    if (!existing) return true;
    existing.providers.mediathek = existing.providers.mediathek || it.providers.mediathek;
    existing.url = existing.url || it.url;
    return false;
  });

  console.log("Suche Mediathek-Direktlinks …");
  await addMediathekLinks([...tmdbItems, ...pressItems]);

  const output = {
    schema: 2,                       // Kennzeichnet den überarbeiteten Abgleich
    generated_at: new Date().toISOString(),
    items: [...tmdbItems, ...pressItems, ...mediathekItems]
  };

  await writeFile("recommendations.json", JSON.stringify(output, null, 2));

  const perProvider = { netflix: 0, prime: 0, mediathek: 0, buzz: 0 };
  output.items.forEach(it => {
    if (it.providers.netflix === "flatrate") perProvider.netflix++;
    if (it.providers.prime === "flatrate") perProvider.prime++;
    if (it.providers.mediathek) perProvider.mediathek++;
    if (it.buzz) perProvider.buzz++;
  });

  console.log("---");
  console.log(`Gesamt: ${output.items.length} Titel`);
  console.log(`  Netflix:   ${perProvider.netflix}`);
  console.log(`  Prime:     ${perProvider.prime}`);
  console.log(`  Mediathek: ${perProvider.mediathek}`);
  console.log(`  davon aus der Presse entdeckt: ${perProvider.buzz}`);
}

main().catch(err => { console.error(err); process.exit(1); });
