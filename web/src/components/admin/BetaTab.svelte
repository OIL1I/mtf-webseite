<script lang="ts">
  import Toggle from '../Toggle.svelte';
  import { api } from '../../lib/api';
  import { appData } from '../../lib/appdata.svelte';
  import type { Features } from '../../lib/types';

  let features = $state<Features>(JSON.parse(JSON.stringify(appData.meta!.features)) as Features);
  let saving = $state(false);
  let note = $state<string | null>(null);
  let error = $state<string | null>(null);

  interface Item {
    key: keyof Features;
    icon: string;
    title: string;
    desc: string;
  }

  const items: Item[] = [
    { key: 'reminders', icon: '⏰', title: 'Erinnerungen vor Fahrtbeginn', desc: 'Push/Telegram/E-Mail an die buchende Person, geprüft alle 15 Minuten.' },
    { key: 'memberTelegram', icon: '✈', title: 'Telegram für Mitglieder', desc: 'Mitglieder können den Bot auf der Hilfe-Seite verknüpfen und bekommen Bescheide, Änderungen, Antworten und Erinnerungen per Telegram.' },
    { key: 'tripLog', icon: '📓', title: 'Fahrtenbuch', desc: 'Kilometerstand und Bemerkung je Fahrt erfassen – der Knopf erscheint ab Fahrtbeginn unter „Meine Buchungen".' },
    { key: 'waitlist', icon: '🔔', title: 'Warteliste', desc: 'Bei belegten Slots eintragen – automatische Benachrichtigung bei Stornierung.' },
    { key: 'vehicles', icon: '🚒', title: 'Mehrere Fahrzeuge', desc: 'Weitere und temporäre Fahrzeuge (Leihwagen) mit eigenem Kalender – Verwaltung im Tab „Fahrzeuge".' },
    { key: 'stats', icon: '📊', title: 'Statistik', desc: 'Auslastung pro Monat, Top-Nutzer und Wochentage im Tab „Statistik".' },
    { key: 'dragSelect', icon: '🖱', title: 'Drag-Auswahl', desc: 'Im Wochenraster mehrere Stunden am Stück aufziehen (am besten mit Maus).' },
    { key: 'ics', icon: '📅', title: 'ICS-Kalender-Abo', desc: 'Persönlicher Kalender-Link für Google/Outlook/Apple – auf der Hilfe-Seite.' },
    { key: 'comments', icon: '💬', title: 'Rückfragen', desc: 'Kurzer Frage/Antwort-Thread an jeder Buchung zwischen Admin und buchender Person.' },
    { key: 'rateLimit', icon: '🛡', title: 'Login-Rate-Limit', desc: 'Bremst Passwort-Raten: max. 5 Fehlversuche pro Konto in 15 Minuten.' },
    { key: 'auditLog', icon: '📜', title: 'Audit-Log', desc: 'Protokolliert alle Verwaltungs-Aktionen im Tab „Audit-Log".' },
    { key: 'csvExport', icon: '📄', title: 'CSV-Export', desc: 'Alle Buchungen als CSV herunterladen (im Tab „Statistik").' },
    { key: 'offlineCache', icon: '📡', title: 'Offline-Ansicht', desc: 'Zeigt ohne Empfang den zuletzt geladenen Kalenderstand an.' },
  ];

  async function save(): Promise<void> {
    saving = true;
    error = null;
    note = null;
    try {
      await api('/api/admin/features', { method: 'PUT', body: features });
      await appData.load(true);
      note = 'Beta-Features gespeichert.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    } finally {
      saving = false;
    }
  }

  // Master-Passwort
  let mpw1 = $state('');
  let mpw2 = $state('');
  let mpwBusy = $state(false);
  let mpwNote = $state<string | null>(null);
  let mpwError = $state<string | null>(null);

  async function changeMasterPw(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    mpwNote = null;
    mpwError = null;
    if (mpw1.length < 8) {
      mpwError = 'Mindestens 8 Zeichen.';
      return;
    }
    if (mpw1 !== mpw2) {
      mpwError = 'Die Passwörter stimmen nicht überein.';
      return;
    }
    mpwBusy = true;
    try {
      await api('/api/admin/master-password', { method: 'PUT', body: { password: mpw1 } });
      mpwNote = 'Master-Passwort geändert. Alle offenen Master-Sitzungen wurden beendet.';
      mpw1 = '';
      mpw2 = '';
    } catch (e2) {
      mpwError = e2 instanceof Error ? e2.message : 'Ändern fehlgeschlagen';
    } finally {
      mpwBusy = false;
    }
  }
</script>

<div class="card">
  <h2>🧪 Beta-Features</h2>
  <p class="small muted">Neue Funktionen lassen sich hier einzeln ein- und ausschalten. Aus = komplett unsichtbar und serverseitig gesperrt.</p>
  {#each items as item (item.key)}
    <div class="row line">
      <span class="icon" aria-hidden="true">{item.icon}</span>
      <div class="grow">
        <strong class="small">{item.title}</strong>
        <div class="small muted">{item.desc}</div>
      </div>
      {#if item.key === 'reminders' && features.reminders}
        <select bind:value={features.reminderLeadHours} aria-label="Vorlauf der Erinnerung">
          {#each [1, 2, 4, 12, 24] as v (v)}<option value={v}>{v} Std. vorher</option>{/each}
        </select>
      {/if}
      <Toggle bind:checked={features[item.key] as boolean} label={item.title} />
    </div>
  {/each}
  {#if note}<div class="note green">{note}</div>{/if}
  {#if error}<div class="note red">{error}</div>{/if}
  <div class="save-row">
    <button class="primary" onclick={save} disabled={saving}>{saving ? 'Speichert…' : 'Beta-Features speichern'}</button>
  </div>
</div>

<form class="card master" onsubmit={changeMasterPw}>
  <h2>🔑 Master-Passwort ändern</h2>
  <p class="small muted">
    Das Master-Passwort öffnet den Verwaltungszugang (nur Konten anlegen). Nach einer Änderung gilt sofort das neue –
    der ursprüngliche Wert aus der Server-Konfiguration ist dann außer Kraft.
  </p>
  <div class="row">
    <input type="password" bind:value={mpw1} placeholder="Neues Master-Passwort (min. 8 Zeichen)" required minlength="8" autocomplete="new-password" />
    <input type="password" bind:value={mpw2} placeholder="Wiederholen" required autocomplete="new-password" />
    <button class="primary" disabled={mpwBusy}>{mpwBusy ? 'Speichert…' : 'Ändern'}</button>
  </div>
  {#if mpwNote}<div class="note green">{mpwNote}</div>{/if}
  {#if mpwError}<div class="note red">{mpwError}</div>{/if}
</form>

<style>
  .line {
    border-top: 1px solid var(--border);
    padding: 9px 0;
    align-items: center;
  }
  .line:first-of-type { border-top: none; }
  .icon { font-size: 17px; width: 26px; text-align: center; flex: none; }
  .grow { flex: 1; min-width: 0; }
  select { padding: 5px 8px; font-size: 13px; }
  .save-row {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
  .master { margin-top: 14px; }
  .master input { flex: 1; min-width: 180px; }
  .note { margin-top: 10px; }
</style>
