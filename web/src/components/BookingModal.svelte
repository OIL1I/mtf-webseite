<script lang="ts">
  import Modal from './Modal.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { api } from '../lib/api';
  import { session } from '../lib/session.svelte';
  import { appData } from '../lib/appdata.svelte';
  import { fmtRange, fmtDateShort, fmtTime } from '../lib/time';
  import type { Booking, Comment } from '../lib/types';

  let { booking, onclose, onChanged }: { booking: Booking; onclose: () => void; onChanged: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let editMode = $state(false);
  let confirmation = $state<{ title: string; message: string; label: string; action: () => Promise<void> } | null>(null);

  // Rückfragen
  let comments = $state<Comment[]>([]);
  let commentsEnabled = $state(false);
  let newComment = $state('');
  let commentBusy = $state(false);

  const canComment = $derived(booking.mine || session.isManager);
  const showVehicle = $derived((appData.meta?.vehicles.length ?? 0) > 1);

  async function loadComments(): Promise<void> {
    if (!canComment) return;
    try {
      const res = await api<{ comments: Comment[]; enabled: boolean }>(`/api/groups/${booking.groupId}/comments`);
      comments = res.comments;
      commentsEnabled = res.enabled;
    } catch {
      commentsEnabled = false;
    }
  }

  $effect(() => {
    loadComments();
  });

  async function sendComment(): Promise<void> {
    if (!newComment.trim()) return;
    commentBusy = true;
    try {
      await api(`/api/groups/${booking.groupId}/comments`, { body: { text: newComment.trim() } });
      newComment = '';
      await loadComments();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Senden fehlgeschlagen';
    } finally {
      commentBusy = false;
    }
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let editStart = $state('');
  let editEnd = $state('');

  $effect(() => {
    editStart = toLocalInput(booking.start);
    editEnd = toLocalInput(booking.end);
  });

  const active = $derived(booking.status === 'confirmed' || booking.status === 'pending');
  const deadlineH = $derived(appData.meta?.rules.cancelDeadlineHours ?? 0);
  const withinDeadline = $derived(Date.parse(booking.start) - Date.now() < deadlineH * 3_600_000);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    busy = true;
    error = null;
    try {
      await fn();
      onChanged();
      onclose();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Aktion fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  const cancelOwn = () => run(() => api(`/api/bookings/${booking.id}/cancel`, { body: {} }));
  const cancelSeries = () =>
    run(() => api('/api/bookings/cancel-series', { body: { groupId: booking.groupId, seriesKey: booking.seriesKey } }));
  const adminAction = (action: string) => run(() => api(`/api/admin/bookings/${booking.id}`, { method: 'PATCH', body: { action } }));
  const adminMove = () =>
    run(() =>
      api(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        body: { start: new Date(editStart).toISOString(), end: new Date(editEnd).toISOString() },
      })
    );

  function ask(title: string, message: string, label: string, action: () => Promise<void>): void {
    confirmation = { title, message, label, action };
  }
</script>

<Modal title={booking.purpose} {onclose}>
  <p>
    {fmtRange(booking.start, booking.end)}<br />
    <span class="muted small">
      Gebucht von {booking.mine ? 'dir' : booking.userName}{showVehicle ? ` · 🚒 ${booking.vehicleName}` : ''}
    </span>
  </p>
  <p>
    {#if booking.status === 'pending'}
      <span class="badge amber">wartet auf Freigabe</span>
    {:else if booking.status === 'confirmed'}
      <span class="badge green">bestätigt</span>
    {:else}
      <span class="badge gray">{booking.status === 'cancelled' ? 'storniert' : 'abgelehnt'}</span>
    {/if}
    {#if booking.seriesKey}<span class="badge red">Teil einer Serie</span>{/if}
  </p>

  {#if error}<div class="note red">{error}</div>{/if}

  {#if editMode}
    <div class="edit">
      <label>Beginn <input type="datetime-local" bind:value={editStart} /></label>
      <label>Ende <input type="datetime-local" bind:value={editEnd} /></label>
      <div class="row">
        <button
          class="primary"
          onclick={() =>
            ask(
              'Termin verschieben?',
              `${fmtRange(booking.start, booking.end)} wird auf ${fmtRange(new Date(editStart).toISOString(), new Date(editEnd).toISOString())} verschoben.`,
              'Verschieben',
              adminMove
            )}
          disabled={busy || !editStart || !editEnd}
        >Verschieben</button>
        <button class="ghost" onclick={() => (editMode = false)}>Abbrechen</button>
      </div>
    </div>
  {:else}
    <div class="row buttons">
      {#if session.isManager && booking.status === 'pending'}
        <button class="primary" onclick={() => adminAction('approve')} disabled={busy}>✓ Bestätigen</button>
        <button
          class="danger"
          onclick={() => ask('Termin ablehnen?', `${fmtRange(booking.start, booking.end)} wird abgelehnt.`, 'Ablehnen', () => adminAction('reject'))}
          disabled={busy}
        >Ablehnen</button>
      {/if}
      {#if session.isManager && active}
        <button onclick={() => (editMode = true)} disabled={busy}>Verschieben…</button>
        <button
          class="danger"
          onclick={() => ask('Termin stornieren?', `${fmtRange(booking.start, booking.end)} wird durch einen Admin storniert.`, 'Stornieren', () => adminAction('cancel'))}
          disabled={busy}
        >Stornieren (Admin)</button>
      {/if}
      {#if booking.mine && active && !session.isManager}
        <button
          class="danger"
          onclick={() => ask('Termin stornieren?', `${fmtRange(booking.start, booking.end)} wird verbindlich storniert.`, 'Stornieren', cancelOwn)}
          disabled={busy || withinDeadline}
        >Stornieren</button>
        {#if booking.seriesKey}
          <button
            class="danger"
            onclick={() => ask('Ganze Serie stornieren?', 'Alle noch stornierbaren zukünftigen Termine dieser Serie werden storniert.', 'Serie stornieren', cancelSeries)}
            disabled={busy}
          >Ganze Serie stornieren</button>
        {/if}
      {/if}
    </div>
    {#if booking.mine && active && !session.isManager && withinDeadline}
      <p class="small muted">
        Die Stornofrist ({deadlineH} Std. vor Beginn) ist abgelaufen – bitte wende dich an einen Admin.
      </p>
    {/if}
  {/if}

  {#if canComment && commentsEnabled}
    <div class="comments">
      <h3>💬 Rückfragen</h3>
      {#each comments as cm (cm.id)}
        <div class="comment" class:manager={cm.role === 'manager'}>
          <span class="who small">{cm.name}{cm.role === 'manager' ? ' (Admin)' : ''} · {fmtDateShort(cm.created_at)} {fmtTime(cm.created_at)}</span>
          <p>{cm.text}</p>
        </div>
      {:else}
        <p class="small muted">Noch keine Rückfragen zu dieser Buchung.</p>
      {/each}
      <div class="comment-form">
        <input bind:value={newComment} placeholder="Frage oder Antwort schreiben…" maxlength="1000"
          onkeydown={(e) => e.key === 'Enter' && sendComment()} />
        <button class="primary" onclick={sendComment} disabled={commentBusy || !newComment.trim()}>Senden</button>
      </div>
    </div>
  {/if}
</Modal>

{#if confirmation}
  <ConfirmDialog
    title={confirmation.title}
    message={confirmation.message}
    confirmLabel={confirmation.label}
    onconfirm={confirmation.action}
    onclose={() => (confirmation = null)}
  />
{/if}

<style>
  .buttons { margin-top: 6px; }
  .comments {
    border-top: 1px solid var(--border);
    margin-top: 14px;
    padding-top: 10px;
  }
  .comment {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    margin-bottom: 6px;
  }
  .comment.manager { background: var(--accent-soft); }
  .comment .who { color: var(--muted); }
  .comment p { margin: 2px 0 0; font-size: 14px; }
  .comment-form {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .comment-form input { flex: 1; }
  .edit label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 8px;
  }
</style>
