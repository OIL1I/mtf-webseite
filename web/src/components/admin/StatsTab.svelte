<script lang="ts">
  import { api, API_BASE } from '../../lib/api';
  import { session } from '../../lib/session.svelte';
  import { appData } from '../../lib/appdata.svelte';
  import { fmtRange, WEEKDAYS_SHORT } from '../../lib/time';
  import type { Stats } from '../../lib/types';

  let stats = $state<Stats | null>(null);
  let error = $state<string | null>(null);
  let logs = $state<Record<string, unknown>[]>([]);

  const features = $derived(appData.meta?.features ?? null);

  $effect(() => {
    api<Stats>('/api/admin/stats')
      .then((s) => (stats = s))
      .catch((e) => (error = e instanceof Error ? e.message : 'Laden fehlgeschlagen'));
    if (appData.meta?.features.tripLog) {
      api<{ logs: Record<string, unknown>[] }>('/api/admin/triplogs')
        .then((r) => (logs = r.logs))
        .catch(() => undefined);
    }
  });

  const maxMonthHours = $derived(Math.max(1, ...(stats?.months ?? []).map((m) => m.hours)));
  const maxUserHours = $derived(Math.max(1, ...(stats?.topUsers ?? []).map((u) => u.hours)));
  const maxWeekdayHours = $derived(Math.max(1, ...(stats?.weekdays ?? []).map((w) => w.hours)));

  function monthLabel(m: string): string {
    const [y, mo] = m.split('-');
    return `${mo}/${y.slice(2)}`;
  }

  /** SQLite %w: 0 = Sonntag … 6 = Samstag → deutscher Index 0 = Montag */
  function weekdayHours(deIdx: number): number {
    const sqliteIdx = (deIdx + 1) % 7;
    return stats?.weekdays.find((w) => w.weekday === sqliteIdx)?.hours ?? 0;
  }

  async function downloadCsv(): Promise<void> {
    error = null;
    try {
      const res = await fetch(`${API_BASE}/api/admin/export.csv`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) throw new Error('Export fehlgeschlagen');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mtf-buchungen.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Export fehlgeschlagen';
    }
  }
</script>

{#if error}<div class="note red">{error}</div>{/if}

{#if stats}
  <div class="grid">
    <div class="card">
      <h2>📊 Stunden pro Monat (12 Monate)</h2>
      {#if stats.months.length === 0}
        <p class="small muted">Noch keine bestätigten Buchungen.</p>
      {/if}
      {#each stats.months as m (m.month)}
        <div class="bar-row">
          <span class="label">{monthLabel(m.month)}</span>
          <div class="bar"><div class="fill" style={`width:${(m.hours / maxMonthHours) * 100}%`}></div></div>
          <span class="value">{m.hours} Std. · {m.count}×</span>
        </div>
      {/each}
    </div>

    <div class="card">
      <h2>🏆 Top-Nutzer (12 Monate)</h2>
      {#if stats.topUsers.length === 0}
        <p class="small muted">Noch keine Daten.</p>
      {/if}
      {#each stats.topUsers as u (u.name)}
        <div class="bar-row">
          <span class="label name">{u.name}</span>
          <div class="bar"><div class="fill" style={`width:${(u.hours / maxUserHours) * 100}%`}></div></div>
          <span class="value">{u.hours} Std.</span>
        </div>
      {/each}
    </div>

    <div class="card">
      <h2>📅 Auslastung nach Wochentag</h2>
      {#each WEEKDAYS_SHORT as wd, i (wd)}
        <div class="bar-row">
          <span class="label">{wd}</span>
          <div class="bar"><div class="fill" style={`width:${(weekdayHours(i) / maxWeekdayHours) * 100}%`}></div></div>
          <span class="value">{weekdayHours(i)} Std.</span>
        </div>
      {/each}
    </div>

    {#if features?.tripLog}
      <div class="card">
        <h2>📓 Letzte Fahrtenbuch-Einträge</h2>
        {#if logs.length === 0}
          <p class="small muted">Noch keine Einträge.</p>
        {/if}
        {#each logs as log (log.id)}
          <div class="line small">
            <strong>{log.purpose}</strong> · {log.user_name} · {fmtRange(String(log.start_ts), String(log.end_ts))}<br />
            <span class="muted">
              {log.km_start != null ? `${log.km_start} km` : '–'} → {log.km_end != null ? `${log.km_end} km` : '–'}
              {log.km_start != null && log.km_end != null ? ` (${Number(log.km_end) - Number(log.km_start)} km)` : ''}
              {log.note ? ` · ${log.note}` : ''}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if features?.csvExport}
    <div class="export-row">
      <button onclick={downloadCsv}>📄 Alle Buchungen als CSV herunterladen</button>
    </div>
  {/if}
{:else if !error}
  <p class="muted">Lade Statistik…</p>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
  }
  .label { width: 44px; color: var(--muted); flex: none; }
  .label.name { width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar {
    flex: 1;
    height: 14px;
    background: var(--surface-2);
    border-radius: 4px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    min-width: 2px;
  }
  .value { width: 110px; text-align: right; font-size: 12px; color: var(--muted); flex: none; }
  .line {
    border-top: 1px solid var(--border);
    padding: 7px 0;
  }
  .line:first-of-type { border-top: none; }
  .export-row { margin-top: 12px; }
  .note { margin-bottom: 10px; }
</style>
