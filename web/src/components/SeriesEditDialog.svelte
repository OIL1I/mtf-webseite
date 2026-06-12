<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { api, ApiError } from '../lib/api';
  import { addDays, startOfDay, weekdayIndex, WEEKDAYS_SHORT, ymd } from '../lib/time';
  import type { CheckoutProblem, MyBookingItem } from '../lib/types';

  let {
    groupId,
    seriesKey,
    items,
    onclose,
    onChanged,
  }: {
    groupId: number;
    seriesKey: string;
    items: MyBookingItem[];
    onclose: () => void;
    onChanged: () => void;
  } = $props();

  const active = untrack(() =>
    items
      .filter((item) => item.seriesKey === seriesKey && (item.status === 'confirmed' || item.status === 'pending') && Date.parse(item.start) > Date.now())
      .sort((a, b) => a.start.localeCompare(b.start))
  );
  const first = new Date(active[0].start);
  const last = new Date(active[active.length - 1].start);
  const firstEnd = new Date(active[0].end);

  let weekdays = $state(Array.from({ length: 7 }, (_, index) => active.some((item) => weekdayIndex(new Date(item.start)) === index)));
  let from = $state(ymd(first));
  let to = $state(ymd(last));
  let startMinutes = $state(first.getHours() * 60 + first.getMinutes());
  let endMinutes = $state(firstEnd.getHours() * 60 + firstEnd.getMinutes());
  let confirmStep = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let problems = $state<CheckoutProblem[]>([]);

  const timeOptions = Array.from({ length: 97 }, (_, index) => index * 15);

  function parseDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function fmtMinutes(value: number): string {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  const generated = $derived.by(() => {
    if (!from || !to || !weekdays.some(Boolean) || endMinutes <= startMinutes) return [];
    const result: { start: string; end: string }[] = [];
    let day = startOfDay(parseDate(from));
    const endDay = startOfDay(parseDate(to)).getTime();
    while (day.getTime() <= endDay && result.length <= 200) {
      if (weekdays[weekdayIndex(day)]) {
        const start = new Date(day);
        start.setMinutes(startMinutes);
        const end = new Date(day);
        end.setMinutes(endMinutes);
        if (start.getTime() > Date.now()) result.push({ start: start.toISOString(), end: end.toISOString() });
      }
      day = addDays(day, 1);
    }
    return result;
  });

  async function save(): Promise<void> {
    if (!confirmStep) {
      error = null;
      if (generated.length === 0) {
        error = 'Die neue Serie enthält keine zukünftigen Termine.';
        return;
      }
      if (generated.length > 200) {
        error = 'Eine Serie darf höchstens 200 Termine enthalten.';
        return;
      }
      confirmStep = true;
      return;
    }

    busy = true;
    error = null;
    problems = [];
    try {
      await api('/api/bookings/series', {
        method: 'PUT',
        body: { groupId, seriesKey, items: generated },
      });
      onChanged();
      onclose();
    } catch (reason) {
      confirmStep = false;
      if (reason instanceof ApiError && Array.isArray(reason.data.problems)) {
        problems = reason.data.problems as CheckoutProblem[];
      }
      error = reason instanceof Error ? reason.message : 'Serie konnte nicht geändert werden';
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Zukünftige Serie bearbeiten" {onclose}>
  {#if confirmStep}
    <div class="note amber">
      {active.length} bestehende zukünftige Termine werden durch {generated.length} neue Termine ersetzt.
      Vergangene, abgelehnte und bereits stornierte Termine bleiben unverändert.
    </div>
  {:else}
    <div class="weekdays">
      {#each WEEKDAYS_SHORT as weekday, index (weekday)}
        <button class="weekday" class:on={weekdays[index]} onclick={() => (weekdays[index] = !weekdays[index])}>{weekday}</button>
      {/each}
    </div>
    <div class="grid">
      <label>Von <input type="date" bind:value={from} /></label>
      <label>Bis <input type="date" bind:value={to} /></label>
      <label>Beginn
        <select bind:value={startMinutes}>
          {#each timeOptions.slice(0, -1) as value (value)}<option value={value}>{fmtMinutes(value)}</option>{/each}
        </select>
      </label>
      <label>Ende
        <select bind:value={endMinutes}>
          {#each timeOptions.slice(1) as value (value)}<option value={value}>{fmtMinutes(value)}</option>{/each}
        </select>
      </label>
    </div>
    <p class="small muted">{generated.length} zukünftige Termine in der neuen Serie.</p>
  {/if}

  {#if error}<div class="note red">{error}</div>{/if}
  {#if problems.length > 0}
    <ul class="small problems">
      {#each problems.slice(0, 8) as problem (problem.index + problem.reason)}
        <li>{new Date(problem.start).toLocaleString('de-DE')}: {problem.reason}</li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    <button class="ghost" onclick={() => (confirmStep ? (confirmStep = false) : onclose())} disabled={busy}>
      {confirmStep ? 'Zurück' : 'Abbrechen'}
    </button>
    <button class:danger={confirmStep} class:primary={!confirmStep} onclick={save} disabled={busy || generated.length === 0}>
      {busy ? 'Wird gespeichert…' : confirmStep ? 'Serie jetzt ersetzen' : 'Änderung prüfen'}
    </button>
  </div>
</Modal>

<style>
  .weekdays {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .weekday { width: 42px; padding: 7px 0; font-weight: 600; }
  .weekday.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--muted);
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .problems { color: var(--accent-soft-text); padding-left: 20px; }
</style>
