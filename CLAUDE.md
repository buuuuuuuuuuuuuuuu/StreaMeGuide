# StreaMeGuide – Projektkontext für Claude Code

## Was die App ist
Deutschsprachige PWA mit täglichen Streaming-Empfehlungen für zwei Haushaltsprofile.
Leitprinzip: **„Lieber keine Treffer als Müll"** – Qualität vor Menge. Im Zweifel
lieber weniger Ergebnisse anzeigen als schlechte.

- Name immer exakt **StreaMeGuide** (großes M mitten im Wort) in allen sichtbaren Texten.
- Sprache der Oberfläche: Deutsch.

## Arbeitsweise (wichtig)
- Der Besitzer arbeitet ausschließlich vom iPhone (Safari, GitHub Mobile). Es gibt kein Terminal und keinen lokalen Editor.
- Änderungen immer auf einem eigenen Branch, am Ende ein Pull Request mit kurzer, verständlicher Beschreibung auf Deutsch: was geändert wurde, was getestet wurde und worauf beim Test auf dem iPhone zu achten ist.
- Kleine, in sich geschlossene Änderungen. Eine Aufgabe pro Session/PR.
- Keine neuen Abhängigkeiten oder Build-Schritte einführen: Es bleibt Vanilla HTML/CSS/JS.
- Bei Unsicherheit über Verhalten oder Design lieber im PR-Text nachfragen, als zu raten.

## Tech-Stack
- Vanilla HTML/CSS/JS, gehostet auf GitHub Pages
- GitHub Actions Cron (Node.js) für den täglichen Daten-Abruf
- Datenquellen: TMDb API, MediathekViewWeb, Presse-RSS (Serienjunkies, Filmstarts, Filmdienst, Moviepilot)
- Optionaler Supabase-Sync (geteiltes Haushalts-Token + RLS, keine Nutzerkonten), Tabelle `sg_profiles`
- Fonts: Syne (Überschriften), Plus Jakarta Sans (Fließtext)

## Design-System „Sorbet Sticker"
- Pastellflächen (Lavendel, Butter-Gelb, Bubblegum-Pink, Mint, Himmelblau, Pfirsich)
- Harte 2,5-px-Outlines in Tinte, Offset-Schatten ohne Blur
- Stacked-Card-Hero ist das visuelle Markenzeichen
- Nur zwei Schriftfamilien (Space Mono wurde bewusst entfernt)
- Dark Mode: `[data-theme="dark"]` auf `<html>`, Inline-Script im `<head>` gegen Flackern, Systemvorgabe als Default, manueller Override in localStorage
- Tendenz: UI eher vereinfachen und Redundanz entfernen als neue Komponenten hinzufügen

## Datenqualität (nicht aufweichen)
- Kuratierte, themenbasierte Mediathek-Abfragen statt „neueste Einträge pro Sender"
- Doppelte Junk-Filterung: im Fetch-Skript **und** clientseitig
- Drei Strenge-Stufen (Locker/Normal/Streng) mit harten und weichen Ausschlusskategorien; Fallback-Inhalte dürfen nie wirklich ausgeschlossenes Material sein
- Presse-RSS: nur Titel in Anführungszeichen aus Schlagzeilen extrahieren und jeden Titel über TMDb validieren, bevor er aufgenommen wird

## Bekannte Fallstricke – nicht erneut einbauen
- Mediathek-Genres müssen deutsch sein, weil TMDb mit `language=de-DE` deutsche Genres liefert. Englische Genres filtern alle Öffentlich-Rechtlichen heraus.
- `isLoved()`: kein `null === null`-Vergleich, sonst gelten alle Mediathek-Items als Favoriten.
- `pointer-events: none` nur für Watch-Links **während einer Drag-Geste** setzen, nie global.
- z-index: `#modal-overlay` und `#refine-view` dürfen nicht dieselbe Ebene haben (beide früher 60), sonst öffnet sich der Dialog „Film oder Serie hinzufügen" unsichtbar hinter dem Refine-Overlay.
- Der localStorage-Key `streamguide:profiles` bleibt **bewusst klein geschrieben**. Nicht umbenennen, sonst gehen gespeicherte Profile verloren.
- Supabase-URL endet auf `.supabase.co`, nicht `.supabase.com`. Die Client-Validierung fängt den Tippfehler ab, nicht entfernen.

## Tests
- Es gibt keine lokale Testumgebung. Vor dem PR den Code sorgfältig auf Syntaxfehler und die oben genannten Regressionen prüfen.
- API-Keys (z. B. TMDb) stehen als GitHub Secrets und sind in Cloud-Sessions wahrscheinlich nicht verfügbar. Daten-Abruf-Logik daher mit Beispieldaten prüfen, nicht mit Live-Calls.
- Im PR-Text eine kurze iPhone-Testliste angeben (was in Safari angetippt/geprüft werden soll, auch im Dark Mode).

## Versionierung
- Aktueller Stand: v2.0.0. Bei sichtbaren Änderungen die Version erhöhen und kurz im PR erwähnen.
