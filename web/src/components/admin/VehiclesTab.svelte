<script lang="ts">
  import { api } from '../../lib/api';
  import { appData } from '../../lib/appdata.svelte';
  import { LICENSE_CLASSES, type Vehicle } from '../../lib/types';

  let error = $state<string | null>(null);
  let note = $state<string | null>(null);

  let newName = $state('');
  let newFrom = $state('');
  let newTo = $state('');
  let newNote = $state('');
  let newClass = $state('');

  let editId = $state<number | null>(null);
  let editName = $state('');
  let editFrom = $state('');
  let editTo = $state('');
  let editNote = $state('');
  let editClass = $state('');

  const vehicles = $derived(appData.meta?.vehicles ?? []);

  function toLocalInput(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtWindow(v: Vehicle): string {
    if (!v.available_from && !v.available_to) return 'dauerhaft verfügbar';
    const f = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `verfügbar ${v.available_from ? 'ab ' + f(v.available_from) : ''}${v.available_to ? ' bis ' + f(v.available_to) : ''}`;
  }

  async function add(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    note = null;
    try {
      const res = await api<{ vehicles: Vehicle[] }>('/api/admin/vehicles', {
        body: {
          name: newName.trim(),
          available_from: newFrom ? new Date(newFrom).toISOString() : undefined,
          available_to: newTo ? new Date(newTo).toISOString() : undefined,
          note: newNote.trim() || undefined,
          required_class: newClass || undefined,
        },
      });
      if (appData.meta) appData.meta.vehicles = res.vehicles;
      note = `Fahrzeug „${newName.trim()}" angelegt.`;
      newName = '';
      newFrom = '';
      newTo = '';
      newNote = '';
      newClass = '';
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : 'Anlegen fehlgeschlagen';
    }
  }

  async function patch(id: number, body: Record<string, unknown>): Promise<void> {
    error = null;
    try {
      const res = await api<{ vehicles: Vehicle[] }>(`/api/admin/vehicles/${id}`, { method: 'PATCH', body });
      if (appData.meta) appData.meta.vehicles = res.vehicles;
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : 'Ändern fehlgeschlagen';
    }
  }

  function startEdit(v: Vehicle): void {
    if (editId === v.id) {
      editId = null;
      return;
    }
    editId = v.id;
    editName = v.name;
    editFrom = toLocalInput(v.available_from);
    editTo = toLocalInput(v.available_to);
    editNote = v.note ?? '';
    editClass = v.required_class ?? '';
  }

  async function saveEdit(): Promise<void> {
    if (editId === null) return;
    await patch(editId, {
      name: editName.trim(),
      available_from: editFrom ? new Date(editFrom).toISOString() : null,
      available_to: editTo ? new Date(editTo).toISOString() : null,
      note: editNote.trim() || null,
      required_class: editClass || null,
    });
    editId = null;
  }
</script>

{#if note}<div class="note green">{note}</div>{/if}
{#if error}<div class="note red">{error}</div>{/if}

<div class="card">
  <h2>🚒 Fahrzeuge</h2>
  <p class="small muted">
    Temporäre Fahrzeuge (z.B. Leihwagen) bekommen ein Verfügbarkeitsfenster – außerhalb davon sind sie nicht buchbar.
    Jedes Fahrzeug hat seinen eigenen Kalender.
  </p>
  {#each vehicles as v (v.id)}
    <div class="row line" class:inactive={!v.active}>
      <div class="grow">
        <strong class="small">{v.name}</strong>
        <div class="small muted">{fmtWindow(v)}{v.note ? ` · ${v.note}` : ''}</div>
      </div>
      <span class="badge gray">🪪 {v.required_class || 'keine Vorgabe'}</span>
      {#if !v.active}<span class="badge gray">deaktiviert</span>{/if}
      {#if v.available_from || v.available_to}<span class="badge amber">temporär</span>{/if}
      <button class="ghost small-btn" onclick={() => startEdit(v)}>{editId === v.id ? 'Zuklappen' : 'Bearbeiten'}</button>
      {#if v.id !== 1}
        <button class="ghost small-btn" onclick={() => patch(v.id, { active: !v.active })}>
          {v.active ? 'Deaktivieren' : 'Aktivieren'}
        </button>
      {/if}
    </div>
    {#if editId === v.id}
      <div class="edit">
        <label>Name <input bind:value={editName} /></label>
        <label>Führerscheinklasse
          <select bind:value={editClass}>
            <option value="">keine Vorgabe</option>
            {#each LICENSE_CLASSES as cl (cl)}<option value={cl}>{cl}</option>{/each}
          </select>
        </label>
        <label>Verfügbar ab <input type="datetime-local" bind:value={editFrom} /></label>
        <label>Verfügbar bis <input type="datetime-local" bind:value={editTo} /></label>
        <label>Notiz <input bind:value={editNote} placeholder="z.B. Leihwagen Autohaus Müller" /></label>
        <button class="primary small-btn" onclick={saveEdit}>Speichern</button>
      </div>
    {/if}
  {/each}
</div>

<form class="card add" onsubmit={add}>
  <h2>＋ Fahrzeug hinzufügen</h2>
  <div class="grid">
    <label>Name * <input bind:value={newName} placeholder="z.B. Leihwagen Sprinter" required /></label>
    <label>Benötigte Führerscheinklasse
      <select bind:value={newClass}>
        <option value="">keine Vorgabe</option>
        {#each LICENSE_CLASSES as cl (cl)}<option value={cl}>{cl}</option>{/each}
      </select>
    </label>
    <label>Notiz <input bind:value={newNote} placeholder="optional" /></label>
    <label>Verfügbar ab <input type="datetime-local" bind:value={newFrom} /></label>
    <label>Verfügbar bis <input type="datetime-local" bind:value={newTo} /></label>
  </div>
  <p class="small muted">Ohne Verfügbarkeitsfenster ist das Fahrzeug dauerhaft buchbar.</p>
  <button class="primary">Anlegen</button>
</form>

<style>
  .line {
    border-top: 1px solid var(--border);
    padding: 9px 0;
  }
  .line:first-of-type { border-top: none; }
  .line.inactive { opacity: 0.55; }
  .grow { flex: 1; min-width: 0; }
  .small-btn { padding: 4px 10px; font-size: 13px; }
  .edit {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: flex-end;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 10px;
    margin-bottom: 8px;
  }
  .edit label, .add label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .add { margin-top: 14px; }
  .add .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
    margin-bottom: 8px;
  }
  .note { margin-bottom: 10px; }
</style>
