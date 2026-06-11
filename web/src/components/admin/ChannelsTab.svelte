<script lang="ts">
  import { api } from '../../lib/api';
  import type { AdminStatus } from '../../lib/types';

  let status = $state<AdminStatus | null>(null);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    api<AdminStatus>('/api/admin/status')
      .then((s) => (status = s))
      .catch((e) => (error = e instanceof Error ? e.message : 'Laden fehlgeschlagen'));
  });

  async function test(): Promise<void> {
    busy = true;
    error = null;
    note = null;
    try {
      const res = await api<{ telegramChats: number }>('/api/admin/test-notification', { body: {} });
      note = `Testnachricht verschickt (${res.telegramChats} Telegram-Chat${res.telegramChats === 1 ? '' : 's'} + alle Push-Geräte).`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Test fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

{#if note}<div class="note green">{note}</div>{/if}
{#if error}<div class="note red">{error}</div>{/if}

<div class="card">
  <h2>🔔 Benachrichtigungskanäle</h2>
  {#if status}
    <div class="row line">
      <span class="grow">✈ Telegram-Bot</span>
      {#if status.telegram.configured}
        <span class="badge green">verbunden · {status.telegram.linkedManagers} Admin{status.telegram.linkedManagers === 1 ? '' : 's'} verknüpft</span>
      {:else}
        <span class="badge gray">nicht konfiguriert</span>
      {/if}
    </div>
    <div class="row line">
      <span class="grow">📱 Web-Push (PWA)</span>
      {#if status.webPush.configured}
        <span class="badge green">{status.webPush.subscriptions} Gerät{status.webPush.subscriptions === 1 ? '' : 'e'} registriert</span>
      {:else}
        <span class="badge gray">VAPID-Schlüssel fehlen</span>
      {/if}
    </div>
    <div class="row line">
      <span class="grow">✉ E-Mail (Resend)</span>
      {#if status.email.configured}
        <span class="badge green">aktiv · Magic-Links &amp; Bescheide</span>
      {:else}
        <span class="badge gray">kein API-Key</span>
      {/if}
    </div>
    <p class="small muted">Pro Checkout geht genau eine Sammelnachricht an alle Admins. Die Einrichtung je Gerät erklärt die <a href="#/hilfe">Hilfe-Seite</a>.</p>
    <button onclick={test} disabled={busy}>{busy ? 'Sendet…' : '📤 Testnachricht an alle Admins senden'}</button>
  {:else}
    <p class="muted">Lade Status…</p>
  {/if}
</div>

<style>
  .line {
    border-top: 1px solid var(--border);
    padding: 9px 0;
    font-size: 14px;
  }
  .line:first-of-type { border-top: none; }
  .grow { flex: 1; }
  .note { margin-bottom: 10px; }
</style>
