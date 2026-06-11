<script lang="ts">
  import Modal from './Modal.svelte';
  import { api } from '../lib/api';
  import { session } from '../lib/session.svelte';
  import { appData } from '../lib/appdata.svelte';
  import { fmtRange, fmtDateShort, fmtTime } from '../lib/time';
  import type { Booking, Comment } from '../lib/types';

  let { booking, onclose, onChanged }: { booking: Booking; onclose: () => void; onChanged: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let editMode = $state(false);
  let waitlistNote = $state<string | null>(null);

  const features = $derived(appData.meta?.features ?? null);

  // Rückfragen (Beta)
  let comments = $state<Comment[]>([]);
  let commentsEnabled = $state(false);
  let newComment = $state('');
  let commentBusy = $state(false);

  const canComment = $derived(!!features?.comments && (booking.mine || session.isManager));

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

  async function joinWaitlist(): Promise<void> {
    try {
      await api('/api/waitlist', { body: { start: booking.start, end: booking.end, vehicleId: booking.vehicleId } });
      waitlistNote = 'Du stehst auf der Warteliste und wirst bei einer Stornierung benachrichtigt.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Eintragen fehlgeschlagen';
    }
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let editStart = $state(toLocalInput(booking.start));
  let editEnd = $state(toLocalInput(booking.end));

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
</script>

<Modal title={booking.purpose} {onclose}>
  <p>
    {fmtRange(booking.start, booking.end)}<br />
    <span class="muted small">
      Gebucht von {booking.mine ? 'dir' : booking.userName}{features?.vehicles ? ` · 🚒 ${booking.vehicleName}` : ''}
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
        <button class="primary" onclick={adminMove} disabled={busy}>Verschieben</button>
        <button class="ghost" onclick={() => (editMode = false)}>Abbrechen</button>
      </div>
    </div>
  {:else}
    <div class="row buttons">
      {#if session.isManager && booking.status === 'pending'}
        <button class="primary" onclick={() => adminAction('approve')} disabled={busy}>✓ Bestätigen</button>
        <button class="danger" onclick={() => adminAction('reject')} disabled={busy}>Ablehnen</button>
      {/if}
      {#if session.isManager && active}
        <button onclick={() => (editMode = true)} disabled={busy}>Verschieben…</button>
        <button class="danger" onclick={() => adminAction('cancel')} disabled={busy}>Stornieren (Admin)</button>
      {/if}
      {#if booking.mine && active && !session.isManager}
        <button class="danger" onclick={cancelOwn} disabled={busy || withinDeadline}>Stornieren</button>
        {#if booking.seriesKey}
          <button class="danger" onclick={cancelSeries} disabled={busy}>Ganze Serie stornieren</button>
        {/if}
      {/if}
    </div>
    {#if booking.mine && active && !session.isManager && withinDeadline}
      <p class="small muted">
        Die Stornofrist ({deadlineH} Std. vor Beginn) ist abgelaufen – bitte wende dich an einen Admin.
      </p>
    {/if}
    {#if features?.waitlist && !booking.mine && active && Date.parse(booking.start) > Date.now()}
      {#if waitlistNote}
        <div class="note green">{waitlistNote}</div>
      {:else}
        <button onclick={joinWaitlist} disabled={busy}>🔔 Bei Stornierung benachrichtigen (Warteliste)</button>
      {/if}
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
