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

1. StreaMeGuide öffnen → **☁︎ Geräte-Sync**.
2. Projekt-URL und Anon-Key einfügen.
3. **🎲 Neues Token** antippen → **Speichern** → **↑ Hochladen**.
4. Token kopieren (Button daneben) und sicher an das zweite Gerät schicken.

## 5. Zweites Gerät

1. Dort dieselbe URL und denselben Anon-Key eintragen.
2. Das **gleiche Token** einsetzen.
3. **Speichern** → **↓ Laden**.

Fertig. Ab jetzt werden Änderungen automatisch ein paar Sekunden nach dem
Bewerten hochgeladen, und beim Öffnen der App wird abgeglichen.

## 6. TV-Programm („📺 Jetzt im TV“) einrichten

Das TV-Programm holt ein eigener Workflow alle zwei Stunden und legt es in
eurem Supabase ab – nicht im öffentlichen Repo, weil die Programmdaten der
Privatsender lizenzpflichtig sind. Lesen kann es nur, wer euer
Haushalts-Token kennt. Dauer: ca. 5 Minuten, einmalig.

**a) Tabelle anlegen.** In Supabase wieder **SQL Editor** öffnen, einfügen,
**Run**:

```sql
create table if not exists public.sg_tv (
  household_id text primary key,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);

alter table public.sg_tv enable row level security;

drop policy if exists "household access" on public.sg_tv;
create policy "household access" on public.sg_tv
  for all
  using (
    household_id = current_setting('request.headers', true)::json->>'x-household-id'
  )
  with check (
    household_id = current_setting('request.headers', true)::json->>'x-household-id'
  );

grant select, insert, update on public.sg_tv to anon;
```

**b) Drei Secrets im GitHub-Repo anlegen.** Am iPhone in Safari (die
GitHub-App kann das nicht): github.com → Repo **StreaMeGuide** →
**Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Name und Wert jeweils exakt so:

| Name | Wert |
|---|---|
| `SUPABASE_URL` | Projekt-URL aus Schritt 3, z. B. `https://abcdefgh.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon-Key aus Schritt 3 (`eyJ...`) |
| `SG_HOUSEHOLD` | euer Haushalts-Token aus der App (Geräte-Sync → 📋 Token kopieren) |

**c) Einmal von Hand starten.** Repo → **Actions** → **TV-Programm
aktualisieren** → **Run workflow**. Nach ca. einer Minute sollte der Lauf
grün sein; im Log steht pro Sender die Anzahl der Sendungen.

**d) In der App:** vom linken Bildschirmrand nach rechts wischen oder oben
auf 📺 tippen. Nach links wischen oder „Fertig“ schließt die Ansicht.

Sender ergänzen: in `scripts/fetch-tv.mjs` eine Zeile in `TV_CHANNELS`
hinzufügen. Die App zeigt automatisch alle Sender, die im Programm stehen.

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
- **TV-Programm: „Tabelle sg_tv fehlt"** → SQL aus Schritt 6a ausführen.
- **TV-Programm: „Noch keine Programmdaten"** → Workflow aus Schritt 6c
  starten; im Log prüfen, ob die Secrets stimmen (das Token muss exakt dem
  in der App entsprechen).
- **Nichts geht mehr** → im Dialog „Sync ausschalten". Die Profile bleiben
  lokal erhalten, nichts geht verloren.

## Datenschutz

Auf dem Server liegen nur die Geschmacksprofile (Genres, bewertete Titel und
Gründe) und, falls eingerichtet, das allgemeine TV-Programm. Keine Namen außer dem, was du selbst als `profile_name` einträgst,
keine E-Mail, kein Standort. Wer das Token kennt, kann diese Daten lesen und
ändern – behandle es wie ein Passwort.
