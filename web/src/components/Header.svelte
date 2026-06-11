<script lang="ts">
  import { session } from '../lib/session.svelte';
  import { router } from '../lib/router.svelte';
  import { theme } from '../lib/theme.svelte';
  import { api } from '../lib/api';

  const links = $derived([
    { path: '/kalender', label: 'Kalender' },
    { path: '/meine-buchungen', label: 'Meine Buchungen' },
    { path: '/hilfe', label: 'Hilfe' },
    ...(session.isManager ? [{ path: '/verwaltung', label: 'Verwaltung' }] : []),
  ]);

  async function logout(): Promise<void> {
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
    session.clear();
    router.go('/login');
  }
</script>

<header>
  <div class="inner">
    <a class="brand" href="#/kalender">
      <img class="logo" src="./img/wappen.png" alt="Wappen der Feuerwehr Horst-Eiberg" />
      <span class="brand-text">
        <strong>MTF-Buchung</strong>
        <small>FF Horst-Eiberg</small>
      </span>
    </a>
    <nav>
      {#each links as link (link.path)}
        <a href={'#' + link.path} class:active={router.path.startsWith(link.path)}>{link.label}</a>
      {/each}
    </nav>
    <div class="actions">
      <button class="ghost icon" onclick={() => theme.toggle()} title="Hell/Dunkel umschalten" aria-label="Hell/Dunkel umschalten">
        {#if theme.resolved === 'dark'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" /></svg>
        {/if}
      </button>
      <span class="user" title={session.user?.email}>{session.user?.name}</span>
      <button class="ghost" onclick={logout}>Abmelden</button>
    </div>
  </div>
</header>

<style>
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 40;
  }
  .inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 8px clamp(10px, 2vw, 24px);
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: inherit;
  }
  .logo {
    height: 38px;
    width: auto;
    display: block;
  }
  .brand-text { display: flex; flex-direction: column; line-height: 1.15; }
  .brand-text strong { font-size: 14px; }
  .brand-text small { font-size: 11px; color: var(--muted); }
  nav {
    display: flex;
    gap: 2px;
    overflow-x: auto;
  }
  nav a {
    padding: 6px 11px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--muted);
    font-size: 14px;
    white-space: nowrap;
  }
  nav a:hover { background: var(--surface-2); color: var(--text); }
  nav a.active {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    font-weight: 600;
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .icon { padding: 6px; }
  .icon svg { width: 18px; height: 18px; display: block; }
  .user { font-size: 13px; color: var(--muted); }
  @media (max-width: 720px) {
    .user { display: none; }
    .brand-text small { display: none; }
  }
</style>
