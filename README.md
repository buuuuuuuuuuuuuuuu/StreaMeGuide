# StreaMeGuide

Tägliche Streaming-Empfehlungen aus Netflix, Amazon Prime (nur wirklich im
Abo enthaltene Titel) und den öffentlich-rechtlichen Mediatheken – gefiltert
nach zwei individuellen Geschmacksprofilen.

## Funktionsweise
- **Onboarding**: `onboarding-prompt.md` in einen beliebigen LLM-Chat kopieren,
  im Dialog Geschmack ermitteln lassen, resultierendes JSON hochladen (Button
  in der App). Zwei Profile parallel möglich, dazu eine "Beide"-Ansicht mit
  der Schnittmenge.
- **Tägliche Daten**: `scripts/fetch-recommendations.mjs` läuft per GitHub
  Actions (`.github/workflows/daily-update.yml`), holt Trend-/Popularlisten
  von TMDb, prüft Watch-Provider für Deutschland (nur `flatrate`, also im
  Abo enthalten – Leih-/Kauftitel werden verworfen) und ergänzt aktuelle
  ARD/ZDF-Mediathek-Einträge über die MediathekViewWeb-API. Ergebnis landet
  als `recommendations.json` im Repo.
- **App** liest `recommendations.json` (Fallback: `recommendations.sample.json`
  zum Testen ohne eigenes Setup), filtert/scored pro Profil clientseitig und
  zeigt eine Tagesempfehlung plus Listen je Anbieter.

## Setup

1. **TMDb-API-Key** kostenlos erstellen: themoviedb.org → Einstellungen →
   API → "API Read Access Token (v4 auth)".
2. In deinem GitHub-Repo unter *Settings → Secrets and variables → Actions*
   ein Secret `TMDB_API_KEY` mit diesem Token anlegen.
3. Repo wie gewohnt auf GitHub Pages deployen (Branch/Ordner wie bei deinen
   anderen Projekten).
4. Im Actions-Tab den Workflow einmal manuell auslösen ("Run workflow"), um
   sofort ein erstes `recommendations.json` zu erzeugen. Danach läuft er
   automatisch täglich.
5. App öffnen, Onboarding-Prompt nutzen, Profil(e) hochladen.

## Grenzen (wichtig zu wissen)
- Netflix/Prime haben keine offizielle Katalog-API. Die Verfügbarkeits­daten
  kommen über TMDb (Quelle: JustWatch) und spiegeln die *regionale*
  Verfügbarkeit – nicht zwingend exakt deinen individuellen Tarif.
- Die Mediathek-Auswahl sucht gezielt nach Inhaltstypen (Tatort, Filme im
  Ersten, Terra X, Dokumentation, Herzkino, Kino, Konzert …) statt nach den
  neuesten Beiträgen – sonst dominieren Regionalmagazine, Nachrichten und
  Sport. Die Genres stehen pro Kategorie fest und werden NICHT aus
  Beschreibungstexten geraten. Mindestlänge 40 Min.
- Erfasste Sender: ARD inkl. Dritte, ZDF, arte, 3sat. **ZDFneo gibt es in
  dieser Datenquelle nicht als eigenen Sender** – die Inhalte laufen unter
  „ZDF". Kategorien und Sperrliste stehen in
  `scripts/fetch-recommendations.mjs` (`MEDIATHEK_CATEGORIES`,
  `MEDIATHEK_JUNK`).
- Lieblingstitel-Ergänzung ohne LLM: In der App bei einem Titel auf das Herz
  tippen, das trägt ihn direkt in `loved_titles` des aktiven Profils ein.
  Über "Profil exportieren" lässt sich die aktualisierte Datei sichern.

## Geräte-Sync (optional)
Profile lassen sich ohne Konto zwischen Geräten teilen – siehe
`SYNC-SETUP.md`. Zugriff regelt ein gemeinsames Haushalts-Token, das
serverseitig per Row Level Security geprüft wird. Ohne Sync bleibt alles
rein lokal im Browser (localStorage); dann sind die Export-Buttons das
Backup.

## Versionierung
`APP_VERSION` in `app.js` und `service-worker.js` synchron halten, wie bei
den anderen Projekten.

## Icons
Drei Varianten liegen unter `icons/varianten/`:

- **a-stapel** – aufgefächerte Sticker-Karten, greift das Signature-Element
  der Oberfläche auf (aktuell aktiv)
- **b-blob** – Marken-Blob mit Play-Zeichen, maximal reduziert
- **c-sorbet** – drei Kugeln für die drei Quellen, am verspieltesten

Wechseln: gewünschte Dateien nach `icons/icon-192.png` bzw.
`icons/icon-512.png` kopieren. Neu erzeugen lassen sie sich mit
`python3 icons/make_icons.py` (benötigt Pillow).

## Filterstrenge
Im Setup-Panel lässt sich einstellen, wie hart gefiltert wird:

- **Locker** – breite Auswahl, nur Ausschlüsse aus dem Profil greifen
- **Normal** (Standard) – mindestens 300 Bewertungen, Wertung ab 6,5; ohne
  Genre-Treffer muss die Wertung mindestens 7,5 betragen
- **Streng** – mindestens 1000 Bewertungen, Wertung ab 7,2, und ein echter
  Genre-Treffer ist Pflicht

Zusätzlich gilt in allen Stufen: Titel, deren Genres überwiegend aus
abgelehnten Sendungen stammen, werden ausgeschlossen. Mediathek-Titel haben
keine Bewertungen und sind von der Stimmen-Schwelle ausgenommen, müssen ab
"Normal" aber thematisch passen.

Angezeigt werden die besten 50 Treffer; der Rest ist über einen Button am
Listenende erreichbar.
