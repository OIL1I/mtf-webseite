<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  let dialog: HTMLDivElement;
  let previousFocus: HTMLElement | null = null;

  function onKeydown(e: KeyboardEvent): void {
    if (!dialog?.contains(document.activeElement)) return;
    if (e.key === 'Escape') onclose();
    if (e.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )];
    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    previousFocus = document.activeElement as HTMLElement | null;
    const first = dialog.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    (first ?? dialog).focus();
    return () => previousFocus?.focus();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  role="presentation"
>
  <div bind:this={dialog} class="dialog card" role="dialog" aria-modal="true" aria-label={title} tabindex="-1">
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
