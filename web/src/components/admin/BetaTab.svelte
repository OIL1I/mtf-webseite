<script lang="ts">
  import Toggle from '../Toggle.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { api } from '../../lib/api';
  import { appData } from '../../lib/appdata.svelte';
  import { session } from '../../lib/session.svelte';
  import { router } from '../../lib/router.svelte';
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
    { key: 'rateLimit', icon: '🛡', title: 'Login-Rate-Limit', desc: 'Bremst Passwort-Raten: max. 5 Fehlversuche pro Konto in 15 Minuten.' },
  ];

  async function save(): Promise<void> {
    saving = true;
    error = null;
    note = null;
    try {
      await api('/api/admin/features', { method: 'PUT', body: features });
      await appData.load(true);
      note = 'Einstellungen gespeichert.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    } finally {
      saving = false;
    }
  }

  // Globaler Passwort-Login (separater Endpoint mit Nebenwirkungen, nicht über save())
  const passwordsOn = $derived(!!appData.meta?.features.passwords);
  let pwConfirm = $state(false);
  let pwBusy = $state(false);
  let pwError = $state<string | null>(null);

  async function togglePasswords(): Promise<void> {
    pwBusy = true;
    pwError = null;
    try {
      await api('/api/admin/passwords', { method: 'PUT', body: { enabled: !passwordsOn } });
      // Alle Sitzungen wurden serverseitig beendet – auch die eigene.
      session.clear();
      router.go('/login');
    } catch (e) {
      pwError = e instanceof Error ? e.message : 'Umschalten fehlgeschlagen';
      pwBusy = false;
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
  <h2>🛡 Sicherheit</h2>
  <p class="small muted">Sicherheitsbezogene Einstellungen.</p>
  {#each items as item (item.key)}
    <div class="row line">
      <span class="icon" aria-hidden="true">{item.icon}</span>
      <div class="grow">
        <strong class="small">{item.title}</strong>
        <div class="small muted">{item.desc}</div>
      </div>
      <Toggle bind:checked={features[item.key] as boolean} label={item.title} />
    </div>
  {/each}
  {#if note}<div class="note green">{note}</div>{/if}
  {#if error}<div class="note red">{error}</div>{/if}
  <div class="save-row">
    <button class="primary" onclick={save} disabled={saving}>{saving ? 'Speichert…' : 'Speichern'}</button>
  </div>
</div>

<div class="card pw-card">
  <h2>🔑 Passwörter global</h2>
  <p class="small muted">
    Aus = Anmeldung nur per Anmeldelink (E-Mail). Ein = zusätzlich Login mit Passwort. Der Anmeldelink
    funktioniert immer (auch zum Zurücksetzen). Umschalten setzt <strong>alle</strong> Passwörter zurück
    und meldet alle ab (auch dich); beim Einschalten bekommt jede:r eine Mail zum Festlegen.
  </p>
  <div class="row line">
    <div class="grow">
      <strong class="small">Status: {passwordsOn ? 'aktiv' : 'aus'}</strong>
    </div>
    <button class:danger={passwordsOn} class:primary={!passwordsOn} onclick={() => (pwConfirm = true)} disabled={pwBusy}>
      {passwordsOn ? 'Passwörter deaktivieren' : 'Passwörter aktivieren'}
    </button>
  </div>
  {#if pwError}<div class="note red">{pwError}</div>{/if}
</div>

{#if pwConfirm}
  <ConfirmDialog
    title={passwordsOn ? 'Passwörter deaktivieren?' : 'Passwörter aktivieren?'}
    message={passwordsOn
      ? 'Alle Passwörter werden gelöscht und alle Sitzungen beendet. Die Anmeldung läuft danach nur noch per Anmeldelink. Du wirst dabei abgemeldet.'
      : 'Alle Passwörter werden zurückgesetzt, jede:r bekommt eine Mail zum Festlegen, und alle Sitzungen werden beendet. Du wirst dabei abgemeldet.'}
    confirmLabel={passwordsOn ? 'Deaktivieren' : 'Aktivieren'}
    onconfirm={togglePasswords}
    onclose={() => (pwConfirm = false)}
  />
{/if}

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
  .save-row {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
  .pw-card, .master { margin-top: 14px; }
  .master input { flex: 1; min-width: 180px; }
  .note { margin-top: 10px; }
</style>
