<script lang="ts">
  import { addDays, addMonths, fmtMonth, isoWeek, startOfDay, startOfWeek } from '../lib/time';
  import { api } from '../lib/api';
  import { appData } from '../lib/appdata.svelte';
  import { cart } from '../lib/cart.svelte';
  import WeekGrid from '../components/WeekGrid.svelte';
  import MonthView from '../components/MonthView.svelte';
  import ListView from '../components/ListView.svelte';
  import CartPanel from '../components/CartPanel.svelte';
  import BookingModal from '../components/BookingModal.svelte';
  import type { Booking } from '../lib/types';

  type View = 'week' | 'month' | 'list';
  let view = $state<View>(window.innerWidth < 760 ? 'month' : 'week');
  let anchor = $state(new Date());
  let selectedDay = $state(startOfDay(new Date()));
  let bookings = $state<Booking[]>([]);
  let selectedBooking = $state<Booking | null>(null);
  let loadError = $state<string | null>(null);
  let selectedVehicle = $state(cart.items.length > 0 ? cart.vehicleId : 1);

  const weekStart = $derived(startOfWeek(anchor));
  const activeVehicles = $derived((appData.meta?.vehicles ?? []).filter((v) => v.active));
  const showVehicles = $derived(activeVehicles.length > 1);

  const rangeFrom = $derived.by(() => {
    if (view === 'week') return weekStart;
    if (view === 'month') return startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return startOfDay(new Date());
  });
  const rangeTo = $derived.by(() => {
    if (view === 'week') return addDays(weekStart, 7);
    if (view === 'month') return addDays(startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), 42);
    return addDays(startOfDay(new Date()), 60);
  });

  let reloadFlag = $state(0);
  const refresh = () => (reloadFlag += 1);

  $effect(() => {
    appData.load();
  });

  $effect(() => {
    void reloadFlag;
    const from = rangeFrom.toISOString();
    const to = rangeTo.toISOString();
    const vehicleQuery = showVehicles ? `&vehicle=${selectedVehicle}` : '';
    const controller = new AbortController();
    api<{ bookings: Booking[] }>(
      `/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${vehicleQuery}`,
      { signal: controller.signal }
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        bookings = res.bookings;
        loadError = null;
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        loadError = e instanceof Error ? e.message : 'Kalender konnte nicht geladen werden';
      });
    return () => controller.abort();
  });

  function nav(dir: -1 | 1): void {
    if (view === 'week') anchor = addDays(anchor, dir * 7);
    else if (view === 'month') anchor = addMonths(anchor, dir);
    if (view === 'month') selectedDay = startOfDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  }

  function goToday(): void {
    anchor = new Date();
    selectedDay = startOfDay(new Date());
  }

  const title = $derived.by(() => {
    if (view === 'week') {
      const end = addDays(weekStart, 6);
      return `${weekStart.getDate()}.${weekStart.getMonth() + 1}. – ${end.getDate()}.${end.getMonth() + 1}.${end.getFullYear()} · KW ${isoWeek(weekStart)}`;
    }
    if (view === 'month') return fmtMonth(anchor);
    return 'Nächste 60 Tage';
  });

  const selectedVehicleInfo = $derived(activeVehicles.find((v) => v.id === selectedVehicle));
</script>

<div class="page">
  <div class="cal-area">
    {#if showVehicles}
      <div class="vehicles" role="tablist" aria-label="Fahrzeug wählen">
        {#each activeVehicles as v (v.id)}
          <button class="veh" class:active={selectedVehicle === v.id} onclick={() => (selectedVehicle = v.id)}>
            🚒 {v.name}
            {#if v.available_from || v.available_to}<span class="tmp">temporär</span>{/if}
          </button>
        {/each}
      </div>
      {#if selectedVehicleInfo && (selectedVehicleInfo.available_from || selectedVehicleInfo.available_to)}
        <div class="note amber veh-note">
          Verfügbar {selectedVehicleInfo.available_from ? `ab ${new Date(selectedVehicleInfo.available_from).toLocaleDateString('de-DE')}` : ''}
          {selectedVehicleInfo.available_to ? ` bis ${new Date(selectedVehicleInfo.available_to).toLocaleDateString('de-DE')}` : ''}
          {selectedVehicleInfo.note ? ` · ${selectedVehicleInfo.note}` : ''}
        </div>
      {/if}
    {/if}

    <div class="toolbar">
      <button onclick={goToday}>Heute</button>
      {#if view !== 'list'}
        <button class="ghost" onclick={() => nav(-1)} aria-label="Zurück">‹</button>
        <button class="ghost" onclick={() => nav(1)} aria-label="Weiter">›</button>
      {/if}
      <strong class="title">{title}</strong>
      <div class="views" role="tablist">
        <button class:active={view === 'week'} onclick={() => (view = 'week')}>Woche</button>
        <button class:active={view === 'month'} onclick={() => (view = 'month')}>Monat</button>
        <button class:active={view === 'list'} onclick={() => (view = 'list')}>Liste</button>
      </div>
    </div>

    {#if loadError}<div class="note red">{loadError}</div>{/if}

    {#if view === 'week'}
      <WeekGrid {weekStart} {bookings} vehicleId={selectedVehicle} onBookingClick={(b) => (selectedBooking = b)} />
    {:else if view === 'month'}
      <MonthView {anchor} {bookings} vehicleId={selectedVehicle} bind:selectedDay onBookingClick={(b) => (selectedBooking = b)} />
    {:else}
      <ListView {bookings} onBookingClick={(b) => (selectedBooking = b)} />
    {/if}
  </div>

  <aside class="cart-area">
    <CartPanel vehicleId={selectedVehicle} onCheckedOut={refresh} />
  </aside>
</div>

{#if selectedBooking}
  <BookingModal booking={selectedBooking} onclose={() => (selectedBooking = null)} onChanged={refresh} />
{/if}

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 16px;
    align-items: start;
  }
  .cart-area {
    position: sticky;
    top: 64px;
  }
  .vehicles {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .veh {
    font-size: 13px;
    padding: 6px 12px;
  }
  .veh.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
  }
  .tmp {
    font-size: 11px;
    opacity: 0.8;
    margin-left: 4px;
  }
  .veh-note { margin-bottom: 10px; }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .title { font-size: 14px; margin: 0 4px; }
  .views {
    margin-left: auto;
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .views button {
    border: none;
    border-radius: 0;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--muted);
    background: var(--surface);
  }
  .views button + button { border-left: 1px solid var(--border); }
  .views button.active {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    font-weight: 600;
  }
  .note { margin-bottom: 10px; }
  @media (max-width: 980px) {
    .page { grid-template-columns: 1fr; }
    .cart-area { position: static; }
  }
</style>
