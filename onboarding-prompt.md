# StreamGuide – Onboarding-Prompt (in einen beliebigen LLM-Chat kopieren)

Kopiere den folgenden Block komplett in einen Chat mit Claude, ChatGPT o. ä.
Am Ende bekommst du eine Datei, die du direkt in die StreamGuide-PWA hochlädst.

---

Du hilfst mir, mein Streaming-Geschmacksprofil zu ermitteln. Stelle mir dazu
nacheinander Fragen (kein Frageblock auf einmal, ein echter Dialog) zu:

1. Welche Genres/Stimmungen ich generell mag (Serien und Filme getrennt betrachten)
2. Welche Genres oder Formate mich nerven oder ich ausschließen will (z. B. Reality-TV, Doku-Soap, Trash)
3. Tempo/Ton: mag ich eher ruhig-charaktergetrieben, actionreich, dunkel/ernst, leicht/komödiantisch, gemischt
4. Eine grobe Qualitätsschwelle: bin ich bereit, auch Nischentitel mit wenig Bewertungen zu sehen, oder nur breit anerkannte Sachen
5. 3–8 Serien oder Filme, die ich besonders geliebt habe, und kurz warum (welches Element genau hat mir gefallen: Figuren, Atmosphäre, Plot-Twists, Humor, Optik...)
6. Irgendwelche Wiederkehrenden No-Gos (bestimmte Themen, Trigger, Über-Länge, zu viel Gewalt etc.)

Frag so lange nach, bis du ein klares Bild hast. Fasse zwischendurch kurz
zusammen, was du verstanden hast, und lass mich korrigieren.

Wenn du genug weißt, gib mir AUSSCHLIESSLICH das folgende JSON zurück
(keinen Fließtext davor oder danach, valides JSON, deutsche Begriffe für
Genres/Ton sind ok):

{
  "schema_version": 1,
  "profile_name": "<mein Name oder Kürzel>",
  "preferred_genres": ["..."],
  "excluded_genres": ["..."],
  "tone": ["..."],
  "pace": "ruhig|gemischt|schnell",
  "min_rating": <Zahl zwischen 5 und 8>,
  "keyword_boosts": ["..."],
  "keyword_blocks": ["..."],
  "loved_titles": [
    {"title": "...", "tmdb_id": null, "year": <Jahr oder null>}
  ],
  "notes": "<ein bis zwei Sätze Freitext-Zusammenfassung meines Geschmacks>"
}

Speichere die Antwort als Datei mit der Endung .json (z. B. `profil-anna.json`)
und lade sie in der StreamGuide-App unter "Profil hochladen" hoch.

---

## Später: Lieblingsserie einfach nachtragen
Für spätere Ergänzungen reicht ein Kurz-Prompt – lass dir wieder nur das
JSON-Fragment geben und füge es manuell dem `loved_titles`-Array in deiner
Datei hinzu, oder nutze in der App den Button "Lieblingstitel hinzufügen"
(sucht automatisch bei TMDb, kein LLM nötig).
