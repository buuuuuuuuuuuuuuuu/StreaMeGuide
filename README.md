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
- Die Mediathek-Auswahl deckt ARD (inkl. Dritte: BR, NDR, WDR, SWR, MDR,
  HR, RBB, SR), ZDF, arte und 3sat ab. Filter: Mindestlänge 25 Min.,
  aktuellste Einträge je Sender, Ballast wie Audiodeskription oder
  Nachrichten wird verworfen. Genres werden heuristisch aus Thema und Titel
  abgeleitet, damit die Scoring-Logik greift.
- **ZDFneo gibt es in dieser Datenquelle nicht als eigenen Sender** – die
  Inhalte laufen dort unter „ZDF" und tauchen entsprechend beschriftet auf.
  Feintuning in `scripts/fetch-recommendations.mjs` über `MEDIATHEK_GROUPS`.
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
