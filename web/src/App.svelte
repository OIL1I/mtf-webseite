<script lang="ts">
  import { session } from './lib/session.svelte';
  import { router } from './lib/router.svelte';
  import Header from './components/Header.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import MasterPage from './pages/MasterPage.svelte';
  import CalendarPage from './pages/CalendarPage.svelte';
  import MyBookingsPage from './pages/MyBookingsPage.svelte';
  import AdminPage from './pages/AdminPage.svelte';
  import HelpPage from './pages/HelpPage.svelte';
  import './lib/theme.svelte';
</script>

{#if router.path === '/master'}
  <MasterPage />
{:else if !session.loggedIn || router.path === '/login'}
  <LoginPage />
{:else}
  <Header />
  <main>
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
  </main>
{/if}

<style>
  main {
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px clamp(10px, 2vw, 24px) 90px;
  }
</style>
