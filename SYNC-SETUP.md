# Geräte-Sync einrichten (Supabase)

Ziel: Profile zwischen iPhone, iPad und anderen Geräten teilen – ohne Konto,
ohne Passwort. Zugriff regelt ein gemeinsames **Haushalts-Token**.
Alles unten geht im Browser, auch am iPhone.

Dauer: ca. 10 Minuten, einmalig.

---

## 1. Supabase-Projekt anlegen

1. supabase.com aufrufen, kostenlos registrieren (GitHub-Login geht).
2. **New project** → Name z. B. `streamguide`, Region Frankfurt, ein
   Datenbank-Passwort vergeben (brauchst du für die App nicht, aber
   trotzdem notieren).
3. Kurz warten, bis das Projekt bereitsteht.

## 2. Tabelle und Zugriffsregel anlegen

Links in der Seitenleiste **SQL Editor** öffnen, folgendes einfügen und
**Run** drücken:

```sql
-- Tabelle für die Profile
create table if not exists public.sg_profiles (
  household_id text not null,
  slot         text not null,
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, slot)
);

-- Zugriffsschutz aktivieren
alter table public.sg_profiles enable row level security;

-- Zugriff nur auf Zeilen des eigenen Haushalts-Tokens.
-- Das Token wird als HTTP-Header mitgeschickt und hier serverseitig geprüft.
drop policy if exists "household access" on public.sg_profiles;
create policy "household access" on public.sg_profiles
  for all
  using (
    household_id = current_setting('request.headers', true)::json->>'x-household-id'
  )
  with check (
    household_id = current_setting('request.headers', true)::json->>'x-household-id'
  );

grant select, insert, update, delete on public.sg_profiles to anon;
```

Wichtig: Ohne die Policy könnte jeder mit dem öffentlichen Anon-Key die
gesamte Tabelle lesen. Mit ihr sieht man nur Zeilen, deren Token man kennt.

## 3. Zugangsdaten kopieren

Seitenleiste → **Project Settings** → **API**:

- **Project URL** → sieht aus wie `https://abcdefgh.supabase.co`
- **Project API keys → anon / public** → langer Text, beginnt mit `eyJ...`

Der Anon-Key ist zur Veröffentlichung gedacht; die Sicherheit liegt in der
Policy aus Schritt 2 plus deinem Token.

## 4. In der App eintragen

1. StreamGuide öffnen → **☁︎ Geräte-Sync**.
2. Projekt-URL und Anon-Key einfügen.
3. **🎲 Neues Token** antippen → **Speichern** → **↑ Hochladen**.
4. Token kopieren (Button daneben) und sicher an das zweite Gerät schicken.

## 5. Zweites Gerät

1. Dort dieselbe URL und denselben Anon-Key eintragen.
2. Das **gleiche Token** einsetzen.
3. **Speichern** → **↓ Laden**.

Fertig. Ab jetzt werden Änderungen automatisch ein paar Sekunden nach dem
Bewerten hochgeladen, und beim Öffnen der App wird abgeglichen.

---

## Wie Konflikte aufgelöst werden

Jedes Profil trägt einen Zeitstempel (`_updated_at`). Beim Abgleich gewinnt
die neuere Fassung. Profil A und B werden getrennt behandelt – wer an A
etwas ändert, überschreibt B nicht.

Praktisch heißt das: Wenn zwei Geräte dasselbe Profil gleichzeitig offline
bearbeiten, gewinnt die zuletzt gespeicherte Version. Für zwei Personen mit
je eigenem Profil ist das unproblematisch.

## Wenn etwas nicht klappt

- **Fehler 401 oder 403** → Anon-Key falsch kopiert, oder die Policy aus
  Schritt 2 wurde nicht ausgeführt.
- **Fehler 404** → Tabelle fehlt; SQL aus Schritt 2 nochmal ausführen.
- **„Bereits aktuell", aber nichts kommt an** → Token stimmt nicht exakt
  überein (Leerzeichen beim Kopieren?).
- **Nichts geht mehr** → im Dialog „Sync ausschalten". Die Profile bleiben
  lokal erhalten, nichts geht verloren.

## Datenschutz

Auf dem Server liegen nur die Geschmacksprofile: Genres, bewertete Titel und
Gründe. Keine Namen außer dem, was du selbst als `profile_name` einträgst,
keine E-Mail, kein Standort. Wer das Token kennt, kann diese Daten lesen und
ändern – behandle es wie ein Passwort.
