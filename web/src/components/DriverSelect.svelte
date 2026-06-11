<script lang="ts">
  import { api } from '../lib/api';
  import { cart } from '../lib/cart.svelte';
  import type { DriverOption } from '../lib/types';

  let { vehicleId }: { vehicleId: number } = $props();

  let drivers = $state<DriverOption[]>([]);
  let requiredClass = $state<string | null>(null);
  let loaded = $state(false);
  let query = $state('');
  let open = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    loaded = false;
    api<{ requiredClass: string | null; drivers: DriverOption[] }>(`/api/drivers?vehicle=${vehicleId}`)
      .then((res) => {
        drivers = res.drivers;
        requiredClass = res.requiredClass;
        loaded = true;
        error = null;
        // Gewählte Fahrer:in verwerfen, wenn sie für dieses Fahrzeug nicht (mehr) wählbar ist
        if (cart.driverId !== null && !res.drivers.some((d) => d.id === cart.driverId)) {
          cart.driverId = null;
          cart.driver = '';
          cart.saveFields();
        }
      })
      .catch((e) => {
        error = e instanceof Error ? e.message : 'Fahrer:innen konnten nicht geladen werden';
      });
  });

  const filtered = $derived(
    query.trim() ? drivers.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase())) : drivers
  );

  function select(d: DriverOption): void {
    cart.driverId = d.id;
    cart.driver = d.name;
    cart.saveFields();
    query = '';
    open = false;
  }

  function clearSelection(): void {
    cart.driverId = null;
    cart.driver = '';
    cart.saveFields();
  }
</script>

<div class="driver-select">
  <span class="lbl">
    Fahrer:in *
    {#if requiredClass}<span class="badge gray">benötigt Klasse {requiredClass}</span>{/if}
  </span>

  {#if cart.driverId !== null}
    <div class="selected">
      <span>👤 {cart.driver}</span>
      <button class="ghost" onclick={clearSelection} aria-label="Fahrer:in entfernen">✕</button>
    </div>
  {:else}
    <div class="combo">
      <input
        bind:value={query}
        placeholder={loaded && drivers.length === 0 ? 'Keine wählbaren Fahrer:innen' : 'Name suchen…'}
        disabled={loaded && drivers.length === 0}
        onfocus={() => (open = true)}
        oninput={() => (open = true)}
        role="combobox"
        aria-expanded={open}
        aria-controls="driver-options"
        aria-label="Fahrer:in suchen"
      />
      {#if open && filtered.length > 0}
        <ul class="options" id="driver-options" role="listbox">
          {#each filtered.slice(0, 8) as d (d.id)}
            <li><button onclick={() => select(d)} role="option" aria-selected="false">{d.name}</button></li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if loaded && drivers.length === 0}
      <div class="note amber">
        Niemand hat die benötigte Klasse {requiredClass} hinterlegt – Admins pflegen Führerscheine unter Verwaltung → Nutzer.
      </div>
    {/if}
  {/if}
  {#if error}<div class="note red">{error}</div>{/if}
</div>

<style>
  .driver-select {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }
  .lbl {
    font-size: 13px;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .selected {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 6px 6px 10px;
    font-size: 14px;
  }
  .combo { position: relative; }
  .combo input { width: 100%; }
  .options {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 30;
    list-style: none;
    margin: 0;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    max-height: 220px;
    overflow-y: auto;
  }
  .options button {
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 14px;
  }
  .options button:hover { background: var(--accent-soft); color: var(--accent-soft-text); }
  .note { margin-top: 4px; }
</style>
