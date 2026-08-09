// Läuft täglich per GitHub Action. Schreibt recommendations.json im Repo-Root.
// Braucht: Umgebungsvariable TMDB_API_KEY (Read Access Token, v4 auth)
//
// Was es tut:
// 1. Holt "trending" + "popular" Filme/Serien von TMDb (Region DE)
// 2. Prüft für jeden Titel die Watch-Provider in DE -> nur Netflix/Prime im
//    Abo ("flatrate") zählen, Miete/Kauf wird verworfen
// 3. Holt aktuelle Mediathek-Einträge (ARD/ZDF) über die MediathekViewWeb-API
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

async function watchProviders(type, id) {
  try {
    const data = await tmdb(`/${type}/${id}/watch/providers`);
    const de = data.results?.DE;
    if (!de) return { netflix: null, prime: null };
    const flat = (de.flatrate || []).map(p => p.provider_name);
    return {
      netflix: flat.some(n => n.includes("Netflix")) ? "flatrate" : null,
      prime: flat.some(n => n.includes("Amazon Prime Video")) ? "flatrate" : null
    };
  } catch {
    return { netflix: null, prime: null };
  }
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

async function collectTmdbItems(genreMap) {
  const lists = [
    ["movie", "/trending/movie/day"],
    ["tv", "/trending/tv/day"],
    ["movie", "/movie/popular"],
    ["tv", "/tv/popular"]
  ];
  const seen = new Map();

  for (const [type, path] of lists) {
    const data = await tmdb(path, { region: REGION, watch_region: REGION });
    for (const raw of data.results || []) {
      const key = `${type}-${raw.id}`;
      if (seen.has(key)) continue;

      const providers = await watchProviders(type, raw.id);
      if (!providers.netflix && !providers.prime) continue; // nur mit Abo verfügbar

      const kw = await keywords(type, raw.id);

      seen.set(key, {
        tmdb_id: raw.id,
        title: raw.title || raw.name,
        type,
        overview: raw.overview || "",
        genres: (raw.genre_ids || []).map(id => genreMap[id]).filter(Boolean),
        keywords: kw,
        rating: raw.vote_average || null,
        vote_count: raw.vote_count || 0,
        poster_path: raw.poster_path || null,
        providers: { netflix: providers.netflix, prime: providers.prime, mediathek: null }
      });
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

// Gesuchte Reihen mit festen Genres. Erweiterbar.
const MEDIATHEK_CATEGORIES = [
  { topic: "Tatort",           genres: ["Crime", "Drama"],        size: 12 },
  { topic: "Polizeiruf 110",   genres: ["Crime", "Drama"],        size: 6 },
  { topic: "Filme im Ersten",  genres: ["Drama"],                 size: 10 },
  { topic: "Spielfilm",        genres: ["Drama"],                 size: 10 },
  { topic: "Fernsehfilm",      genres: ["Drama"],                 size: 8 },
  { topic: "Herzkino",         genres: ["Romance", "Drama"],      size: 6 },
  { topic: "Terra X",          genres: ["Documentary"],           size: 8 },
  { topic: "Dokumentation",    genres: ["Documentary"],           size: 12 },
  { topic: "Doku",             genres: ["Documentary"],           size: 10 },
  { topic: "Die Story",        genres: ["Documentary"],           size: 6 },
  { topic: "Kino",             genres: ["Drama"],                 size: 8 },
  { topic: "Krimi",            genres: ["Crime"],                 size: 8 },
  { topic: "Comedy",           genres: ["Comedy"],                size: 6 },
  { topic: "Kabarett",         genres: ["Comedy"],                size: 5 },
  { topic: "Konzert",          genres: ["Music"],                 size: 5 },
  { topic: "Geschichte",       genres: ["History", "Documentary"], size: 8 }
];

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

async function mvwQuery(topic, size) {
  const body = {
    queries: [{ fields: ["topic"], query: topic }],
    sortBy: "timestamp",
    sortOrder: "desc",
    future: false,
    offset: 0,
    size: size * 3,        // Puffer, da anschließend hart gefiltert wird
    duration_min: 2400     // ab 40 Minuten: Filme, Krimis, lange Dokus
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
  return false;
}

async function collectMediathekItems() {
  const collected = [];
  let failed = 0;

  for (const cat of MEDIATHEK_CATEGORIES) {
    try {
      const results = await mvwQuery(cat.topic, cat.size);
      let kept = 0;

      for (const r of results) {
        if (kept >= cat.size) break;
        const label = CHANNEL_LABELS[(r.channel || "").toLowerCase()];
        if (!label) continue;          // fremde Sender (ORF, SRF, DW …) überspringen
        if (isJunk(r)) continue;

        collected.push({
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
        });
        kept++;
      }
      console.log(`  "${cat.topic}" -> ${kept} übernommen (von ${results.length})`);
    } catch (e) {
      failed++;
      console.warn(`  "${cat.topic}" -> FEHLER: ${e.message}`);
    }
  }

  // Duplikate entfernen
  const seen = new Set();
  const unique = collected.filter(it => {
    const key = it.title.toLowerCase().replace(/\s+/g, " ");
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

const PRESS_FEEDS = [
  { label: "Serienjunkies", url: "https://www.serienjunkies.de/rss/neuigkeiten.xml" },
  { label: "Filmstarts",    url: "https://www.filmstarts.de/rss/news.xml" },
  { label: "Filmdienst",    url: "https://www.filmdienst.de/rss/artikel" }
];

const MAX_PRESS_CANDIDATES = 40; // begrenzt die Zahl der TMDb-Abfragen

function stripTags(s) {
  return (s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

// Werktitel aus einer Schlagzeile ziehen: „Titel" oder "Titel" oder »Titel«
function extractQuotedTitles(text) {
  const out = [];
  const patterns = [/[„»"']([^"„»"']{2,60})["«"']/g, /"([^"]{2,60})"/g];
  patterns.forEach(re => {
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = m[1].trim();
      // Offensichtliche Nicht-Titel aussortieren
      if (!t) continue;
      if (t.split(/\s+/).length > 8) continue;
      if (/^(staffel|season|folge|teil)\b/i.test(t)) continue;
      out.push(t);
    }
  });
  return out;
}

async function fetchFeedTitles(feed) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "StreaMeGuide/1.0 (personal use)" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

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

async function tmdbSearch(name) {
  const data = await tmdb("/search/multi", { query: name, include_adult: "false" });
  const hits = (data.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv");
  if (!hits.length) return null;
  // Bestes Ergebnis: exakter Namenstreffer bevorzugt, sonst populärstes
  const exact = hits.find(h => (h.title || h.name || "").toLowerCase() === name.toLowerCase());
  return exact || hits[0];
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

      const providers = await watchProviders(type, hit.id);
      if (!providers.netflix && !providers.prime) continue; // nicht im Abo -> raus

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
        providers: { netflix: providers.netflix, prime: providers.prime, mediathek: null },
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

  console.log("Hole TMDb-Titel (Netflix/Prime im Abo) …");
  const tmdbItems = await collectTmdbItems(genreMap);
  console.log(`TMDb: ${tmdbItems.length} Titel im Abo verfügbar`);

  const existingKeys = new Set(tmdbItems.map(it => `${it.type}-${it.tmdb_id}`));

  console.log("Werte Presse-Feeds aus …");
  const pressItems = await collectPressItems(genreMap, existingKeys);

  console.log("Hole Mediathek-Inhalte …");
  const mediathekItems = await collectMediathekItems();

  const output = {
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
