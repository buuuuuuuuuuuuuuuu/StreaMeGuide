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

async function collectMediathekItems() {
  // Grober Heuristik-Filter: Dokus/Reportagen der letzten 48h, Mindestlänge
  // 20 Minuten, damit News-Häppchen und Trailer rausfallen. Anpassbar.
  const body = {
    queries: [{ fields: ["topic"], query: "" }],
    sortBy: "timestamp",
    sortOrder: "desc",
    future: false,
    offset: 0,
    size: 30,
    duration_min: 1200
  };
  try {
    const res = await fetch("https://mediathekviewweb.de/api/query", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const results = data.result?.results || [];
    return results
      .filter(r => ["ARD", "ZDF"].includes(r.channel))
      .map(r => ({
        tmdb_id: null,
        title: r.title,
        type: "tv",
        overview: r.description || "",
        genres: [],
        keywords: [r.topic].filter(Boolean),
        rating: null,
        vote_count: 0,
        poster_path: null,
        providers: { netflix: null, prime: null, mediathek: r.channel }
      }));
  } catch (e) {
    console.warn("MediathekViewWeb nicht erreichbar:", e.message);
    return [];
  }
}

async function main() {
  const genreMap = await genreMaps();
  const [tmdbItems, mediathekItems] = await Promise.all([
    collectTmdbItems(genreMap),
    collectMediathekItems()
  ]);

  const output = {
    generated_at: new Date().toISOString(),
    items: [...tmdbItems, ...mediathekItems]
  };

  await writeFile("recommendations.json", JSON.stringify(output, null, 2));
  console.log(`recommendations.json geschrieben: ${output.items.length} Titel`);
}

main().catch(err => { console.error(err); process.exit(1); });
