<script lang="ts">
  import { addDays, fmtDate, fmtTime, sameDay, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../lib/time';
  import { appData } from '../lib/appdata.svelte';
  import { cart } from '../lib/cart.svelte';
  import { blackoutBlocksForDay, cellState, visibleHourRange } from '../lib/calendar';
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
    if (list.some((b) => b.mine)) out.push('mine');
    if (list.some((b) => !b.mine && b.status === 'confirmed')) out.push('other');
    if (list.some((b) => b.status === 'pending')) out.push('pending');
    return out;
  }

  function inCart(day: Date): boolean {
    const s = startOfDay(day).getTime();
    const e = addDays(startOfDay(day), 1).getTime();
    return cart.items.some((it) => it.start < e && s < it.end);
  }

  const range = $derived(visibleHourRange(appData.meta?.rules, bookings, [selectedDay]));
  const hours = $derived(Array.from({ length: range.to - range.from }, (_, i) => range.from + i));

  function hourInfo(h: number): { kind: string; booking?: Booking; title?: string } {
    const hStart = startOfDay(selectedDay);
    hStart.setHours(h);
    const hEnd = startOfDay(selectedDay);
    hEnd.setHours(h + 1);
    const booking = bookings.find(
      (b) => Date.parse(b.start) < hEnd.getTime() && hStart.getTime() < Date.parse(b.end) && sameDay(new Date(b.start), selectedDay)
    );
    if (booking) return { kind: booking.mine ? 'mine' : booking.status === 'pending' ? 'pending' : 'other', booking };
    const blk = blackoutBlocksForDay(appData.meta?.blackouts ?? [], selectedDay).find(
      (b) => b.topH < h + 1 && h < b.topH + b.heightH
    );
    if (blk) return { kind: 'blackout', title: blk.title };
    if (cart.has(selectedDay, h)) return { kind: 'cart' };
    return { kind: cellState(selectedDay, h, appData.meta?.rules) };
  }
</script>

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
    <div class="hours">
      {#each hours as h (h)}
        {@const info = hourInfo(h)}
        <div class="hour-row">
          <span class="t">{String(h).padStart(2, '0')}:00</span>
          {#if info.kind === 'mine' || info.kind === 'other' || info.kind === 'pending'}
            <button class={'slot booked ' + info.kind} onclick={() => info.booking && onBookingClick(info.booking)}>
              <strong>{info.booking?.purpose}</strong>
              <span>{info.booking?.mine ? 'du' : info.booking?.userName}{info.kind === 'pending' ? ' · wartet auf Freigabe' : ''}</span>
            </button>
          {:else if info.kind === 'blackout'}
            <div class="slot blackout">Gesperrt: {info.title}</div>
          {:else if info.kind === 'cart'}
            <button class="slot cart" onclick={() => cart.toggleHour(selectedDay, h, vehicleId)}>Im Korb · tippen zum Entfernen</button>
          {:else if info.kind === 'free'}
            <button class="slot free" onclick={() => cart.toggleHour(selectedDay, h, vehicleId)} aria-label={`${h}:00 Uhr in den Korb legen`}>
              <span class="plus">+</span>
            </button>
          {:else}
            <div class="slot off"></div>
          {/if}
        </div>
      {/each}
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
  .hours { display: flex; flex-direction: column; }
  .hour-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
    border-top: 1px solid var(--border);
    min-height: 34px;
  }
  .t { width: 44px; font-size: 11px; color: var(--faint); padding-top: 2px; text-align: right; }
  .slot {
    flex: 1;
    margin: 2px 0;
    border-radius: 6px;
    font-size: 12px;
    text-align: left;
    padding: 3px 8px;
    border: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .slot strong { font-size: 12px; }
  .slot span { font-size: 11px; opacity: 0.8; }
  .slot.free { background: transparent; cursor: pointer; align-items: center; flex-direction: row; }
  .slot.free .plus { opacity: 0; color: var(--accent); font-weight: 600; }
  .slot.free:hover { background: var(--accent-soft); }
  .slot.free:hover .plus { opacity: 1; }
  .slot.off { background: var(--surface-2); opacity: 0.5; }
  .slot.booked.mine { background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent-soft-text); cursor: pointer; }
  .slot.booked.other { background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); cursor: pointer; }
  .slot.booked.pending { background: var(--warning-soft); border: 1px solid var(--warning-text); color: var(--warning-text); cursor: pointer; }
  .slot.cart { border: 2px dashed var(--accent); color: var(--accent); background: transparent; cursor: pointer; }
  .slot.blackout { background: var(--surface-2); background-image: var(--hatch); color: var(--muted); }
  .booked-note { margin-top: 8px; }
</style>
