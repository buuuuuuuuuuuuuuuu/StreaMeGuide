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

// Sendergruppen. Wichtig: In der MediathekView-Filmliste heisst arte
// "ARTE.DE", und ZDFneo existiert NICHT als eigener Sender – diese Inhalte
// laufen unter "ZDF". "ARD" ist nur Das Erste, die Dritten sind eigene
// Sender. Deshalb wird pro Gruppe eine Liste von Sendernamen abgefragt und
// case-insensitiv verglichen statt strikt auf Gleichheit geprüft.
const MEDIATHEK_GROUPS = [
  { label: "ARD", channels: ["ARD", "BR", "NDR", "WDR", "SWR", "MDR", "HR", "RBB", "SR"] },
  { label: "ZDF", channels: ["ZDF"] },
  { label: "arte", channels: ["ARTE.DE"] },
  { label: "3sat", channels: ["3Sat"] }
];

// Grober Themen-zu-Genre-Mapper, damit Mediathek-Titel im Scoring
// überhaupt mit den Vorlieben abgeglichen werden können.
const TOPIC_GENRE_HINTS = [
  [/tatort|polizeiruf|krimi|mord|kommissar|fahnder/i, ["Crime", "Drama"]],
  [/doku|reportage|geschichte|terra x|wissen|universum|planet|natur/i, ["Documentary"]],
  [/comedy|satire|kabarett|heute-show|humor/i, ["Comedy"]],
  [/thriller|spannung/i, ["Thriller"]],
  [/liebe|romanze|herzkino/i, ["Romance"]],
  [/kinder|kika|maus|sandmännchen/i, ["Family", "Animation"]],
  [/konzert|musik|oper|klassik/i, ["Music"]],
  [/sci-?fi|science.?fiction|zukunft/i, ["Sci-Fi"]],
  [/krieg|weltkrieg|ns-|nationalsozial/i, ["History", "War"]],
  [/film|spielfilm|drama/i, ["Drama"]]
];

function guessGenres(topic, title, description) {
  const hay = [topic, title, description].filter(Boolean).join(" ");
  const found = new Set();
  TOPIC_GENRE_HINTS.forEach(([re, genres]) => {
    if (re.test(hay)) genres.forEach(g => found.add(g));
  });
  return [...found];
}

// Offensichtlicher Ballast, der keine Empfehlung wert ist
const MEDIATHEK_JUNK = /audiodeskription|hörfassung|gebärdensprache|livestream|tagesschau in 100|wetter|nachrichten|kurzfassung|trailer|vorschau|höraufnahme/i;

async function mvwQuery(channel, size = 25) {
  const body = {
    queries: [{ fields: ["channel"], query: channel }],
    sortBy: "timestamp",
    sortOrder: "desc",
    future: false,
    offset: 0,
    size,
    duration_min: 1500 // ab 25 Minuten: filtert Beitraege und Haeppchen raus
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

async function collectMediathekItems() {
  const collected = [];
  let queried = 0, failed = 0;

  for (const group of MEDIATHEK_GROUPS) {
    for (const channel of group.channels) {
      queried++;
      try {
        const results = await mvwQuery(channel);

        // Case-insensitiver Abgleich: die Suche ist unscharf und liefert
        // auch benachbarte Sender zurueck.
        const wanted = channel.toLowerCase();
        const matching = results.filter(r => (r.channel || "").toLowerCase() === wanted);

        matching.forEach(r => {
          const title = (r.title || "").trim();
          if (!title) return;
          if (MEDIATHEK_JUNK.test(title) || MEDIATHEK_JUNK.test(r.topic || "")) return;

          collected.push({
            tmdb_id: null,
            title,
            type: "tv",
            overview: r.description || "",
            genres: guessGenres(r.topic, title, r.description),
            keywords: [r.topic].filter(Boolean),
            rating: null,
            vote_count: 0,
            poster_path: null,
            url: r.url_website || null,
            providers: { netflix: null, prime: null, mediathek: group.label }
          });
        });

        console.log(`  ${channel} -> ${matching.length} Treffer (von ${results.length})`);
      } catch (e) {
        failed++;
        console.warn(`  ${channel} -> FEHLER: ${e.message}`);
      }
    }
  }

  // Duplikate entfernen (gleiche Sendung mehrfach ausgestrahlt)
  const seen = new Set();
  const unique = collected.filter(it => {
    const key = `${it.providers.mediathek}::${it.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Mediathek: ${unique.length} Titel aus ${queried} Abfragen (${failed} fehlgeschlagen)`);
  if (!unique.length) {
    console.warn("WARNUNG: Keine Mediathek-Inhalte gefunden. API erreichbar? Sendernamen korrekt?");
  }
  return unique;
}

async function main() {
  const genreMap = await genreMaps();

  console.log("Hole TMDb-Titel (Netflix/Prime im Abo) …");
  const tmdbItems = await collectTmdbItems(genreMap);
  console.log(`TMDb: ${tmdbItems.length} Titel im Abo verfügbar`);

  console.log("Hole Mediathek-Inhalte …");
  const mediathekItems = await collectMediathekItems();

  const output = {
    generated_at: new Date().toISOString(),
    items: [...tmdbItems, ...mediathekItems]
  };

  await writeFile("recommendations.json", JSON.stringify(output, null, 2));

  const perProvider = { netflix: 0, prime: 0, mediathek: 0 };
  output.items.forEach(it => {
    if (it.providers.netflix === "flatrate") perProvider.netflix++;
    if (it.providers.prime === "flatrate") perProvider.prime++;
    if (it.providers.mediathek) perProvider.mediathek++;
  });

  console.log("---");
  console.log(`Gesamt: ${output.items.length} Titel`);
  console.log(`  Netflix:   ${perProvider.netflix}`);
  console.log(`  Prime:     ${perProvider.prime}`);
  console.log(`  Mediathek: ${perProvider.mediathek}`);
}

main().catch(err => { console.error(err); process.exit(1); });
