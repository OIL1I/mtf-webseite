<script lang="ts">
  import { api } from '../lib/api';
  import { appData } from '../lib/appdata.svelte';
  import { fmtDate, fmtRange } from '../lib/time';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import SeriesEditDialog from '../components/SeriesEditDialog.svelte';
  import type { MyBookingItem, MyGroup, WaitlistEntry } from '../lib/types';

  let groups = $state<MyGroup[]>([]);
  let deadline = $state(0);
  let error = $state<string | null>(null);
  let info = $state<string | null>(null);
  let loaded = $state(false);
  let waitlist = $state<WaitlistEntry[]>([]);
  let confirmation = $state<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  let seriesEdit = $state<{ groupId: number; seriesKey: string; items: MyBookingItem[] } | null>(null);

  const features = $derived(appData.meta?.features ?? null);

  async function load(): Promise<void> {
    try {
      const res = await api<{ groups: MyGroup[]; cancelDeadlineHours: number }>('/api/my/bookings');
      groups = res.groups;
      deadline = res.cancelDeadlineHours;
      loaded = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Laden fehlgeschlagen';
    }
    if (appData.meta?.features.waitlist) {
      try {
        waitlist = (await api<{ entries: WaitlistEntry[] }>('/api/my/waitlist')).entries;
      } catch {
        /* unkritisch */
      }
    }
  }

  $effect(() => {
    appData.load().then(load);
  });

  async function removeWaitlist(id: number): Promise<void> {
    error = null;
    try {
      await api(`/api/waitlist/${id}`, { method: 'DELETE' });
      waitlist = waitlist.filter((w) => w.id !== id);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Wartelisteneintrag konnte nicht entfernt werden';
    }
  }

  // Fahrtenbuch (Beta)
  let tripOpenFor = $state<number | null>(null);
  let tripKmStart = $state('');
  let tripKmEnd = $state('');
  let tripNote = $state('');
  let tripBusy = $state(false);

  function openTrip(item: MyBookingItem): void {
    tripOpenFor = tripOpenFor === item.id ? null : item.id;
    tripKmStart = item.tripLog?.kmStart != null ? String(item.tripLog.kmStart) : '';
    tripKmEnd = item.tripLog?.kmEnd != null ? String(item.tripLog.kmEnd) : '';
    tripNote = item.tripLog?.note ?? '';
  }

  async function saveTrip(item: MyBookingItem): Promise<void> {
    tripBusy = true;
    error = null;
    try {
      await api(`/api/bookings/${item.id}/triplog`, {
        body: {
          kmStart: tripKmStart === '' ? null : Number(tripKmStart),
          kmEnd: tripKmEnd === '' ? null : Number(tripKmEnd),
          note: tripNote,
        },
      });
      info = 'Fahrtenbuch gespeichert.';
      tripOpenFor = null;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    } finally {
      tripBusy = false;
    }
  }

  async function cancelItem(item: MyBookingItem): Promise<void> {
    error = null;
    info = null;
    try {
      await api(`/api/bookings/${item.id}/cancel`, { body: {} });
      info = 'Termin storniert – die Admins wurden informiert.';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Stornieren fehlgeschlagen';
    }
  }

  async function cancelSeries(groupId: number, seriesKey: string): Promise<void> {
    error = null;
    info = null;
    try {
      const res = await api<{ cancelled: number; skipped: number }>('/api/bookings/cancel-series', {
        body: { groupId, seriesKey },
      });
      info =
        res.skipped > 0
          ? `${res.cancelled} Termine storniert, ${res.skipped} liegen innerhalb der Stornofrist und blieben bestehen.`
          : `Alle ${res.cancelled} Serientermine storniert.`;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Stornieren fehlgeschlagen';
    }
  }

  function seriesKeys(group: MyGroup): string[] {
    return [...new Set(group.items.filter((it) => it.seriesKey).map((it) => it.seriesKey as string))];
  }

  function statusBadge(status: string): { cls: string; label: string } {
    switch (status) {
      case 'confirmed': return { cls: 'green', label: 'bestätigt' };
      case 'pending': return { cls: 'amber', label: 'wartet auf Freigabe' };
      case 'rejected': return { cls: 'gray', label: 'abgelehnt' };
      default: return { cls: 'gray', label: 'storniert' };
    }
  }

  const upcoming = (g: MyGroup) => g.items.some((it) => Date.parse(it.end) > Date.now() && (it.status === 'confirmed' || it.status === 'pending'));

  function confirmCancelItem(item: MyBookingItem): void {
    confirmation = {
      title: 'Termin stornieren?',
      message: `${fmtRange(item.start, item.end)} wird verbindlich storniert.`,
      confirmLabel: 'Termin stornieren',
      action: () => cancelItem(item),
    };
  }

  function confirmCancelSeries(groupId: number, seriesKey: string, count: number): void {
    confirmation = {
      title: 'Serie stornieren?',
      message: `${count} zukünftige Termine außerhalb der Stornofrist werden storniert.`,
      confirmLabel: 'Serie stornieren',
      action: () => cancelSeries(groupId, seriesKey),
    };
  }

  function confirmRemoveWaitlist(entry: WaitlistEntry): void {
    confirmation = {
      title: 'Wartelisteneintrag entfernen?',
      message:
        entry.status === 'offered'
          ? 'Deine aktuelle Reservierung wird sofort freigegeben und der nächsten Person angeboten.'
          : `${fmtRange(entry.start_ts, entry.end_ts)} wird aus deiner Warteliste entfernt.`,
      confirmLabel: 'Entfernen',
      action: () => removeWaitlist(entry.id),
    };
  }
</script>

<h1>Meine Buchungen</h1>

{#if info}<div class="note green">{info}</div>{/if}
{#if error}<div class="note red">{error}</div>{/if}

{#if loaded && groups.length === 0}
  <div class="card"><p class="muted">Du hast noch keine Buchungen. <a href="#/kalender">Zum Kalender →</a></p></div>
{/if}

<div class="groups">
  {#each groups as group (group.id)}
    <div class="card group" class:inactive={!upcoming(group)}>
      <div class="row head">
        <h2>{group.purpose}</h2>
        <span class="muted small">Fahrer:in {group.driver} · gebucht am {fmtDate(group.createdAt)}</span>
      </div>

      {#each seriesKeys(group) as key (key)}
        {@const items = group.items.filter((it) => it.seriesKey === key)}
        {@const active = items.filter((it) => (it.status === 'confirmed' || it.status === 'pending') && Date.parse(it.start) > Date.now())}
        <div class="series-head row">
          <span class="badge red">↻ Serie · {items.length} Termine</span>
          {#if active.length > 0}
            <button class="ghost small-btn" onclick={() => (seriesEdit = { groupId: group.id, seriesKey: key, items: group.items })}>
              Serie bearbeiten
            </button>
            <button class="danger small-btn" onclick={() => confirmCancelSeries(group.id, key, active.length)}>
              Serie stornieren ({active.length})
            </button>
          {/if}
        </div>
      {/each}

      <ul>
        {#each group.items as item (item.id)}
          {@const badge = statusBadge(item.status)}
          <li class="row item">
            <span class="when">{fmtRange(item.start, item.end)}</span>
            {#if item.seriesKey}<span class="muted small">↻</span>{/if}
            {#if features?.vehicles}<span class="muted small">🚒 {item.vehicleName}</span>{/if}
            <span class={'badge ' + badge.cls}>{badge.label}</span>
            {#if features?.tripLog && item.started && item.status === 'confirmed'}
              <button class="ghost small-btn" onclick={() => openTrip(item)}>
                📓 Fahrtenbuch{item.tripLog ? ' ✓' : ''}
              </button>
            {/if}
            {#if item.cancellable}
              <button class="ghost small-btn" onclick={() => confirmCancelItem(item)}>Stornieren</button>
            {/if}
          </li>
          {#if tripOpenFor === item.id}
            <li class="trip-form row">
              <input type="number" bind:value={tripKmStart} placeholder="km Start" min="0" />
              <input type="number" bind:value={tripKmEnd} placeholder="km Ende" min="0" />
              <input class="trip-note" bind:value={tripNote} placeholder="Bemerkung (z.B. vollgetankt)" />
              <button class="primary small-btn" onclick={() => saveTrip(item)} disabled={tripBusy}>Speichern</button>
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  {/each}
</div>

{#if features?.waitlist && waitlist.length > 0}
  <div class="card waitlist">
    <h2>🔔 Meine Warteliste</h2>
    <p class="small muted">Du wirst benachrichtigt, wenn einer dieser Zeiträume durch Stornierung frei wird.</p>
    <ul>
      {#each waitlist as w (w.id)}
        <li class="row item">
          <span class="when">{fmtRange(w.start_ts, w.end_ts)}</span>
          {#if features?.vehicles}<span class="muted small">🚒 {w.vehicle_name}</span>{/if}
          {#if w.status === 'offered'}
            <span class="badge green">reserviert bis {w.offered_until ? new Date(w.offered_until).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–'} Uhr</span>
          {:else}
            <span class="badge amber">wartet</span>
          {/if}
          <button class="ghost small-btn" onclick={() => confirmRemoveWaitlist(w)}>Entfernen</button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

{#if confirmation}
  <ConfirmDialog
    title={confirmation.title}
    message={confirmation.message}
    confirmLabel={confirmation.confirmLabel}
    onconfirm={confirmation.action}
    onclose={() => (confirmation = null)}
  />
{/if}

{#if seriesEdit}
  <SeriesEditDialog
    groupId={seriesEdit.groupId}
    seriesKey={seriesEdit.seriesKey}
    items={seriesEdit.items}
    onclose={() => (seriesEdit = null)}
    onChanged={load}
  />
{/if}

{#if loaded && groups.length > 0}
  <p class="small muted">
    Stornieren ist bis {deadline} Stunden vor Beginn möglich – danach hilft dir ein Admin weiter.
  </p>
{/if}

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 12px;
  }
  .group.inactive { opacity: 0.75; }
  .head {
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .head h2 { margin: 0; }
  .series-head { margin: 4px 0; }
  ul { list-style: none; margin: 6px 0 0; padding: 0; }
  .item {
    border-top: 1px solid var(--border);
    padding: 7px 0;
    justify-content: flex-start;
  }
  .when { font-size: 14px; min-width: 240px; }
  .item .badge { margin-left: auto; }
  .small-btn { padding: 4px 10px; font-size: 13px; }
  .trip-form {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    margin: 2px 0 6px;
  }
  .trip-form input { width: 110px; font-size: 13px; }
  .trip-form .trip-note { flex: 1; min-width: 140px; }
  .waitlist { margin-bottom: 12px; }
  .waitlist ul { list-style: none; margin: 0; padding: 0; }
  @media (max-width: 640px) {
    .when { min-width: 0; flex: 1; }
  }
</style>
