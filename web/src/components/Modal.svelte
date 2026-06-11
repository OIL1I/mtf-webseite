<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  role="presentation"
>
  <div class="dialog card" role="dialog" aria-modal="true" aria-label={title}>
    <div class="head">
      <h2>{title}</h2>
      <button class="ghost" onclick={onclose} aria-label="Schließen">✕</button>
    </div>
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 100;
  }
  .dialog {
    width: 100%;
    max-width: 460px;
    max-height: 88vh;
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .head h2 { margin: 0; }
</style>
