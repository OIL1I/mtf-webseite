<script lang="ts">
  import Toggle from '../Toggle.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { api } from '../../lib/api';
  import { appData } from '../../lib/appdata.svelte';
  import { WEEKDAYS_SHORT, WEEKDAYS_LONG } from '../../lib/time';
  import { LICENSE_CLASSES, type Blackout, type Rules, type Vehicle } from '../../lib/types';

  let rules = $state<Rules>(JSON.parse(JSON.stringify(appData.meta!.rules)) as Rules);
  let saving = $state(false);
  let note = $state<string | null>(null);
  let error = $state<string | null>(null);
  let deleteConfirmation = $state<Blackout | null>(null);

  const timeOptions: string[] = [];
  for (let h = 0; h <= 24; h++) {
    timeOptions.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 24) timeOptions.push(`${String(h).padStart(2, '0')}:30`);
  }

  async function save(): Promise<void> {
    saving = true;
    error = null;
    note = null;
    try {
      await api('/api/admin/settings', { method: 'PUT', body: rules });
      await appData.load(true);
      note = 'Regeln gespeichert.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    } finally {
      saving = false;
    }
  }

  // --- Führerscheinklasse des Standard-Fahrzeugs ---
  let mtfClass = $state(appData.meta?.vehicles.find((v) => v.id === 1)?.required_class ?? '');
  let mtfClassNote = $state<string | null>(null);

  async function saveMtfClass(): Promise<void> {
    mtfClassNote = null;
    try {
      const res = await api<{ vehicles: Vehicle[] }>('/api/admin/vehicles/1', {
        method: 'PATCH',
        body: { required_class: mtfClass || null },
      });
      if (appData.meta) appData.meta.vehicles = res.vehicles;
      mtfClassNote = 'Gespeichert.';
    } catch (e) {
      mtfClassNote = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    }
  }

  // --- Sperrzeiten ---
  let blkTitle = $state('');
  let blkKind = $state<'weekly' | 'once' | 'interval'>('weekly');
  let blkWeekday = $state(0);
  let blkStart = $state('19:00');
  let blkEnd = $state('22:00');
  let blkOnceStart = $state('');
  let blkOnceEnd = $state('');
  let blkEvery = $state(2);
  let blkUnit = $state<'day' | 'week' | 'month'>('week');
  let blkAnchor = $state('');
  let blkError = $state<string | null>(null);

  const UNIT_LABELS: Record<'day' | 'week' | 'month', [string, string]> = {
    day: ['Tag', 'Tage'],
    week: ['Woche', 'Wochen'],
    month: ['Monat', 'Monate'],
  };

  async function addBlackout(): Promise<void> {
    blkError = null;
    if (!blkTitle.trim()) {
      blkError = 'Bitte eine Bezeichnung angeben.';
      return;
    }
    if (blkKind === 'interval' && !blkAnchor) {
      blkError = 'Bitte den ersten Termin (Datum) angeben.';
      return;
    }
    try {
      const body =
        blkKind === 'weekly'
          ? { title: blkTitle.trim(), kind: 'weekly', weekday: blkWeekday, start_time: blkStart, end_time: blkEnd }
          : blkKind === 'interval'
            ? {
                title: blkTitle.trim(),
                kind: 'interval',
                repeat_every: blkEvery,
                repeat_unit: blkUnit,
                anchor_date: blkAnchor,
                start_time: blkStart,
                end_time: blkEnd,
              }
            : {
                title: blkTitle.trim(),
                kind: 'once',
                start_ts: new Date(blkOnceStart).toISOString(),
                end_ts: new Date(blkOnceEnd).toISOString(),
              };
      const res = await api<{ blackouts: Blackout[] }>('/api/admin/blackouts', { body });
      if (appData.meta) appData.meta.blackouts = res.blackouts;
      blkTitle = '';
    } catch (e) {
      blkError = e instanceof Error ? e.message : 'Anlegen fehlgeschlagen';
    }
  }

  async function deleteBlackout(id: number): Promise<void> {
    const res = await api<{ blackouts: Blackout[] }>(`/api/admin/blackouts/${id}`, { method: 'DELETE' });
    if (appData.meta) appData.meta.blackouts = res.blackouts;
  }

  function fmtBlackout(b: Blackout): string {
    if (b.kind === 'weekly') return `Jeden ${WEEKDAYS_LONG[b.weekday ?? 0]} · ${b.start_time}–${b.end_time} Uhr`;
    if (b.kind === 'interval') {
      const n = b.repeat_every ?? 1;
      const unit = UNIT_LABELS[b.repeat_unit ?? 'week'][n === 1 ? 0 : 1];
      const ab = b.anchor_date ? new Date(`${b.anchor_date}T00:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '?';
      return `${n === 1 ? `Jede(n) ${unit}` : `Alle ${n} ${unit}`} ab ${ab} · ${b.start_time}–${b.end_time} Uhr`;
    }
    const f = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `Einmalig · ${f(b.start_ts!)} – ${f(b.end_ts!)}`;
  }
</script>

<div class="grid">
  <div class="card">
    <h2>📅 Wochenplan</h2>
    <p class="small muted">Buchbare Zeiten je Wochentag.</p>
    {#each rules.weeklyHours as day, i (i)}
      <div class="row line">
        <span class="wd">{WEEKDAYS_SHORT[i]}</span>
        <Toggle bind:checked={day.enabled} label={`${WEEKDAYS_LONG[i]} buchbar`} />
        {#if day.enabled}
          <select bind:value={day.open}>
            {#each timeOptions as t (t)}<option value={t}>{t}</option>{/each}
          </select>
          <span class="muted">–</span>
          <select bind:value={day.close}>
            {#each timeOptions as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        {:else}
          <span class="muted small">nicht buchbar</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="card">
    <h2>⛔ Sperrzeiten</h2>
    <p class="small muted">Wiederkehrend oder einmalig – nie buchbar, erscheinen schraffiert im Kalender.</p>
    {#each appData.meta?.blackouts ?? [] as b (b.id)}
      <div class="row line">
        <div class="grow">
          <strong class="small">{b.title}</strong>
          <div class="small muted">{fmtBlackout(b)}</div>
        </div>
        <button class="ghost" onclick={() => (deleteConfirmation = b)} aria-label={`Sperrzeit ${b.title} löschen`}>🗑</button>
      </div>
    {/each}
    <div class="add">
      <input bind:value={blkTitle} placeholder="Bezeichnung, z.B. Übungsdienst" />
      <div class="row">
        <select bind:value={blkKind}>
          <option value="weekly">wöchentlich</option>
          <option value="interval">Intervall (alle N …)</option>
          <option value="once">einmalig</option>
        </select>
        {#if blkKind === 'weekly'}
          <select bind:value={blkWeekday}>
            {#each WEEKDAYS_LONG as wd, i (wd)}<option value={i}>{wd}</option>{/each}
          </select>
          <input type="time" bind:value={blkStart} />
          <input type="time" bind:value={blkEnd} />
        {:else if blkKind === 'interval'}
          <span class="small muted">alle</span>
          <select bind:value={blkEvery} aria-label="Wiederholung">
            {#each [1, 2, 3, 4, 5, 6, 8, 10, 12] as n (n)}<option value={n}>{n}</option>{/each}
          </select>
          <select bind:value={blkUnit} aria-label="Einheit">
            <option value="day">Tage</option>
            <option value="week">Wochen</option>
            <option value="month">Monate</option>
          </select>
          <span class="small muted">ab</span>
          <input type="date" bind:value={blkAnchor} aria-label="Erster Termin" />
          <input type="time" bind:value={blkStart} />
          <input type="time" bind:value={blkEnd} />
        {:else}
          <input type="datetime-local" bind:value={blkOnceStart} aria-label="Beginn" />
          <input type="datetime-local" bind:value={blkOnceEnd} aria-label="Ende" />
        {/if}
      </div>
      {#if blkKind === 'interval'}
        <p class="small muted">Der erste Termin bestimmt den Rhythmus, z. B. „alle 2 Wochen ab Mo 15.06." = Übungsdienst jede zweite Woche. Der Wochentag ergibt sich aus dem Datum.</p>
      {/if}
      {#if blkError}<div class="note red">{blkError}</div>{/if}
      <button onclick={addBlackout}>+ Sperrzeit hinzufügen</button>
    </div>
  </div>

  <div class="card">
    <h2>⏱ Fristen &amp; Puffer</h2>
    <div class="row line"><span class="grow">Max. Dauer pro Buchung</span>
      <select bind:value={rules.maxDurationHours}>
        {#each [1, 2, 3, 4, 6, 8, 10, 12, 24, 48, 72] as v (v)}<option value={v}>{v} Std.</option>{/each}
      </select>
    </div>
    <div class="row line"><span class="grow">Mindestvorlauf</span>
      <select bind:value={rules.minLeadHours}>
        {#each [0, 1, 2, 4, 8, 12, 24, 48] as v (v)}<option value={v}>{v} Std.</option>{/each}
      </select>
    </div>
    <div class="row line"><span class="grow">Max. Vorlauf</span>
      <select bind:value={rules.maxLeadDays}>
        {#each [30, 60, 90, 180, 365] as v (v)}<option value={v}>{v} Tage</option>{/each}
      </select>
    </div>
    <div class="row line"><span class="grow">Stornofrist vor Beginn</span>
      <select bind:value={rules.cancelDeadlineHours}>
        {#each [0, 2, 6, 12, 24, 48] as v (v)}<option value={v}>{v} Std.</option>{/each}
      </select>
    </div>
    <div class="row line"><span class="grow">Puffer zwischen Buchungen</span>
      <select bind:value={rules.bufferMinutes}>
        {#each [0, 15, 30, 45, 60, 90, 120] as v (v)}<option value={v}>{v} Min.</option>{/each}
      </select>
    </div>
    <div class="row line">
      <span class="grow">🪪 Benötigte Führerscheinklasse (MTF)</span>
      <select bind:value={mtfClass} onchange={saveMtfClass}>
        <option value="">keine Vorgabe</option>
        {#each LICENSE_CLASSES as cl (cl)}<option value={cl}>{cl}</option>{/each}
      </select>
    </div>
    {#if mtfClassNote}<p class="small muted">{mtfClassNote} Fahrer:innen werden beim Buchen danach gefiltert – Klassen pflegst du im Tab „Nutzer".</p>{/if}
    <p class="small muted">Nach Ablauf der Stornofrist können nur noch Admins stornieren.</p>
  </div>

  <div class="card">
    <h2>🛡 Freigabe (Review)</h2>
    <div class="row line">
      <span class="grow">Freigabe ab Dauer über</span>
      <select bind:value={rules.reviewDurationOverHours} disabled={!rules.reviewDurationEnabled}>
        {#each [1, 2, 3, 4, 6, 8, 12] as v (v)}<option value={v}>{v} Std.</option>{/each}
      </select>
      <Toggle bind:checked={rules.reviewDurationEnabled} label="Freigabe nach Dauer" />
    </div>
    <div class="row line">
      <span class="grow">Freigabe bei Buchung kurzfristiger als</span>
      <select bind:value={rules.reviewShortNoticeUnderHours} disabled={!rules.reviewShortNoticeEnabled}>
        {#each [6, 12, 24, 48, 72] as v (v)}<option value={v}>{v} Std.</option>{/each}
      </select>
      <Toggle bind:checked={rules.reviewShortNoticeEnabled} label="Freigabe bei Kurzfristigkeit" />
    </div>
    <div class="row line">
      <span class="grow">Serien brauchen immer Freigabe</span>
      <Toggle bind:checked={rules.reviewSeries} label="Serien-Freigabe" />
    </div>
    <div class="row line">
      <span class="grow">Jede Buchung braucht Freigabe</span>
      <Toggle bind:checked={rules.reviewAll} label="Alles freigeben" />
    </div>
    <p class="small muted">Angefragte Termine blockieren den Slot, bis ein Admin entscheidet. Admin-eigene Buchungen sind sofort bestätigt.</p>
  </div>
</div>

{#if note}<div class="note green">{note}</div>{/if}
{#if error}<div class="note red">{error}</div>{/if}
<div class="save-row">
  <button class="primary" onclick={save} disabled={saving}>{saving ? 'Speichert…' : 'Alle Regeln speichern'}</button>
</div>

{#if deleteConfirmation}
  <ConfirmDialog
    title="Sperrzeit löschen?"
    message={`„${deleteConfirmation.title}" wird dauerhaft entfernt.`}
    confirmLabel="Löschen"
    onconfirm={() => deleteBlackout(deleteConfirmation!.id)}
    onclose={() => (deleteConfirmation = null)}
  />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
    margin-bottom: 14px;
  }
  .line {
    border-top: 1px solid var(--border);
    padding: 7px 0;
    font-size: 14px;
  }
  .line:first-of-type { border-top: none; }
  .wd { width: 28px; font-weight: 600; font-size: 13px; }
  .grow { flex: 1; min-width: 0; }
  select { padding: 5px 8px; font-size: 13px; }
  .add {
    border-top: 1px solid var(--border);
    margin-top: 8px;
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .add input[type='time'], .add input[type='datetime-local'] { font-size: 13px; padding: 5px 8px; }
  .save-row {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
  .note { margin-top: 10px; }
</style>
