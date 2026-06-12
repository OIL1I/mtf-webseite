<script lang="ts">
  import Modal from './Modal.svelte';

  let {
    title,
    message,
    confirmLabel = 'Bestätigen',
    danger = true,
    onconfirm,
    onclose,
  }: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onconfirm: () => void | Promise<void>;
    onclose: () => void;
  } = $props();

  let busy = $state(false);

  async function confirm(): Promise<void> {
    busy = true;
    try {
      await onconfirm();
      onclose();
    } finally {
      busy = false;
    }
  }
</script>

<Modal {title} {onclose}>
  <p>{message}</p>
  <div class="actions">
    <button class="ghost" onclick={onclose} disabled={busy}>Abbrechen</button>
    <button class:danger class:primary={!danger} onclick={confirm} disabled={busy}>
      {busy ? 'Bitte warten…' : confirmLabel}
    </button>
  </div>
</Modal>

<style>
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
