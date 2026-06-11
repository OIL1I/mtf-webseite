<script lang="ts">
  import { fmtDate, fmtTime, sameDay } from '../lib/time';
  import type { Booking } from '../lib/types';

  let { bookings, onBookingClick }: { bookings: Booking[]; onBookingClick: (b: Booking) => void } = $props();

  const sorted = $derived(bookings.slice().sort((a, b) => a.start.localeCompare(b.start)));

  function isNewDay(i: number): boolean {
    if (i === 0) return true;
    return !sameDay(new Date(sorted[i - 1].start), new Date(sorted[i].start));
  }
</script>

<div class="card">
  {#if sorted.length === 0}
    <p class="muted">Keine Buchungen im angezeigten Zeitraum – das MTF ist frei. 🎉</p>
  {:else}
    {#each sorted as b, i (b.id)}
      {#if isNewDay(i)}
        <h3 class="day">{fmtDate(b.start)}</h3>
      {/if}
      <button class="entry" onclick={() => onBookingClick(b)}>
        <span class="time">{fmtTime(b.start)}–{fmtTime(b.end)}</span>
        <span class="purpose">{b.purpose}</span>
        <span class="who muted small">{b.mine ? 'du' : b.userName}</span>
        {#if b.status === 'pending'}
          <span class="badge amber">wartet auf Freigabe</span>
        {:else if b.mine}
          <span class="badge red">eigene</span>
        {/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .day {
    margin: 14px 0 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .day:first-of-type { margin-top: 0; }
  .entry {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    padding: 8px 4px;
  }
  .entry:hover { background: var(--surface-2); }
  .time { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); min-width: 92px; }
  .purpose { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who { white-space: nowrap; }
</style>
