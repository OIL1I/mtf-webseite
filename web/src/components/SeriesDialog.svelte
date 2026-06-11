<script lang="ts">
  import Modal from './Modal.svelte';
  import { cart } from '../lib/cart.svelte';
  import { addDays, WEEKDAYS_SHORT, ymd } from '../lib/time';

  let { vehicleId = 1, onclose }: { vehicleId?: number; onclose: () => void } = $props();

  let weekdays = $state([false, false, false, false, false, false, false]);
  let from = $state(ymd(new Date()));
  let to = $state(ymd(addDays(new Date(), 56)));
  let startHour = $state(18);
  let endHour = $state(20);
  let label = $state('');
  let error = $state<string | null>(null);

  function parseDateInput(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  const previewCount = $derived.by(() => {
    if (!weekdays.some(Boolean) || !from || !to || endHour <= startHour) return 0;
    let count = 0;
    let day = parseDateInput(from);
    const last = parseDateInput(to).getTime();
    while (day.getTime() <= last && count < 500) {
      const idx = (day.getDay() + 6) % 7;
      if (weekdays[idx]) count++;
      day = addDays(day, 1);
    }
    return count;
  });

  function add(): void {
    error = null;
    if (!weekdays.some(Boolean)) {
      error = 'Bitte mindestens einen Wochentag wählen.';
      return;
    }
    if (endHour <= startHour) {
      error = 'Das Ende muss nach dem Beginn liegen.';
      return;
    }
    const autoLabel = `${WEEKDAYS_SHORT.filter((_, i) => weekdays[i]).join('/')} ${startHour}–${endHour} Uhr`;
    const count = cart.addSeries({
      weekdays: [...weekdays],
      from: parseDateInput(from),
      to: parseDateInput(to),
      startHour,
      endHour,
      label: label.trim() || autoLabel,
      vehicleId,
    });
    if (count === 0) {
      error = cart.warning ?? 'Im gewählten Zeitraum liegen keine passenden (zukünftigen, freien) Termine.';
      return;
    }
    onclose();
  }
</script>

<Modal title="Serie hinzufügen" {onclose}>
  <p class="small muted">Z.B. für einen Lehrgang: jeden Di, Do und Sa über zwei Monate.</p>
  <div class="weekdays">
    {#each WEEKDAYS_SHORT as wd, i (wd)}
      <button class="wd" class:on={weekdays[i]} onclick={() => (weekdays[i] = !weekdays[i])}>{wd}</button>
    {/each}
  </div>
  <div class="grid">
    <label>Von <input type="date" bind:value={from} /></label>
    <label>Bis <input type="date" bind:value={to} /></label>
    <label>
      Beginn
      <select bind:value={startHour}>
        {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
          <option value={h}>{String(h).padStart(2, '0')}:00</option>
        {/each}
      </select>
    </label>
    <label>
      Ende
      <select bind:value={endHour}>
        {#each Array.from({ length: 24 }, (_, h) => h + 1) as h (h)}
          <option value={h}>{String(h).padStart(2, '0')}:00</option>
        {/each}
      </select>
    </label>
  </div>
  <label class="full">Bezeichnung (optional) <input bind:value={label} placeholder="z.B. Lehrgang Maschinist" /></label>
  {#if error}<div class="note red">{error}</div>{/if}
  <div class="row foot">
    <span class="small muted">{previewCount} Termin{previewCount === 1 ? '' : 'e'} im Zeitraum</span>
    <button class="primary" onclick={add} disabled={previewCount === 0}>In den Korb legen</button>
  </div>
</Modal>

<style>
  .weekdays {
    display: flex;
    gap: 6px;
    margin: 6px 0 12px;
    flex-wrap: wrap;
  }
  .wd {
    width: 42px;
    padding: 7px 0;
    font-weight: 600;
  }
  .wd.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .full { margin-bottom: 10px; }
  .foot {
    justify-content: space-between;
    margin-top: 12px;
  }
</style>
