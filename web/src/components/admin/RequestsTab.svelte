<script lang="ts">
  import { api } from '../../lib/api';
  import { fmtDate, fmtRange } from '../../lib/time';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import type { AdminGroup } from '../../lib/types';

  let { onCountChange }: { onCountChange: (n: number) => void } = $props();

  let groups = $state<AdminGroup[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  let rejectGroup = $state<AdminGroup | null>(null);

  async function load(): Promise<void> {
    try {
      const res = await api<{ groups: AdminGroup[] }>('/api/admin/requests');
      groups = res.groups;
      loaded = true;
      onCountChange(groups.length);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Laden fehlgeschlagen';
    }
  }

  $effect(() => {
    load();
  });

  async function decide(groupId: number, action: 'approve' | 'reject'): Promise<void> {
    error = null;
    note = null;
    try {
      await api(`/api/admin/groups/${groupId}/decide`, { body: { action } });
      note = action === 'approve' ? 'Buchung bestätigt – die Person wurde benachrichtigt.' : 'Buchung abgelehnt – die Person wurde benachrichtigt.';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Aktion fehlgeschlagen';
    }
  }

  const pendingItems = (g: AdminGroup) => g.items.filter((it) => it.status === 'pending');
  const isSeries = (g: AdminGroup) => g.items.some((it) => it.series_key);
</script>

{#if note}<div class="note green">{note}</div>{/if}
{#if error}<div class="note red">{error}</div>{/if}

{#if loaded && groups.length === 0}
  <div class="card"><p class="muted">Keine offenen Anfragen. 👍</p></div>
{/if}

<div class="list">
  {#each groups as g (g.id)}
    <div class="card">
      <div class="row head">
        <h2>{g.purpose}</h2>
        {#if isSeries(g)}<span class="badge amber">Serie · {g.items.length} Termine</span>{/if}
      </div>
      <p class="small muted">
        {g.owner.name} ({g.owner.email}) · Fahrer:in {g.driver} · angefragt am {fmtDate(g.created_at)}
      </p>
      <ul class="small">
        {#each pendingItems(g).slice(0, 8) as item (item.id)}
          <li>{fmtRange(item.start_ts, item.end_ts)}</li>
        {/each}
        {#if pendingItems(g).length > 8}
          <li class="muted">… und {pendingItems(g).length - 8} weitere</li>
        {/if}
      </ul>
      <div class="row">
        <button class="primary" onclick={() => decide(g.id, 'approve')}>✓ Bestätigen ({pendingItems(g).length})</button>
        <button class="danger" onclick={() => (rejectGroup = g)}>Ablehnen</button>
        <a class="small edit-link" href="#/kalender">Einzelne Termine im Kalender anpassen →</a>
      </div>
    </div>
  {/each}
</div>

<p class="small muted hint">💬 Anfragen lassen sich auch direkt in Telegram per Knopf bestätigen oder ablehnen.</p>

{#if rejectGroup}
  <ConfirmDialog
    title="Buchungsanfrage ablehnen?"
    message={`Alle ${pendingItems(rejectGroup).length} offenen Termine von ${rejectGroup.owner.name} werden abgelehnt.`}
    confirmLabel="Anfrage ablehnen"
    onconfirm={() => decide(rejectGroup!.id, 'reject')}
    onclose={() => (rejectGroup = null)}
  />
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head { justify-content: flex-start; }
  .head h2 { margin: 0; }
  ul { margin: 8px 0; padding-left: 20px; }
  .edit-link { margin-left: auto; }
  .hint { margin-top: 12px; }
  .note { margin-bottom: 10px; }
</style>
