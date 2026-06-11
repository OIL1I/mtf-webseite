<script lang="ts">
  import { API_BASE } from '../lib/api';

  interface MasterUser {
    id: number;
    email: string;
    name: string;
    role: string;
    disabled: number;
    has_password: number;
  }

  let token = $state<string | null>(sessionStorage.getItem('mtf.master'));
  let pw = $state('');
  let users = $state<MasterUser[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);

  let newName = $state('');
  let newEmail = $state('');
  let newRole = $state<'member' | 'manager'>('member');

  async function mfetch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(API_BASE + path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401 && path.startsWith('/api/master/')) {
        token = null;
        sessionStorage.removeItem('mtf.master');
      }
      throw new Error(typeof data.error === 'string' ? data.error : `Fehler ${res.status}`);
    }
    return data as T;
  }

  async function loadUsers(): Promise<void> {
    try {
      users = (await mfetch<{ users: MasterUser[] }>('/api/master/users')).users;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Laden fehlgeschlagen';
    }
  }

  $effect(() => {
    if (token) loadUsers();
  });

  async function login(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const res = await mfetch<{ token: string }>('/api/auth/master-login', { password: pw });
      token = res.token;
      sessionStorage.setItem('mtf.master', res.token);
      pw = '';
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : 'Anmeldung fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  function logout(): void {
    token = null;
    sessionStorage.removeItem('mtf.master');
  }

  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = null;
    note = null;
    try {
      await mfetch('/api/master/users', { name: newName.trim(), email: newEmail.trim(), role: newRole });
      note = `${newName.trim()} wurde angelegt. Die Person meldet sich mit „Anmeldelink anfordern" an und legt dabei ihr Passwort fest.`;
      newName = '';
      newEmail = '';
      newRole = 'member';
      await loadUsers();
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : 'Anlegen fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap" class:centered={!token}>
  {#if !token}
    <div class="card login">
      <h1>🔑 Verwaltungszugang</h1>
      <p class="small muted">
        Mit dem Master-Passwort lassen sich hier ausschließlich Konten <strong>anlegen</strong> –
        keine löschen, keine Buchungen einsehen. Benachrichtigungen erhalten nur echte Admin-Konten.
      </p>
      <form onsubmit={login}>
        <input type="password" bind:value={pw} placeholder="Master-Passwort" required autocomplete="off" />
        <button class="primary" disabled={busy}>{busy ? 'Wird geprüft…' : 'Öffnen'}</button>
      </form>
      {#if error}<div class="note red">{error}</div>{/if}
      <p class="back small"><a href="#/login">← Zur normalen Anmeldung</a></p>
    </div>
  {:else}
    <div class="inner">
      <div class="row head">
        <h1>🔑 Verwaltungszugang</h1>
        <button class="ghost" onclick={logout}>Schließen</button>
      </div>
      <p class="small muted">
        Nur Konten anlegen und Liste einsehen – alles Weitere (Rollen ändern, deaktivieren, Anfragen)
        machen Admins nach dem Login in der Verwaltung.
      </p>

      {#if note}<div class="note green">{note}</div>{/if}
      {#if error}<div class="note red">{error}</div>{/if}

      <form class="card create" onsubmit={create}>
        <h2>Neues Konto anlegen</h2>
        <div class="row">
          <input bind:value={newName} placeholder="Name" required />
          <input type="email" bind:value={newEmail} placeholder="E-Mail-Adresse" required />
          <select bind:value={newRole}>
            <option value="member">Mitglied</option>
            <option value="manager">Admin</option>
          </select>
          <button class="primary" disabled={busy}>Anlegen</button>
        </div>
        <p class="small muted">
          Die Person fordert danach auf der Anmeldeseite einen Anmeldelink an und legt ihr Passwort fest.
        </p>
      </form>

      <div class="card">
        <h2>Vorhandene Konten ({users.length})</h2>
        {#each users as u (u.id)}
          <div class="row line" class:off={u.disabled}>
            <span class="grow">
              <strong class="small">{u.name}</strong>
              <span class="small muted"> · {u.email}</span>
            </span>
            <span class={'badge ' + (u.role === 'manager' ? 'red' : 'gray')}>{u.role === 'manager' ? 'Admin' : 'Mitglied'}</span>
            {#if !u.has_password}<span class="badge amber">noch kein Passwort</span>{/if}
            {#if u.disabled}<span class="badge gray">deaktiviert</span>{/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap { padding: 20px; }
  .wrap.centered {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .login {
    width: 100%;
    max-width: 400px;
    text-align: center;
    padding: 28px 26px;
  }
  .login form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }
  .back { margin-top: 16px; }
  .inner {
    max-width: 760px;
    margin: 0 auto;
  }
  .head { justify-content: space-between; }
  .head h1 { margin: 0; }
  .create { margin: 12px 0; }
  .create input { flex: 1; min-width: 150px; }
  .line {
    border-top: 1px solid var(--border);
    padding: 8px 0;
  }
  .line:first-of-type { border-top: none; }
  .line.off { opacity: 0.55; }
  .grow { flex: 1; min-width: 0; }
  .note { margin: 10px 0; }
</style>
