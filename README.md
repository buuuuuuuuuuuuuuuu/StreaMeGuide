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

**Regeln lockern:** Am Listenende sitzt ein Button „🔓 Regeln lockern" mit
der Anzahl der Titel in der Reserve. Ein Tipp darauf zeigt sie alle an, nach
Punktzahl einsortiert. Harte Ausschlüsse bleiben auch dann draußen.

**Steuerleiste:** Der Strenge-Regler (Locker/Normal/Streng) steht direkt
über der Liste, nicht mehr im eingeklappten Setup-Panel.

**Presse-Treffer** stehen in einer eigenen Sektion „🔥 Gerade besprochen"
ganz oben, damit sie nicht zwischen den Anbieterlisten untergehen.

**Mindestbelegung:** Jeder Bereich (Netflix, Prime, Mediathek) zeigt
mindestens zwei Titel. Reicht die reguläre Auswahl nicht, wird aus der
Reserve aufgefüllt – also aus Titeln, die nur an einer *weichen* Hürde
gescheitert sind (Bewertung, Stimmenzahl, Genre-Passung). Harte
Ausschlüsse (abgelehnte Genres, Sperrwörter, bereits bewertet, Füllmaterial)
werden nie aufgeweicht. Aufgefüllte Titel tragen ein Badge „🔓 gelockert"
und eine gestrichelte Umrandung.

**Genre-Namen:** TMDb liefert bei `language=de-DE` deutsche Genre-Namen
(„Krimi", „Dokumentarfilm"). Die Mediathek-Kategorien verwenden dieselben
Bezeichnungen. Zusätzlich normalisiert die App den Vergleich über eine
Synonymtabelle, damit ältere Profile und Datenstände weiter funktionieren.

## Presse-Feeds als Entdeckungsquelle
Zusätzlich werden RSS-Feeds von Serienjunkies, Filmstarts und Filmdienst
ausgewertet. Dabei wird **kein Artikeltext übernommen**: Aus den
Schlagzeilen werden nur die erwähnten Werktitel extrahiert (die deutsche
Filmpresse setzt sie zuverlässig in typografische Anführungszeichen). Diese
Kandidaten laufen anschließend durch dieselbe Prüfung wie alles andere –
TMDb-Abgleich, Verfügbarkeit im Abo, Bewertung, Genre-Passung. Was das
nicht besteht, fliegt raus.

Titel, die mehrfach erwähnt werden, gelten als relevanter und bekommen
einen kleinen Bonus. In der App tragen sie ein Badge mit der Quelle und
einen Link zum Artikel.

Feeds anpassen: `PRESS_FEEDS` in `scripts/fetch-recommendations.mjs`.

## Details zu einem Titel
Ein Tipp auf eine Karte öffnet ein Detailblatt: vollständige Beschreibung,
Poster (sofern TMDb eines liefert), Genres, Laufzeit, Bewertung mit
Stimmenzahl sowie die passenden Links – Mediathek-Seite, TMDb-Seite und,
falls der Titel über einen Presse-Feed gefunden wurde, der Artikel.

Die Beschreibungen stecken bereits in `recommendations.json`
(`overview`), es entsteht also kein zusätzlicher Abruf. Poster werden bei
Bedarf direkt von `image.tmdb.org` nachgeladen.

Wischen bleibt unverändert: nach links bewerten, nach rechts aussortieren.
Ein Tipp ohne Bewegung öffnet die Details – in der "Beide"-Ansicht ist nur
das Antippen aktiv, weil eine Bewertung immer einer Person zugeordnet sein
muss.

## Links zu den Anbietern
Jede Karte trägt den Anbieter-Badge als anklickbaren Link; im Detailblatt
stehen zusätzlich große Buttons.

- **Mediathek** – führt direkt auf die Sendungsseite (`url_website` aus der
  MediathekViewWeb-Antwort). Auf iOS/Android öffnet sich die ARD- bzw.
  ZDF-App, wenn sie installiert ist.
- **Netflix / Prime Video** – führen zur **Suche nach dem Titel** innerhalb
  des Anbieters, nicht auf die Detailseite. Grund: Weder TMDb noch die
  Provider-Daten liefern die anbieterinternen Titel-IDs, ohne die sich eine
  Detailseiten-Adresse nicht bilden lässt. Über Universal Links öffnet sich
  die App, sofern installiert.
- **„Wo läuft es sonst?"** – JustWatch-Seite zum Titel, kommt als `link` aus
  der TMDb-Provider-Antwort und listet alle Anbieter inklusive Direktlinks.

## Hell / Dunkel
Oben rechts sitzt ein Umschalter (🌙 / ☀️). Ohne eigene Wahl folgt die App
der Systemeinstellung des Geräts und reagiert auch auf spätere Wechsel;
sobald einmal manuell umgeschaltet wurde, gilt diese Wahl dauerhaft
(`streamguide:theme` im localStorage).

Umgesetzt über `[data-theme="dark"]` auf `<html>`, gesetzt von einem
Inline-Skript im `<head>` – sonst blitzt beim Start kurz das helle Layout
auf. Die Formensprache bleibt gleich: dunkles Pflaumen-Papier, helle
Konturen, Pastelltöne weiterhin als Akzentflächen. Damit Schrift auf diesen
Flächen in beiden Modi lesbar bleibt, gibt es das Token `--on-accent`
(immer dunkel); alle Kontraste liegen über 6:1.

## Bewerten in der "Beide"-Ansicht
Wischen und Bewerten funktionieren auch im gemeinsamen Modus. Die Eintragung
landet dann in **beiden** geladenen Profilen – der Abend wird ja zusammen
verbracht, und ein "nicht mein Ding" soll nicht nur bei Profil A hängen
bleiben. Die Dialoge weisen mit "Wird für beide Profile gespeichert" darauf
hin.

Beim Herz-Button richtet sich die Aktion nach Profil A: War der Titel dort
markiert, wird er in beiden entfernt, sonst in beiden gesetzt – sonst würden
die Profile bei jedem Tipp gegeneinander laufen.
