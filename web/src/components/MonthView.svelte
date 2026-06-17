<script lang="ts">
  import { addDays, fmtDate, fmtTime, sameDay, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../lib/time';
  import { appData } from '../lib/appdata.svelte';
  import { cart } from '../lib/cart.svelte';
  import { blackoutBlocksForDay, bookingBlocksForDay, cartBlocksForDay, cellState, visibleHourRange } from '../lib/calendar';
  import type { Booking } from '../lib/types';

  let {
    anchor,
    bookings,
    vehicleId = 1,
    selectedDay = $bindable(),
    onBookingClick,
  }: { anchor: Date; bookings: Booking[]; vehicleId?: number; selectedDay: Date; onBookingClick: (b: Booking) => void } = $props();

  const firstOfMonth = $derived(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const gridStart = $derived(startOfWeek(firstOfMonth));
  const cells = $derived(Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)));
  const today = new Date();

  function dayBookings(day: Date): Booking[] {
    return bookings.filter((b) => sameDay(new Date(b.start), day));
  }

  function dots(day: Date): string[] {
    const list = dayBookings(day);
    const out: string[] = [];
    if (list.some((b) => b.mine && b.status === 'confirmed')) out.push('mine');
    if (list.some((b) => !b.mine && b.status === 'confirmed')) out.push('other');
    if (list.some((b) => b.status === 'pending')) out.push('pending');
    return out;
  }

  function inCart(day: Date): boolean {
    const s = startOfDay(day).getTime();
    const e = addDays(startOfDay(day), 1).getTime();
    return cart.items.some((it) => it.start < e && s < it.end);
  }

  const HOUR_H = 34;

  const range = $derived(visibleHourRange(appData.meta?.rules, bookings, [selectedDay]));
  const hours = $derived(Array.from({ length: range.to - range.from }, (_, i) => range.from + i));

  // Drag-Auswahl: senkrecht über freie Stunden ziehen (Maus + Touch) – wie in der Wochenansicht
  let drag = $state<{ from: number; to: number } | null>(null);

  function dragStart(h: number, e: PointerEvent): void {
    e.preventDefault();
    drag = { from: h, to: h };
  }

  function dragEnter(h: number): void {
    if (drag) drag = { ...drag, to: h };
  }

  // Auf Touch feuert pointerenter nicht auf Nachbarzellen (impliziter Pointer-Capture
  // auf der Startzelle), daher die Zelle unter dem Finger per elementFromPoint bestimmen.
  function dragMove(e: PointerEvent): void {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slot = el instanceof Element ? el.closest<HTMLElement>('.slot.free[data-h]') : null;
    if (!slot) return;
    const h = Number(slot.dataset.h);
    if (Number.isFinite(h)) drag = { ...drag, to: h };
  }

  function dragCommit(): void {
    if (!drag) return;
    const lo = Math.min(drag.from, drag.to);
    const hi = Math.max(drag.from, drag.to);
    for (let h = lo; h <= hi; h++) {
      if (cellState(selectedDay, h, appData.meta?.rules) === 'free' && !cart.has(selectedDay, h)) {
        cart.toggleHour(selectedDay, h, vehicleId);
      }
    }
    drag = null;
  }

  function inDrag(h: number): boolean {
    if (!drag) return false;
    return h >= Math.min(drag.from, drag.to) && h <= Math.max(drag.from, drag.to);
  }

  // Wie in WeekGrid: zusammenhängende Zeiträume werden als ein Block über das Stundenraster gelegt.
  function blockStyle(topH: number, heightH: number): string {
    const top = (Math.max(topH, range.from) - range.from) * HOUR_H;
    const height = (Math.min(topH + heightH, range.to) - Math.max(topH, range.from)) * HOUR_H;
    return `top:${top + 1}px;height:${Math.max(height - 3, 12)}px;`;
  }
</script>

<svelte:window onpointerup={dragCommit} onpointermove={dragMove} />

<div class="layout">
  <div class="card month">
    <div class="weekdays">
      {#each WEEKDAYS_SHORT as wd (wd)}<span>{wd}</span>{/each}
    </div>
    <div class="cells">
      {#each cells as day (day.getTime())}
        <button
          class="cell"
          class:other-month={day.getMonth() !== anchor.getMonth()}
          class:selected={sameDay(day, selectedDay)}
          onclick={() => (selectedDay = startOfDay(day))}
        >
          <span class="num" class:today={sameDay(day, today)} class:incart={inCart(day)}>{day.getDate()}</span>
          <span class="dots">
            {#each dots(day) as d (d)}<i class={'dot ' + d}></i>{/each}
          </span>
        </button>
      {/each}
    </div>
    <div class="legend small muted">
      <span><i class="dot mine"></i> eigene</span>
      <span><i class="dot other"></i> belegt</span>
      <span><i class="dot pending"></i> angefragt</span>
      <span><i class="ring"></i> im Korb</span>
    </div>
  </div>

  <div class="card detail">
    <h3>{fmtDate(selectedDay)}</h3>
    <div class="hours" style={`height:${hours.length * HOUR_H}px`}>
      {#each hours as h (h)}
        {@const state = cellState(selectedDay, h, appData.meta?.rules)}
        <div class="hour-row" style={`top:${(h - range.from) * HOUR_H}px;height:${HOUR_H}px`}>
          <span class="t">{String(h).padStart(2, '0')}:00</span>
          {#if state === 'free'}
            <button
              class="slot free"
              class:drag-sel={inDrag(h)}
              data-h={h}
              onpointerdown={(e) => dragStart(h, e)}
              onpointerenter={() => dragEnter(h)}
              aria-label={`${h}:00 Uhr in den Korb legen`}
            >
              <span class="plus">+</span>
            </button>
          {:else}
            <div class="slot off"></div>
          {/if}
        </div>
      {/each}

      <div class="lane">
        {#each blackoutBlocksForDay(appData.meta?.blackouts ?? [], selectedDay) as blk (blk.title + blk.topH)}
          <div class="block blackout" style={blockStyle(blk.topH, blk.heightH)} title={`Gesperrt: ${blk.title}`}>
            <strong>Gesperrt: {blk.title}</strong>
          </div>
        {/each}

        {#each bookingBlocksForDay(bookings, selectedDay) as blk (blk.booking.id)}
          <button
            class={'block ' + (blk.booking.status === 'pending' ? 'pending' : blk.booking.mine ? 'mine' : 'other')}
            style={blockStyle(blk.topH, blk.heightH)}
            onclick={() => onBookingClick(blk.booking)}
            title={`${blk.booking.purpose} – ${blk.booking.userName}`}
          >
            <strong>{blk.booking.purpose}</strong>
            <span>
              {fmtTime(blk.booking.start)}–{fmtTime(blk.booking.end)} · {blk.booking.mine ? 'du' : blk.booking.userName}{blk.booking.status === 'pending' ? ' · wartet auf Freigabe' : ''}
            </span>
          </button>
        {/each}

        {#each cartBlocksForDay(cart.merged, selectedDay) as blk (blk.item.start)}
          <button class="block cart" style={blockStyle(blk.topH, blk.heightH)} onclick={() => cart.removeItem(blk.item)} title="Aus dem Warenkorb entfernen">
            <strong>Im Korb</strong>
            <span>{fmtTime(blk.item.start)}–{fmtTime(blk.item.end)} · tippen zum Entfernen</span>
          </button>
        {/each}
      </div>
    </div>
    {#if dayBookings(selectedDay).length > 0}
      <p class="small muted booked-note">
        Belegt: {dayBookings(selectedDay).map((b) => `${fmtTime(b.start)}–${fmtTime(b.end)}`).join(', ')}
      </p>
    {/if}
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
  }
  .weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    text-align: center;
    font-size: 12px;
    color: var(--faint);
    margin-bottom: 4px;
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .cell {
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    padding: 4px 0 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-height: 44px;
  }
  .cell:hover { background: var(--surface-2); }
  .cell.selected { background: var(--accent-soft); }
  .cell.other-month { opacity: 0.38; }
  .num {
    width: 24px;
    height: 24px;
    line-height: 24px;
    text-align: center;
    border-radius: 50%;
    font-size: 13px;
  }
  .num.today { background: var(--accent); color: var(--accent-contrast); font-weight: 600; }
  .num.incart:not(.today) { border: 1.5px dashed var(--accent); line-height: 21px; color: var(--accent); }
  .dots { height: 6px; display: flex; gap: 2px; }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot.mine { background: var(--accent); }
  .dot.other { background: var(--faint); }
  .dot.pending { background: var(--warning-text); }
  .ring {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px dashed var(--accent);
    vertical-align: -1px;
  }
  .legend { display: flex; gap: 12px; margin-top: 8px; align-items: center; }
  .legend .dot { vertical-align: 1px; margin-right: 3px; }

  .detail h3 { margin-bottom: 10px; }
  .hours { position: relative; }
  .hour-row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: stretch;
    gap: 8px;
    border-top: 1px solid var(--border);
  }
  .t { width: 44px; font-size: 11px; color: var(--faint); padding-top: 2px; text-align: right; }
  .slot {
    flex: 1;
    margin: 2px 0;
    border-radius: 6px;
    border: none;
    display: flex;
    align-items: center;
  }
  .slot.free { background: transparent; cursor: pointer; touch-action: none; }
  .slot.free .plus { opacity: 0; color: var(--accent); font-weight: 600; margin: 0 auto; }
  .slot.free:hover { background: var(--accent-soft); }
  .slot.free:hover .plus { opacity: 1; }
  .slot.free.drag-sel { background: var(--accent-soft); outline: 1.5px dashed var(--accent); outline-offset: -2px; }
  .slot.off { background: var(--slot-off); }

  /* Zusammenhängende Zeiträume liegen als ein Block über dem Raster (wie in der Wochenansicht) */
  .lane {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 52px; /* Breite der Uhrzeit-Spalte (44px) + Lücke (8px) */
    right: 0;
    pointer-events: none;
  }
  .lane > * { pointer-events: auto; }
  .block {
    position: absolute;
    left: 0;
    right: 0;
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 1.3;
    text-align: left;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    cursor: pointer;
  }
  .block strong { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block span { font-size: 11px; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .block.mine { background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent-soft-text); }
  .block.other { background: var(--surface-2); background-image: var(--hatch-busy); border: 1px solid var(--border); color: var(--muted); }
  .block.pending { background: var(--warning-soft); border: 1px solid var(--warning-text); color: var(--warning-text); }
  .block.cart { background: var(--bg); border: 2px dashed var(--accent); color: var(--accent); }
  .block.blackout { background: var(--surface-2); background-image: var(--hatch); border: 1px solid var(--border); color: var(--muted); cursor: not-allowed; }
  .booked-note { margin-top: 8px; }
</style>
