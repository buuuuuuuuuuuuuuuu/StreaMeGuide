# StreamGuide – Datenmodelle (intern, zur Referenz)

## preferences.json (pro Profil, Upload durch Nutzer)
{
  "schema_version": 1,
  "profile_name": "string",
  "preferred_genres": ["string"],
  "excluded_genres": ["string"],
  "tone": ["string"],
  "pace": "ruhig|gemischt|schnell",
  "min_rating": 6.5,
  "keyword_boosts": ["string"],
  "keyword_blocks": ["string"],
  "loved_titles": [{"title":"string","tmdb_id":number|null,"year":number|null}],
  "notes": "string"
}

## recommendations.json (täglich generiert, GitHub Action)
{
  "generated_at": "ISO-8601",
  "items": [
    {
      "tmdb_id": number,
      "title": "string",
      "type": "movie|tv",
      "overview": "string",
      "genres": ["string"],
      "keywords": ["string"],
      "rating": number,
      "vote_count": number,
      "poster_path": "string|null",
      "providers": {"netflix": "flatrate|null", "prime": "flatrate|rent|buy|null", "mediathek": "ARD|ZDF|null"}
    }
  ]
}
