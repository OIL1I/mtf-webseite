<script lang="ts">
  let {
    checked = $bindable(),
    label = '',
    disabled = false,
  }: { checked: boolean; label?: string; disabled?: boolean } = $props();
</script>

<button
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => (checked = !checked)}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    width: 38px;
    height: 22px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    padding: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    flex: none;
    transition: background 0.15s ease;
  }
  .toggle.on {
    background: var(--accent);
    border-color: var(--accent);
    justify-content: flex-end;
  }
  .knob {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--surface);
    display: block;
  }
  .toggle.on .knob { background: #fff; }
</style>
