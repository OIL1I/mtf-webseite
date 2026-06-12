<script lang="ts">
  import { addDays, fmtDayHeading, fmtTime, sameDay } from '../lib/time';
  import { appData } from '../lib/appdata.svelte';
  import { cart } from '../lib/cart.svelte';
  import {
    blackoutBlocksForDay,
    bookingBlocksForDay,
    cartBlocksForDay,
    cellState,
    visibleHourRange,
  } from '../lib/calendar';
  import type { Booking } from '../lib/types';

  let {
    weekStart,
    bookings,
    vehicleId = 1,
    onBookingClick,
  }: { weekStart: Date; bookings: Booking[]; vehicleId?: number; onBookingClick: (b: Booking) => void } = $props();

  const HOUR_H = 34;

  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
  const range = $derived(visibleHourRange(appData.meta?.rules, bookings, days));
  const hours = $derived(Array.from({ length: range.to - range.from }, (_, i) => range.from + i));
  const today = new Date();
  const dragEnabled = $derived(!!appData.meta?.features.dragSelect);

  // Drag-Auswahl (Beta): senkrecht über freie Stunden ziehen
  let drag = $state<{ dayKey: number; from: number; to: number } | null>(null);

  function dragStart(day: Date, h: number, e: PointerEvent): void {
    if (!dragEnabled) return;
    e.preventDefault();
    drag = { dayKey: day.getTime(), from: h, to: h };
  }

  function dragEnter(day: Date, h: number): void {
    if (drag && day.getTime() === drag.dayKey) drag = { ...drag, to: h };
  }

  function dragCommit(): void {
    if (!drag) return;
    const day = new Date(drag.dayKey);
    const lo = Math.min(drag.from, drag.to);
    const hi = Math.max(drag.from, drag.to);
    for (let h = lo; h <= hi; h++) {
      if (cellState(day, h, appData.meta?.rules) === 'free' && !cart.has(day, h)) {
        cart.toggleHour(day, h, vehicleId);
      }
    }
    if (lo === hi && cart.has(day, lo)) {
      // Einzelklick auf bereits gewählte Stunde = wieder entfernen
    }
    drag = null;
  }

  function inDrag(day: Date, h: number): boolean {
    if (!drag || day.getTime() !== drag.dayKey) return false;
    return h >= Math.min(drag.from, drag.to) && h <= Math.max(drag.from, drag.to);
  }

  function cellClick(day: Date, h: number): void {
    if (dragEnabled) return; // wird über pointerup abgewickelt
    cart.toggleHour(day, h, vehicleId);
  }

  function blockStyle(topH: number, heightH: number): string {
    const top = (Math.max(topH, range.from) - range.from) * HOUR_H;
    const height = (Math.min(topH + heightH, range.to) - Math.max(topH, range.from)) * HOUR_H;
    return `top:${top + 1}px;height:${Math.max(height - 3, 12)}px;`;
  }
</script>

<svelte:window onpointerup={dragCommit} />

<div class="wrap card">
  <div class="scroller">
    <div class="grid" style={`--hh:${HOUR_H}px`}>
      <div class="corner"></div>
      {#each days as day (day.getTime())}
        <div class="day-head" class:today={sameDay(day, today)}>{fmtDayHeading(day)}</div>
      {/each}

      <div class="hour-labels" style={`height:${hours.length * HOUR_H}px`}>
        {#each hours as h (h)}
          <div class="hour-label" style={`top:${(h - range.from) * HOUR_H}px`}>{String(h).padStart(2, '0')}:00</div>
        {/each}
      </div>

      {#each days as day (day.getTime())}
        <div class="day-col" style={`height:${hours.length * HOUR_H}px`}>
          {#each hours as h (h)}
            {@const state = cellState(day, h, appData.meta?.rules)}
            <button
              class={'cell ' + state}
              class:drag-sel={inDrag(day, h)}
              style={`top:${(h - range.from) * HOUR_H}px`}
              disabled={state !== 'free'}
              aria-label={`${fmtDayHeading(day)} ${h}:00 Uhr auswählen`}
              onclick={() => cellClick(day, h)}
              onpointerdown={(e) => state === 'free' && dragStart(day, h, e)}
              onpointerenter={() => dragEnter(day, h)}
            ></button>
          {/each}

          {#each blackoutBlocksForDay(appData.meta?.blackouts ?? [], day) as blk (blk.title + blk.topH)}
            <div class="blackout" style={blockStyle(blk.topH, blk.heightH)} title={`Gesperrt: ${blk.title}`}>
              <span>{blk.title}</span>
            </div>
          {/each}

          {#each bookingBlocksForDay(bookings, day) as blk (blk.booking.id)}
            <button
              class={'block ' + (blk.booking.mine ? 'mine' : blk.booking.status === 'pending' ? 'pending' : 'other')}
              style={blockStyle(blk.topH, blk.heightH)}
              onclick={() => onBookingClick(blk.booking)}
              title={`${blk.booking.purpose} – ${blk.booking.userName}`}
            >
              <strong>{blk.booking.purpose}</strong>
              <span>{fmtTime(blk.booking.start)}–{fmtTime(blk.booking.end)} · {blk.booking.mine ? 'du' : blk.booking.userName}</span>
              {#if blk.booking.status === 'pending'}<em>wartet auf Freigabe</em>{/if}
            </button>
          {/each}

          {#each cartBlocksForDay(cart.merged, day) as blk (blk.item.start)}
            <button
              class="block cart"
              style={blockStyle(blk.topH, blk.heightH)}
              onclick={() => cart.removeItem(blk.item)}
              title="Aus dem Warenkorb entfernen"
            >
              <strong>Im Korb</strong>
              {#if blk.item.seriesKey}<span>Serie</span>{/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
  <div class="legend small">
    <span><i class="sw mine"></i> Eigene Buchung</span>
    <span><i class="sw other"></i> Belegt</span>
    <span><i class="sw pending"></i> Wartet auf Freigabe</span>
    <span><i class="sw cart"></i> Im Warenkorb</span>
    <span><i class="sw blackout"></i> Gesperrt</span>
    <span class="muted tip">Tipp: freie Stunden anklicken, um sie in den Korb zu legen</span>
  </div>
</div>

<style>
  .wrap { padding: 10px 12px; }
  .scroller { overflow-x: auto; }
  .grid {
    display: grid;
    grid-template-columns: 46px repeat(7, minmax(86px, 1fr));
    min-width: 700px;
  }
  .corner { height: 30px; }
  .day-head {
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .day-head.today { color: var(--accent); }
  .hour-labels { position: relative; }
  .hour-label {
    position: absolute;
    right: 8px;
    transform: translateY(-7px);
    font-size: 11px;
    color: var(--faint);
  }
  .day-col {
    position: relative;
    border-left: 1px solid var(--border);
  }
  .cell {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--hh);
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .cell:hover { background: var(--accent-soft); }
  .cell.drag-sel { background: var(--accent-soft); outline: 1.5px dashed var(--accent); outline-offset: -2px; }
  .cell.closed, .cell.past { background: var(--slot-off); cursor: not-allowed; }
  .cell.closed:hover, .cell.past:hover { background: var(--slot-off); }
  .blackout {
    position: absolute;
    left: 2px;
    right: 2px;
    background: var(--surface-2);
    background-image: var(--hatch);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    padding: 2px 5px;
    pointer-events: auto;
    cursor: not-allowed;
  }
  .block {
    position: absolute;
    left: 2px;
    right: 2px;
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 11px;
    line-height: 1.3;
    text-align: left;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: pointer;
  }
  .block strong { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block span, .block em { font-size: 10.5px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-style: normal; }
  .block.mine { background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent-soft-text); }
  .block.other { background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); }
  .block.pending { background: var(--warning-soft); border: 1px solid var(--warning-text); color: var(--warning-text); }
  .block.cart { background: transparent; border: 2px dashed var(--accent); color: var(--accent); }
  .legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    align-items: center;
    padding: 10px 4px 2px;
    color: var(--muted);
  }
  .legend .sw {
    display: inline-block;
    width: 11px;
    height: 11px;
    border-radius: 3px;
    vertical-align: -1px;
    margin-right: 4px;
  }
  .sw.mine { background: var(--accent-soft); border: 1px solid var(--accent); }
  .sw.other { background: var(--surface-2); border: 1px solid var(--border); }
  .sw.pending { background: var(--warning-soft); border: 1px solid var(--warning-text); }
  .sw.cart { border: 2px dashed var(--accent); }
  .sw.blackout { background: var(--surface-2); background-image: var(--hatch); border: 1px solid var(--border); }
  .tip { margin-left: auto; }
  @media (max-width: 760px) {
    .tip { display: none; }
  }
</style>
