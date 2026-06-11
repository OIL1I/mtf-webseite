<script lang="ts">
  import { appData } from '../lib/appdata.svelte';
  import RulesTab from '../components/admin/RulesTab.svelte';
  import RequestsTab from '../components/admin/RequestsTab.svelte';
  import UsersTab from '../components/admin/UsersTab.svelte';
  import ChannelsTab from '../components/admin/ChannelsTab.svelte';
  import BetaTab from '../components/admin/BetaTab.svelte';
  import VehiclesTab from '../components/admin/VehiclesTab.svelte';
  import StatsTab from '../components/admin/StatsTab.svelte';
  import AuditTab from '../components/admin/AuditTab.svelte';

  type Tab = 'anfragen' | 'regeln' | 'nutzer' | 'kanaele' | 'beta' | 'fahrzeuge' | 'statistik' | 'audit';
  let tab = $state<Tab>('anfragen');
  let requestCount = $state<number | null>(null);

  const features = $derived(appData.meta?.features ?? null);

  $effect(() => {
    appData.load();
  });

  $effect(() => {
    // Falls ein Feature-Tab nach dem Ausschalten noch offen ist → zurück zu Anfragen
    if (
      (tab === 'fahrzeuge' && !features?.vehicles) ||
      (tab === 'statistik' && !features?.stats) ||
      (tab === 'audit' && !features?.auditLog)
    ) {
      tab = 'anfragen';
    }
  });
</script>

<h1>Verwaltung</h1>

<div class="tabs" role="tablist">
  <button role="tab" class:active={tab === 'anfragen'} onclick={() => (tab = 'anfragen')}>
    Anfragen{#if requestCount}<span class="badge amber count">{requestCount}</span>{/if}
  </button>
  <button role="tab" class:active={tab === 'regeln'} onclick={() => (tab = 'regeln')}>Regeln</button>
  <button role="tab" class:active={tab === 'nutzer'} onclick={() => (tab = 'nutzer')}>Nutzer</button>
  <button role="tab" class:active={tab === 'kanaele'} onclick={() => (tab = 'kanaele')}>Benachrichtigungen</button>
  {#if features?.vehicles}
    <button role="tab" class:active={tab === 'fahrzeuge'} onclick={() => (tab = 'fahrzeuge')}>Fahrzeuge</button>
  {/if}
  {#if features?.stats}
    <button role="tab" class:active={tab === 'statistik'} onclick={() => (tab = 'statistik')}>Statistik</button>
  {/if}
  {#if features?.auditLog}
    <button role="tab" class:active={tab === 'audit'} onclick={() => (tab = 'audit')}>Audit-Log</button>
  {/if}
  <button role="tab" class="beta-tab" class:active={tab === 'beta'} onclick={() => (tab = 'beta')}>🧪 Beta</button>
</div>

{#if tab === 'anfragen'}
  <RequestsTab onCountChange={(n) => (requestCount = n)} />
{:else if tab === 'regeln'}
  {#if appData.meta}<RulesTab />{:else}<p class="muted">Lade Regeln…</p>{/if}
{:else if tab === 'nutzer'}
  <UsersTab />
{:else if tab === 'kanaele'}
  <ChannelsTab />
{:else if tab === 'fahrzeuge'}
  <VehiclesTab />
{:else if tab === 'statistik'}
  <StatsTab />
{:else if tab === 'audit'}
  <AuditTab />
{:else if tab === 'beta'}
  {#if appData.meta}<BetaTab />{:else}<p class="muted">Lade Einstellungen…</p>{/if}
{/if}

<style>
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
    overflow-x: auto;
  }
  .tabs button {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 8px 14px;
    color: var(--muted);
    font-size: 14px;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .tabs button.active {
    color: var(--accent);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  .beta-tab { margin-left: auto; }
  .count { margin-left: 6px; }
</style>
