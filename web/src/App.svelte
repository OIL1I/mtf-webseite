<script lang="ts">
  import { session } from './lib/session.svelte';
  import { router } from './lib/router.svelte';
  import { appData } from './lib/appdata.svelte';
  import Header from './components/Header.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import MasterPage from './pages/MasterPage.svelte';
  import LegalPage from './pages/LegalPage.svelte';
  import CalendarPage from './pages/CalendarPage.svelte';
  import MyBookingsPage from './pages/MyBookingsPage.svelte';
  import AdminPage from './pages/AdminPage.svelte';
  import HelpPage from './pages/HelpPage.svelte';
  import './lib/theme.svelte';
</script>

{#if router.path === '/impressum'}
  <LegalPage />
{:else if router.path === '/master'}
  <MasterPage />
{:else if !session.loggedIn || router.path === '/login'}
  <LoginPage />
{:else}
  <Header />
  <main>
    {#if appData.error}
      <div class="note red load-error">
        Daten konnten nicht geladen werden: {appData.error}
        <button class="ghost" onclick={() => appData.load(true)}>Erneut laden</button>
      </div>
    {/if}
    {#if router.path === '/meine-buchungen'}
      <MyBookingsPage />
    {:else if router.path.startsWith('/verwaltung')}
      {#if session.isManager}
        <AdminPage />
      {:else}
        <div class="card">Dieser Bereich ist nur für Admins sichtbar.</div>
      {/if}
    {:else if router.path === '/hilfe'}
      <HelpPage />
    {:else}
      <CalendarPage />
    {/if}
    <footer class="app-footer small muted">
      <a href="#/impressum">Impressum &amp; Datenschutz</a>
    </footer>
  </main>
{/if}

<style>
  main {
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px clamp(10px, 2vw, 24px) 90px;
  }
  .load-error {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .app-footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    text-align: center;
  }
  .app-footer a { color: var(--muted); }
</style>
