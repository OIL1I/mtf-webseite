<script lang="ts">
  import { api } from '../../lib/api';
  import { fmtDateShort, fmtTime } from '../../lib/time';
  import type { AuditEntry } from '../../lib/types';

  let entries = $state<AuditEntry[]>([]);
  let error = $state<string | null>(null);
  let loaded = $state(false);

  $effect(() => {
    api<{ entries: AuditEntry[] }>('/api/admin/audit')
      .then((r) => {
        entries = r.entries;
        loaded = true;
      })
      .catch((e) => (error = e instanceof Error ? e.message : 'Laden fehlgeschlagen'));
  });
</script>

{#if error}<div class="note red">{error}</div>{/if}

<div class="card">
  <h2>📜 Audit-Log</h2>
  <p class="small muted">Die letzten 200 Verwaltungs-Aktionen, neueste zuerst. Protokolliert wird nur, solange das Feature aktiv ist.</p>
  {#if loaded && entries.length === 0}
    <p class="muted">Noch keine Einträge.</p>
  {/if}
  {#each entries as e (e.id)}
    <div class="line">
      <span class="when small muted">{fmtDateShort(e.created_at)} {fmtTime(e.created_at)}</span>
      <span class="actor small">{e.actor}</span>
      <span class="badge gray">{e.action}</span>
      <span class="detail small muted">{e.detail}</span>
    </div>
  {/each}
</div>

<style>
  .line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    border-top: 1px solid var(--border);
    padding: 7px 0;
    flex-wrap: wrap;
  }
  .line:first-of-type { border-top: none; }
  .when { width: 120px; flex: none; }
  .actor { font-weight: 600; }
  .detail { flex: 1; min-width: 200px; }
  .note { margin-bottom: 10px; }
</style>
