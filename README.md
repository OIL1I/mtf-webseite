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
Anmeldung nur für vorab angelegte E-Mail-Adressen (geschlossene Liste):
Erstanmeldung per Magic-Link, dabei wird ein **Passwort** festgelegt – danach Login mit
E-Mail + Passwort (PBKDF2-gehasht). „Passwort vergessen" läuft wieder über den Magic-Link.

Zusätzlich gibt es den **Verwaltungszugang** unter `#/master` (Master-Passwort als Worker-Secret):
Er kann ausschließlich Konten anlegen und die Kontoliste lesen – nichts löschen, keine Buchungen
sehen, keine Benachrichtigungen empfangen. Damit wird der erste Admin ohne Kommandozeile angelegt.

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
Link direkt auf der Seite (es wird keine echte Mail verschickt). Nach dem Klick legst du
dein Passwort fest und meldest dich künftig damit an.

## Produktion einrichten

### 1. Cloudflare Worker + D1

```bash
cd worker
npx wrangler login
npx wrangler d1 create mtf-db        # die ausgegebene database_id in wrangler.toml eintragen
npm run db:init:remote               # Schema + Standard-Regeln einspielen
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

Ersten Admin anlegen: Webseite öffnen → unten auf der Login-Seite
**„Verwaltungszugang"** → Master-Passwort eingeben → Admin-Konto anlegen.
Die Person fordert dann einen Anmeldelink an und legt ihr Passwort fest.

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

Admins verknüpfen sich danach selbst über **Hilfe → „Telegram verbinden"** (Einmal-Link, 15 Minuten gültig).

### 4. GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. **Settings → Pages → Source: „GitHub Actions"** wählen.
3. **Settings → Secrets and variables → Actions → Variables**: `VITE_API_BASE` =
   `https://mtf-api.DEIN-ACCOUNT.workers.dev` anlegen.
4. Push auf `main` → der Workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) baut und veröffentlicht die Seite.

## Beta-Features (Verwaltung → 🧪 Beta)

Alle Zusatzfunktionen sind einzeln schaltbar (standardmäßig aus) und serverseitig gesperrt, solange sie deaktiviert sind:

| Feature | Beschreibung |
|---|---|
| Erinnerungen | Push/Telegram/E-Mail vor Fahrtbeginn (Vorlauf einstellbar, Cron alle 15 Min.) |
| Fahrtenbuch | km-Stand & Bemerkung je Fahrt unter „Meine Buchungen", Übersicht im Statistik-Tab |
| Warteliste | Bei belegten Slots eintragen, automatische Benachrichtigung bei Stornierung |
| Mehrere Fahrzeuge | Weitere + temporäre Fahrzeuge (Leihwagen) mit Verfügbarkeitsfenster, je eigener Kalender |
| Statistik | Stunden/Monat, Top-Nutzer, Wochentags-Auslastung |
| Drag-Auswahl | Stunden im Wochenraster aufziehen statt einzeln klicken |
| ICS-Kalender-Abo | Persönlicher Abo-Link für Google/Outlook/Apple (Hilfe-Seite) |
| Rückfragen | Frage/Antwort-Thread an jeder Buchung (Admin ↔ buchende Person) |
| Login-Rate-Limit | Max. 5 Fehlversuche pro Konto in 15 Minuten |
| Audit-Log | Protokoll aller Verwaltungs-Aktionen |
| CSV-Export | Alle Buchungen als CSV (Statistik-Tab) |
| Offline-Ansicht | Letzter Kalenderstand auch ohne Empfang |

Außerdem: Das Master-Passwort kann von Admins unter 🧪 Beta geändert werden (gilt sofort,
ersetzt das Secret aus der Server-Konfiguration). Einmalige Sperrzeiten verschwinden nach
Ablauf automatisch aus Verwaltung und Kalender.

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
