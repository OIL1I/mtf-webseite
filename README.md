# MTF-Buchung 🚒

Buchungssystem für das Mannschaftstransportfahrzeug (MTF) der Feuerwehr:
Kalender mit stundenweisen Slots, Warenkorb-Checkout (inkl. Serien wie „2 Monate lang Di/Do/Sa"),
konfigurierbarem Freigabe-Workflow und Benachrichtigungen per **Telegram-Bot**, **Web-Push (PWA)** und **E-Mail**.

## Architektur

| Teil | Technik | Hosting |
|---|---|---|
| `web/` | Svelte 5 + TypeScript + Vite, PWA mit Hash-Routing | GitHub Pages (statisch) |
| `worker/` | Cloudflare Worker (Hono) + D1 (SQLite) | Cloudflare (kostenloser Tarif) |
| E-Mail | [Resend](https://resend.com) – Magic-Link-Login & Bescheide | – |
| Telegram | Bot API mit Inline-Buttons (Bestätigen/Ablehnen) | – |
| Web-Push | VAPID + aes128gcm, komplett über WebCrypto im Worker | – |

Rollen: **Mitglied** (buchen, eigene Buchungen stornieren) und **Admin**
(Anfragen freigeben, jede Buchung ändern/stornieren, Regeln & Nutzer verwalten).
Anmeldung nur für vorab angelegte E-Mail-Adressen (geschlossene Liste): standardmäßig per
**Anmeldelink (Magic-Link)** ohne Passwort. Optional lässt sich unter **Verwaltung → 🛡 Sicherheit**
ein **globaler Passwort-Login** aktivieren (PBKDF2-gehasht); dann legt jede:r per Anmeldelink ein
Passwort fest und meldet sich danach mit E-Mail + Passwort an – der Anmeldelink bleibt der Reset-Weg.
Das Umschalten setzt alle Passwörter zurück und meldet alle ab.

Zusätzlich gibt es den **Verwaltungszugang** unter `#/master` (Master-Passwort als Worker-Secret):
Er kann ausschließlich Konten anlegen und die Kontoliste lesen – nichts löschen, keine Buchungen
sehen, keine Benachrichtigungen empfangen. Die Seite ist **nur über die direkte URL `#/master`**
erreichbar (kein Link in der Oberfläche). Damit wird der erste Admin ohne Kommandozeile angelegt.

## Lokal entwickeln

```bash
npm install

# Terminal 1: API (lokale D1-Datenbank, DEV_MODE gibt Login-Links direkt zurück)
cd worker
npm run db:init:local
npm run dev          # läuft auf http://localhost:8787

# Terminal 2: Frontend
cd web
npm run dev          # läuft auf http://localhost:5173
```

Ersten Nutzer anlegen: auf <http://localhost:5173/#/master> gehen und mit dem
Master-Passwort aus [worker/.dev.vars](worker/.dev.vars.example) anmelden
(Standard lokal: `feuerwehr-master`), dann ein Admin-Konto anlegen.

Anschließend auf der Login-Seite **„Anmeldelink anfordern"** – im DEV_MODE erscheint der
Link direkt auf der Seite (es wird keine echte Mail verschickt). Ein Klick meldet dich an; ein
Passwort wird nur verlangt, wenn der Passwort-Login aktiviert ist.

## Produktion einrichten

### 1. Cloudflare Worker + D1

```bash
cd worker
npx wrangler login
npx wrangler d1 create mtf-db        # die ausgegebene database_id in wrangler.toml eintragen
npm run db:init:remote               # Schema + Standard-Regeln einspielen
```

`schema.sql` ist der **vollständige aktuelle Stand** (Tabellen, Trigger, Standard-Einstellungen)
und markiert die bereits eingearbeiteten Migrationen (0001–0007) als angewandt. Ein anschließendes
`wrangler d1 migrations apply` meldet daher korrekt „No migrations to apply". Die historischen
Migrationen dürfen **nicht** einzeln auf eine frische schema.sql-DB angewendet werden – sie setzen
teils längst entfernte Objekte (z.B. die alte `waitlist`-Tabelle) voraus. Genau dieser Weg gilt auch
für Disaster-Recovery: neue DB anlegen → `db:init:remote`.

Eine bereits **bestehende** Datenbank wird stattdessen inkrementell aktualisiert (wendet nur neue
Migrationen an und spielt anschließend die Trigger über den D1-Dateiimport ein):

```bash
cd worker
npm run db:migrate:remote
```

In `wrangler.toml` anpassen: `SITE_ORIGIN` (z.B. `https://DEINNAME.github.io`),
`SITE_URL` (z.B. `https://DEINNAME.github.io/mtf-webseite/`), `MAIL_FROM`,
`VAPID_SUBJECT` (deine Kontakt-Mail als `mailto:`) und **`DEV_MODE = "0"`**.

Secrets setzen und deployen:

```bash
npx wrangler secret put MASTER_PASSWORD       # langes, frei gewähltes Master-Passwort
npx wrangler secret put RESEND_API_KEY        # von resend.com (kostenlos bis 100 Mails/Tag)
npx wrangler deploy                            # → https://mtf-api.DEIN-ACCOUNT.workers.dev
```

Ersten Admin anlegen: im Browser direkt **`#/master`** öffnen (kein Link in der Oberfläche) →
Master-Passwort eingeben → Admin-Konto anlegen. Die Person fordert danach einen Anmeldelink an.

> **E-Mail-Hinweis:** `onboarding@resend.dev` als Absender funktioniert nur an die eigene
> Resend-Konto-Adresse. Für alle anderen Empfänger eine eigene Domain bei Resend
> verifizieren und `MAIL_FROM` anpassen.

### 2. Web-Push (VAPID)

```bash
cd worker
npm run vapid                                  # erzeugt Schlüsselpaar
# → VAPID_PUBLIC_KEY in wrangler.toml eintragen
npx wrangler secret put VAPID_PRIVATE_JWK      # JSON-Wert aus der Ausgabe einfügen
npx wrangler deploy
```

### 3. Telegram-Bot

1. In Telegram **@BotFather** öffnen → `/newbot` → Name z.B. „MTF Buchung", Username z.B. `MtfHorstEibergBot`.
2. Den Bot-Token sichern, Username (ohne `@`) in `wrangler.toml` unter `TELEGRAM_BOT_USERNAME` eintragen.
3. Secrets setzen und Webhook registrieren:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # frei gewählter Zufallswert
npx wrangler deploy

curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://mtf-api.DEIN-ACCOUNT.workers.dev/api/telegram/webhook&secret_token=<WEBHOOK_SECRET>"
```

Ohne `TELEGRAM_WEBHOOK_SECRET` antwortet der Webhook absichtlich mit HTTP 503 und verarbeitet keine Updates.

Admins verknüpfen sich danach selbst über **Hilfe → „Telegram verbinden"** (Einmal-Link, 15 Minuten gültig).

### 4. GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. **Settings → Pages → Source: „GitHub Actions"** wählen.
3. **Settings → Secrets and variables → Actions → Variables**: `VITE_API_BASE` =
   `https://mtf-api.DEIN-ACCOUNT.workers.dev` anlegen.
4. Push auf `main` → der Workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) baut und veröffentlicht die Seite.

## Funktionsumfang

Feste Bestandteile (immer aktiv): **mehrere/temporäre Fahrzeuge** (Leihwagen mit
Verfügbarkeitsfenster, je eigener Kalender), **Statistik** (Stunden/Monat, Top-Nutzer,
Wochentags-Auslastung, CSV-Export), **Drag-Auswahl** im Wochen- und Monatsraster (Maus + Touch),
**Rückfragen** (Frage/Antwort-Thread je Buchung), **Audit-Log** (Protokoll aller
Verwaltungs-Aktionen) und **Telegram für Mitglieder** (Bescheide per Bot, auf der Hilfe-Seite
verknüpfbar). Jede:r Nutzer:in kann **E-Mail-Benachrichtigungen** unter „Hilfe" abschalten (wird
automatisch deaktiviert, sobald Web-Push oder Telegram aktiviert wird).

Unter **Verwaltung → 🛡 Sicherheit** schaltbar:

| Schalter | Beschreibung |
|---|---|
| Login-Rate-Limit | Max. 5 Fehlversuche pro Konto in 15 Minuten |
| Passwörter global | Aktiviert den Passwort-Login zusätzlich zum Anmeldelink (siehe oben) |

Dort lässt sich außerdem das **Master-Passwort** ändern (gilt sofort, ersetzt das Secret aus der
Server-Konfiguration). Einmalige Sperrzeiten verschwinden nach Ablauf automatisch aus Verwaltung
und Kalender.

## Führerscheinklassen & Fahrer-Auswahl

Admins pflegen je Mitglied die Führerscheinklassen (B, B96, BE, C1, C1E, C, CE, D1, D1E, D, DE –
einfach alle Klassen ankreuzen, die auf der Karte stehen) unter **Verwaltung → Nutzer**.
Jedes Fahrzeug hat eine benötigte Klasse (MTF: **Verwaltung → Regeln**, weitere Fahrzeuge im
Fahrzeuge-Tab; „keine Vorgabe" = alle Mitglieder wählbar). Beim Buchen wird die Fahrer:in aus
einem durchsuchbaren Dropdown gewählt, das nur Mitglieder mit der passenden Klasse zeigt –
serverseitig wird das beim Checkout erneut geprüft.

## Regeln & Freigabe (Admin-Panel → Verwaltung)

- **Wochenplan:** buchbare Zeiten je Wochentag, Tage komplett abschaltbar
- **Sperrzeiten:** wöchentlich (z.B. Übungsdienst) oder einmalig (z.B. Stadtfest)
- **Fristen & Puffer:** Maximaldauer, Mindest-/Maximalvorlauf, Stornofrist, Puffer zwischen Buchungen
- **Freigabe-Schwellwerte:** ab Dauer X, bei Kurzfristigkeit unter X Stunden, Serien immer, alles – jeweils schaltbar

Alle Regeln werden serverseitig beim Checkout geprüft und zusätzlich live im Kalender
gespiegelt (nicht buchbare Stunden sind ausgegraut). Admins sind von Limits und
Freigabe befreit; physische Konflikte (Überlappung, Sperrzeiten) gelten für alle.
Buchungen über Mitternacht sind bewusst Admins vorbehalten.

## Branding

Das Wappen liegt unter [web/public/img/wappen.png](web/public/img/wappen.png) und wird in
Header, Login-Seite und als Favicon genutzt. Die quadratischen App-Icons
(`web/public/icon-192.png`, `icon-512.png` – Wappen mittig auf weißer Kachel) dienen als
PWA-/Home-Bildschirm-Icon. Der Vereinsname „FF Horst-Eiberg" steht in
[Header.svelte](web/src/components/Header.svelte), [LoginPage.svelte](web/src/pages/LoginPage.svelte),
[index.html](web/index.html), [manifest.webmanifest](web/public/manifest.webmanifest) und im
E-Mail-Layout ([email.ts](worker/src/email.ts)).

Hinweis zur Rollen-Benennung: In der Oberfläche heißt die Rolle überall **Admin** –
der interne Speicherwert in der Datenbank bleibt aus Kompatibilitätsgründen `manager`.
