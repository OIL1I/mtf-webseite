<script lang="ts">
  import { cart, type CartItem } from '../lib/cart.svelte';
  import { session } from '../lib/session.svelte';
  import { appData } from '../lib/appdata.svelte';
  import { api, ApiError } from '../lib/api';
  import { estimateReviewCount } from '../lib/review';
  import { fmtDateShort, fmtTime, parseHM, startOfDay, weekdayIndex } from '../lib/time';
  import SeriesDialog from './SeriesDialog.svelte';
  import DriverSelect from './DriverSelect.svelte';
  import Toggle from './Toggle.svelte';
  import type { CheckoutProblem } from '../lib/types';

  let { vehicleId = 1, onCheckedOut }: { vehicleId?: number; onCheckedOut: () => void } = $props();

  const cartVehicle = $derived(
    (appData.meta?.vehicles ?? []).find((v) => v.id === (cart.items.length > 0 ? cart.vehicleId : vehicleId))
  );
  const showVehicle = $derived(!!appData.meta?.features.vehicles && (appData.meta?.vehicles.length ?? 0) > 1);

  let open = $state(false);
  let busy = $state(false);
  let showSeries = $state(false);
  let problems = $state<CheckoutProblem[]>([]);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);

  const singles = $derived(cart.merged.filter((it) => it.seriesKey === null));
  const seriesList = $derived(
    Object.entries(cart.series).map(([key, meta]) => ({
      key,
      label: meta.label,
      count: cart.items.filter((it) => it.seriesKey === key).length,
    }))
  );
  const reviewCount = $derived(estimateReviewCount(cart.merged, appData.meta?.rules ?? null, session.isManager));

  function fmtItem(it: CartItem): string {
    return `${fmtDateShort(it.start)} · ${fmtTime(it.start)}–${fmtTime(it.end)} Uhr`;
  }

  // --- Feineinstellung: Termin ausklappen, Von/Bis im 15-Minuten-Raster, Ganzer-Tag-Toggle ---
  const STEP = 15;
  const startOptions = Array.from({ length: (24 * 60) / STEP }, (_, i) => i * STEP);
  const endOptions = Array.from({ length: (24 * 60) / STEP }, (_, i) => (i + 1) * STEP);

  let expanded = $state<number | null>(null);
  /** Merkt sich je Tag den Zeitraum vor dem Einschalten von „Ganzer Tag". */
  const beforeFullDay = new Map<number, { start: number; end: number }>();

  function fmtMin(m: number): string {
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  function minutesOf(it: CartItem, which: 'start' | 'end'): number {
    const day = startOfDay(new Date(it.start)).getTime();
    return Math.round(((which === 'start' ? it.start : it.end) - day) / 60_000);
  }

  /** Buchbares Fenster des Tages: Öffnungszeiten laut Wochenplan, heute ab der nächsten vollen Stunde. */
  function dayWindow(it: CartItem): { start: number; end: number } | null {
    const day = startOfDay(new Date(it.start));
    let fromMin = 0;
    let toMin = 24 * 60;
    const dh = appData.meta?.rules?.weeklyHours[weekdayIndex(day)];
    if (dh) {
      if (!dh.enabled) return null;
      fromMin = parseHM(dh.open);
      toMin = parseHM(dh.close);
    }
    let start = day.getTime() + fromMin * 60_000;
    const end = day.getTime() + toMin * 60_000;
    const nextHour = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    if (start < nextHour) start = nextHour;
    return start < end ? { start, end } : null;
  }

  function isFullDay(it: CartItem): boolean {
    const win = dayWindow(it);
    return !!win && it.start === win.start && it.end === win.end;
  }

  function setFullDay(it: CartItem, on: boolean): void {
    const win = dayWindow(it);
    if (!win) return;
    const dayKey = startOfDay(new Date(it.start)).getTime();
    if (on) {
      beforeFullDay.set(dayKey, { start: it.start, end: it.end });
      cart.updateItem(it, win.start, win.end);
      expanded = win.start;
    } else {
      const prev = beforeFullDay.get(dayKey);
      const start = prev?.start ?? win.start;
      const end = prev?.end ?? Math.min(win.start + 3_600_000, win.end);
      cart.updateItem(it, start, end);
      expanded = start;
    }
  }

  function setTime(it: CartItem, which: 'start' | 'end', minutes: number): void {
    const day = startOfDay(new Date(it.start)).getTime();
    let s = it.start;
    let e = it.end;
    if (which === 'start') {
      s = day + minutes * 60_000;
      if (s >= e) e = Math.min(s + 3_600_000, day + 24 * 3_600_000);
    } else {
      e = day + minutes * 60_000;
      if (e <= s) s = Math.max(e - 3_600_000, day);
    }
    cart.updateItem(it, s, e);
    expanded = s;
  }

  async function checkout(): Promise<void> {
    error = null;
    success = null;
    problems = [];
    if (cart.count === 0) return;
    if (!cart.purpose.trim() || cart.driverId === null) {
      error = 'Bitte Zweck angeben und eine Fahrer:in auswählen.';
      return;
    }
    busy = true;
    try {
      const items = cart.merged.map((it) => ({
        start: new Date(it.start).toISOString(),
        end: new Date(it.end).toISOString(),
        seriesKey: it.seriesKey,
      }));
      const res = await api<{ group: { items: { status: string }[] } }>('/api/bookings/checkout', {
        body: { purpose: cart.purpose.trim(), driverId: cart.driverId, vehicleId: cart.vehicleId, items },
      });
      const pending = res.group.items.filter((it) => it.status === 'pending').length;
      success =
        pending > 0
          ? `Gebucht! ${pending} von ${res.group.items.length} Terminen warten noch auf Admin-Freigabe.`
          : `Gebucht! Alle ${res.group.items.length} Termine sind bestätigt.`;
      cart.clear();
      onCheckedOut();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.data.problems)) {
        problems = e.data.problems as CheckoutProblem[];
        error = 'Einige Termine verstoßen gegen die Regeln – bitte anpassen:';
      } else {
        error = e instanceof Error ? e.message : 'Buchung fehlgeschlagen';
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel" class:open>
  <button class="bar" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="cart-ico" aria-hidden="true">🛒</span>
    <strong>{cart.count} Termin{cart.count === 1 ? '' : 'e'} im Korb</strong>
    <span class="chev">{open ? '▾' : '▴'}</span>
  </button>

  <div class="content">
    <div class="head">
      <h2>Warenkorb</h2>
      {#if showVehicle && cartVehicle}<span class="badge gray">🚒 {cartVehicle.name}</span>{/if}
      {#if cart.count > 0}<span class="badge red">{cart.count}</span>{/if}
    </div>

    {#if success}<div class="note green">{success}</div>{/if}
    {#if cart.warning}<div class="note amber">{cart.warning}</div>{/if}

    {#if cart.count === 0}
      <p class="small muted">Klicke im Kalender auf freie Stunden oder lege eine Serie an – gebucht wird alles zusammen.</p>
    {:else}
      <ul class="items">
        {#each seriesList as s (s.key)}
          <li class="item series">
            <div class="item-head">
              <div class="item-text">
                <strong>↻ {s.label}</strong>
                <span class="small muted">Serie · {s.count} Termine</span>
              </div>
              <button class="ghost" onclick={() => cart.removeSeries(s.key)} aria-label="Serie entfernen">✕</button>
            </div>
          </li>
        {/each}
        {#each singles as it (it.start)}
          <li class="item">
            <div class="item-head">
              <button
                class="expand"
                onclick={() => (expanded = expanded === it.start ? null : it.start)}
                aria-expanded={expanded === it.start}
                aria-label="Zeit anpassen"
              >
                <strong>{fmtItem(it)}</strong>
                <span class="chev">{expanded === it.start ? '▾' : '▸'}</span>
              </button>
              <button class="ghost" onclick={() => cart.removeItem(it)} aria-label="Termin entfernen">✕</button>
            </div>
            {#if expanded === it.start}
              {@const win = dayWindow(it)}
              <div class="item-edit">
                <label class="fullday">
                  <Toggle
                    bind:checked={() => isFullDay(it), (v) => setFullDay(it, v)}
                    label="Ganzer Tag"
                    disabled={!win}
                  />
                  <span>Ganzer Tag</span>
                </label>
                {#if isFullDay(it)}
                  <p class="small muted">
                    Bucht alle buchbaren Stunden des Tages ({fmtMin(minutesOf(it, 'start'))}–{fmtMin(minutesOf(it, 'end'))} Uhr).
                  </p>
                {:else}
                  <div class="times">
                    <label>von
                      <select value={minutesOf(it, 'start')} onchange={(e) => setTime(it, 'start', Number(e.currentTarget.value))}>
                        {#each startOptions as m (m)}<option value={m}>{fmtMin(m)}</option>{/each}
                      </select>
                    </label>
                    <label>bis
                      <select value={minutesOf(it, 'end')} onchange={(e) => setTime(it, 'end', Number(e.currentTarget.value))}>
                        {#each endOptions as m (m)}<option value={m}>{fmtMin(m)}</option>{/each}
                      </select>
                    </label>
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <label>Zweck / Anlass *
      <input bind:value={cart.purpose} onchange={() => cart.saveFields()} placeholder="z.B. Lehrgang Maschinist" />
    </label>
    <DriverSelect vehicleId={cart.items.length > 0 ? cart.vehicleId : vehicleId} />

    {#if reviewCount > 0}
      <div class="note amber">⏳ {reviewCount} Termin{reviewCount === 1 ? ' braucht' : 'e brauchen'} voraussichtlich Admin-Freigabe.</div>
    {/if}

    {#if error}<div class="note red">{error}</div>{/if}
    {#if problems.length > 0}
      <ul class="problems small">
        {#each problems as p (p.index + p.reason)}
          <li>{fmtDateShort(p.start)} {fmtTime(p.start)}–{fmtTime(p.end)}: {p.reason}</li>
        {/each}
      </ul>
    {/if}

    <div class="row actions">
      <button onclick={() => (showSeries = true)}>↻ Serie hinzufügen</button>
      {#if cart.count > 0}
        <button class="ghost" onclick={() => cart.clear()}>Leeren</button>
      {/if}
    </div>
    <button class="primary checkout" onclick={checkout} disabled={busy || cart.count === 0}>
      {busy ? 'Wird gebucht…' : `Jetzt ${cart.count} Termin${cart.count === 1 ? '' : 'e'} buchen`}
    </button>
    <p class="small muted">🔔 Admins erhalten eine Sammel-Benachrichtigung.</p>
  </div>
</div>

{#if showSeries}
  <SeriesDialog vehicleId={cart.items.length > 0 ? cart.vehicleId : vehicleId} onclose={() => (showSeries = false)} />
{/if}

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .bar { display: none; }
  .content { padding: 14px 16px; }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .head h2 { margin: 0; font-size: 16px; }
  .items {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 240px;
    overflow-y: auto;
  }
  .item {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: 13px;
  }
  .item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .item-text { display: flex; flex-direction: column; min-width: 0; }
  .item strong { font-size: 13px; font-weight: 600; }
  .item.series { background: var(--accent-soft); color: var(--accent-soft-text); }
  .expand {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .expand .chev { color: var(--faint); font-size: 11px; }
  .item-edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
    padding: 8px 0 4px;
    border-top: 1px dashed var(--border);
  }
  .item-edit label { flex-direction: row; align-items: center; gap: 8px; margin-bottom: 0; }
  .item-edit p { margin: 0; }
  .times { display: flex; gap: 14px; }
  .times select { min-width: 84px; }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .problems {
    margin: 6px 0;
    padding-left: 18px;
    color: var(--accent-soft-text);
  }
  .actions { margin: 10px 0; }
  .checkout { width: 100%; padding: 11px; font-size: 15px; }
  .panel p:last-child { margin: 8px 0 0; }

  @media (max-width: 980px) {
    .panel {
      position: fixed;
      left: 10px;
      right: 10px;
      bottom: 10px;
      z-index: 60;
      border-radius: 14px;
    }
    .bar {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 10px;
      background: var(--accent);
      color: var(--accent-contrast);
      border: none;
      border-radius: 13px;
      padding: 12px 16px;
      font-size: 14px;
    }
    .bar:hover { background: var(--accent-strong); }
    .chev { margin-left: auto; }
    .content { display: none; }
    .panel.open .content {
      display: block;
      max-height: 62vh;
      overflow-y: auto;
    }
    .panel.open .bar { border-radius: 13px 13px 0 0; }
  }
</style>
