# StreamGuide

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
- Die Mediathek-Auswahl ist aktuell ein einfacher Heuristik-Filter (Sender
  ARD/ZDF, Mindestlänge 20 Min., letzte 48h) – Feintuning in
  `scripts/fetch-recommendations.mjs` möglich.
- Lieblingstitel-Ergänzung ohne LLM: In der App bei einem Titel auf das Herz
  tippen, das trägt ihn direkt in `loved_titles` des aktiven Profils ein.
  Über "Profil exportieren" lässt sich die aktualisierte Datei sichern.

## Versionierung
`APP_VERSION` in `app.js` und `service-worker.js` synchron halten, wie bei
den anderen Projekten.
