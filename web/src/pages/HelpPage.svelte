<script lang="ts">
  import { api } from '../lib/api';
  import { appData } from '../lib/appdata.svelte';
  import { session } from '../lib/session.svelte';
  import { disablePush, enablePush, getPushState, type PushState } from '../lib/push';

  let pushState = $state<PushState | 'loading'>('loading');
  let pushError = $state<string | null>(null);
  let busy = $state(false);

  let telegram = $state<{ linked: boolean; username: string | null } | null>(null);
  let tgError = $state<string | null>(null);
  let tgStarted = $state(false);

  async function refreshMe(): Promise<void> {
    try {
      const res = await api<{ telegram: { linked: boolean; username: string | null } }>('/api/me');
      telegram = res.telegram;
    } catch {
      telegram = null;
    }
  }

  $effect(() => {
    appData.load();
    getPushState().then((s) => (pushState = s));
    refreshMe();
  });

  /** Telegram-Bereich: Admins immer, Mitglieder nur mit Beta-Feature. */
  const tgVisible = $derived(session.isManager || !!appData.meta?.features.memberTelegram);

  async function onEnablePush(): Promise<void> {
    pushError = null;
    const key = appData.meta?.vapidPublicKey;
    if (!key) {
      pushError = 'Web-Push ist serverseitig noch nicht eingerichtet (VAPID-Schlüssel fehlen).';
      return;
    }
    busy = true;
    try {
      pushState = await enablePush(key);
      if (pushState === 'denied') pushError = 'Benachrichtigungen wurden im Browser blockiert – bitte in den Website-Einstellungen erlauben.';
    } catch (e) {
      pushError = e instanceof Error ? e.message : 'Aktivieren fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  async function onDisablePush(): Promise<void> {
    busy = true;
    try {
      await disablePush();
      pushState = 'inactive';
    } finally {
      busy = false;
    }
  }

  async function connectTelegram(): Promise<void> {
    tgError = null;
    try {
      const res = await api<{ url: string }>('/api/telegram/link-token', { body: {} });
      tgStarted = true;
      window.open(res.url, '_blank');
    } catch (e) {
      tgError = e instanceof Error ? e.message : 'Verknüpfung fehlgeschlagen';
    }
  }

  async function unlinkTelegram(): Promise<void> {
    await api('/api/telegram/unlink', { body: {} }).catch(() => undefined);
    tgStarted = false;
    await refreshMe();
  }

  // ICS-Kalender-Abo (Beta)
  let icsUrl = $state<string | null>(null);
  let icsError = $state<string | null>(null);
  let icsCopied = $state(false);

  async function enableIcs(): Promise<void> {
    icsError = null;
    try {
      const res = await api<{ url: string }>('/api/ics/enable', { body: {} });
      icsUrl = res.url;
    } catch (e) {
      icsError = e instanceof Error ? e.message : 'Erzeugen fehlgeschlagen';
    }
  }

  async function copyIcs(): Promise<void> {
    if (!icsUrl) return;
    try {
      await navigator.clipboard.writeText(icsUrl);
      icsCopied = true;
      setTimeout(() => (icsCopied = false), 2000);
    } catch {
      icsError = 'Kopieren nicht möglich – bitte manuell markieren.';
    }
  }

  let currentPw = $state('');
  let pw1 = $state('');
  let pw2 = $state('');
  let pwBusy = $state(false);
  let pwNote = $state<string | null>(null);
  let pwError = $state<string | null>(null);

  async function changePassword(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    pwNote = null;
    pwError = null;
    if (pw1.length < 8 || pw1.length > 128) {
      pwError = 'Das Passwort muss 8 bis 128 Zeichen lang sein.';
      return;
    }
    if (pw1 !== pw2) {
      pwError = 'Die Passwörter stimmen nicht überein.';
      return;
    }
    pwBusy = true;
    try {
      await api('/api/auth/change-password', { body: { currentPassword: currentPw, password: pw1 } });
      pwNote = 'Passwort geändert.';
      currentPw = '';
      pw1 = '';
      pw2 = '';
    } catch (err) {
      pwError = err instanceof Error ? err.message : 'Ändern fehlgeschlagen';
    } finally {
      pwBusy = false;
    }
  }

  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as unknown as { standalone?: boolean }).standalone === true);
</script>

<h1>Hilfe &amp; Einrichtung</h1>

<div class="card section">
  <div class="row head">
    <h2>🔔 Mitteilungen auf dein Gerät (Web-Push)</h2>
    {#if pushState === 'active'}
      <span class="badge green">✓ Auf diesem Gerät aktiv</span>
    {:else if pushState === 'denied'}
      <span class="badge red">im Browser blockiert</span>
    {:else if pushState === 'unsupported'}
      <span class="badge gray">von diesem Browser nicht unterstützt</span>
    {:else if pushState !== 'loading'}
      <span class="badge gray">nicht eingerichtet</span>
    {/if}
  </div>
  <p class="small muted">
    {#if session.isManager}
      Als Admin bekommst du damit alle Buchungs-Zusammenfassungen und Freigabe-Anfragen direkt aufs Gerät – zusätzlich natürlich Bescheide zu deinen eigenen Buchungen.
    {:else}
      Damit bekommst du Bestätigungen, Ablehnungen und Änderungen deiner Buchungen direkt aufs Gerät – ganz ohne Telegram.
    {/if}
  </p>

  {#if pushState === 'active'}
    <button onclick={onDisablePush} disabled={busy}>Auf diesem Gerät deaktivieren</button>
  {:else}
    <button class="primary" onclick={onEnablePush} disabled={busy || pushState === 'loading' || pushState === 'unsupported'}>
      {busy ? 'Wird eingerichtet…' : '🔔 Benachrichtigungen auf diesem Gerät aktivieren'}
    </button>
  {/if}
  {#if pushError}<div class="note red">{pushError}</div>{/if}
  {#if isIos && !isStandalone}
    <div class="note amber">
      📲 Auf dem iPhone funktioniert der Knopf erst, wenn die Seite als App auf dem Home-Bildschirm installiert ist – siehe Schritte unten.
    </div>
  {/if}

  <div class="platforms">
    <div class="platform">
      <h3> iPhone / iPad</h3>
      <ol>
        <li>Diese Seite in <strong>Safari</strong> öffnen</li>
        <li>Teilen-Knopf <span aria-hidden="true">⎙</span> → <strong>„Zum Home-Bildschirm"</strong></li>
        <li>Die App vom Home-Bildschirm öffnen</li>
        <li>Hier den roten Knopf drücken und „Erlauben" tippen</li>
      </ol>
    </div>
    <div class="platform">
      <h3>🤖 Android</h3>
      <ol>
        <li>Optional: Chrome-Menü ⋮ → <strong>„App installieren"</strong></li>
        <li>Roten Knopf drücken</li>
        <li>„Zulassen" tippen – fertig</li>
      </ol>
    </div>
    <div class="platform">
      <h3>💻 PC / Mac</h3>
      <ol>
        <li>Roten Knopf drücken</li>
        <li>Browser-Abfrage mit „Erlauben" bestätigen</li>
      </ol>
    </div>
  </div>
  <p class="small muted">ℹ Auf dem iPhone klappt das ab iOS 16.4 – nur über die installierte Home-Bildschirm-App, nicht im normalen Safari-Tab. Push-Mitteilungen auf iOS zeigen keine Aktions-Knöpfe; ein Tipp darauf öffnet direkt die richtige Seite.</p>
</div>

{#if tgVisible}
  <div class="card section">
    <div class="row head">
      <h2>✈ Telegram verbinden</h2>
      {#if session.isManager}<span class="badge red">Admin-Konto</span>{/if}
    </div>
    <p class="small muted">
      {#if session.isManager}
        Verknüpfte Admins bekommen zu jedem Checkout eine Zusammenfassung mit Knöpfen zum Bestätigen oder Ablehnen – direkt in Telegram.
      {:else}
        Verknüpfst du dein Telegram, schickt dir der Bot Bescheide zu deinen eigenen Buchungen – zusätzlich zu Web-Push und E-Mail.
      {/if}
    </p>
    <ol class="steps">
      <li>Unten auf <strong>„Telegram verbinden"</strong> tippen – dein persönlicher Einmal-Link öffnet die Telegram-App direkt beim Bot.</li>
      <li>In Telegram auf <strong>„Start"</strong> tippen. Mehr ist nicht nötig – der Code steckt schon im Link.</li>
      <li>Der Bot bestätigt die Verknüpfung – fertig.</li>
    </ol>
    {#if !session.isManager}
      <p class="small"><strong>Das schickt dir der Bot:</strong></p>
      <ul class="tg-list small muted">
        <li>✅ / ❌ <strong>Bescheid</strong>, sobald ein Admin deine Buchung bestätigt oder ablehnt – mit Zweck und Terminliste</li>
        <li>✏️ <strong>Änderungen</strong>, wenn ein Admin deine Buchung anpasst</li>
        {#if appData.meta?.features.comments}<li>💬 <strong>Antworten</strong> von Admins auf deine Rückfragen</li>{/if}
        {#if appData.meta?.features.waitlist}<li>🔔 <strong>Warteliste:</strong> wenn ein vorgemerkter Zeitraum frei wird</li>{/if}
        {#if appData.meta?.features.reminders}<li>⏰ <strong>Erinnerung</strong> vor Fahrtbeginn</li>{/if}
      </ul>
      <div class="tg-sample small">
        <span class="muted">Beispiel-Nachricht:</span><br />
        ✅ <strong>Buchung bestätigt: Lehrgang Maschinist</strong><br />
        • Fr., 19.06., 10:00–12:00 Uhr<br />
        • Sa., 20.06., 09:00–11:00 Uhr
      </div>
    {/if}
    <div class="row">
      <button class="primary" onclick={connectTelegram}>✈ Telegram verbinden</button>
      {#if telegram?.linked}
        <span class="small"><span class="dot"></span>Verbunden{telegram.username ? ` als @${telegram.username}` : ''}</span>
        <button class="ghost danger-text" onclick={unlinkTelegram}>Verbindung trennen</button>
      {:else if tgStarted}
        <button class="ghost" onclick={refreshMe}>Status aktualisieren</button>
      {/if}
    </div>
    {#if tgError}<div class="note red">{tgError}</div>{/if}
    <p class="small muted">🔒 Der Link ist 15 Minuten gültig, nur einmal nutzbar und funktioniert nur für dein eigenes Konto. Trennen jederzeit hier möglich.</p>
  </div>
{/if}

{#if appData.meta?.features.ics}
  <div class="card section">
    <h2>📅 Kalender abonnieren (ICS)</h2>
    <p class="small muted">
      Binde die MTF-Belegung als abonnierten Kalender in Google/Outlook/Apple ein. Der Link ist persönlich – nicht weitergeben.
    </p>
    {#if icsUrl}
      <div class="row">
        <input class="ics-url" readonly value={icsUrl} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        <button onclick={copyIcs}>{icsCopied ? '✓ Kopiert' : 'Kopieren'}</button>
      </div>
      <p class="small muted">In der Kalender-App: „Kalender abonnieren" / „Per URL hinzufügen" und den Link einfügen.</p>
    {:else}
      <button class="primary" onclick={enableIcs}>Persönlichen Kalender-Link erzeugen</button>
    {/if}
    {#if icsError}<div class="note red">{icsError}</div>{/if}
  </div>
{/if}

<div class="card section">
  <h2>🔒 Passwort ändern</h2>
  <p class="small muted">Zur Sicherheit wird dein aktuelles Passwort geprüft. Andere offene Sitzungen werden beendet.</p>
  <form class="pw-form" onsubmit={changePassword}>
    <input type="password" bind:value={currentPw} placeholder="Aktuelles Passwort" required maxlength="128" autocomplete="current-password" />
    <input type="password" bind:value={pw1} placeholder="Neues Passwort (8–128 Zeichen)" required minlength="8" maxlength="128" autocomplete="new-password" />
    <input type="password" bind:value={pw2} placeholder="Wiederholen" required maxlength="128" autocomplete="new-password" />
    <button class="primary" disabled={pwBusy}>{pwBusy ? 'Speichert…' : 'Ändern'}</button>
  </form>
  {#if pwNote}<div class="note green">{pwNote}</div>{/if}
  {#if pwError}<div class="note red">{pwError}</div>{/if}
</div>

<div class="card section">
  <h2>❓ Kurz erklärt</h2>
  <ul class="faq small">
    <li><strong>Wie buche ich?</strong> Im Kalender freie Stunden anklicken (oder eine Serie anlegen), dann im Warenkorb Zweck und Fahrer:in angeben und alles zusammen buchen.</li>
    <li><strong>Was heißt „wartet auf Freigabe"?</strong> Je nach Regeln (lange, kurzfristige oder Serien-Buchungen) muss ein Admin zustimmen. Der Slot ist solange für andere geblockt.</li>
    <li><strong>Wie storniere ich?</strong> Unter „Meine Buchungen" – einzeln oder die ganze Serie, bis zur Stornofrist. Danach hilft ein Admin.</li>
    <li><strong>Wer kann buchen?</strong> Nur freigeschaltete Mitglieder. Admins laden neue Personen in der Verwaltung ein; neue Konten lassen sich auch über den Verwaltungszugang mit Master-Passwort anlegen.</li>
    <li><strong>Passwort vergessen?</strong> Auf der Anmeldeseite „Anmeldelink anfordern" – nach dem Klick auf den Link legst du ein neues Passwort fest.</li>
  </ul>
</div>

<style>
  .section { margin-bottom: 14px; }
  .head { justify-content: space-between; margin-bottom: 6px; }
  .head h2 { margin: 0; }
  .platforms {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 10px;
    margin-top: 14px;
  }
  .platform {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
  }
  .platform ol {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--muted);
  }
  .platform li { margin-bottom: 4px; }
  .steps {
    padding-left: 20px;
    font-size: 14px;
  }
  .steps li { margin-bottom: 8px; }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success-text);
    margin-right: 6px;
  }
  .danger-text { color: var(--accent); }
  .tg-list {
    list-style: none;
    padding: 0;
    margin: 4px 0 10px;
  }
  .tg-list li { padding: 3px 0; }
  .tg-sample {
    background: var(--surface-2);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    margin-bottom: 10px;
    line-height: 1.5;
  }
  .pw-form {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ics-url {
    flex: 1;
    min-width: 240px;
    font-size: 12px;
    font-family: monospace;
  }
  .pw-form input { flex: 1; min-width: 180px; }
  .faq { list-style: none; padding: 0; margin: 0; }
  .faq li { border-top: 1px solid var(--border); padding: 8px 0; }
  .faq li:first-child { border-top: none; }
  .note { margin-top: 10px; }
  button { margin-top: 4px; }
</style>
