<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { session } from '../lib/session.svelte';
  import { router } from '../lib/router.svelte';
  import type { User } from '../lib/types';

  type Mode = 'login' | 'sent' | 'setpw';
  let mode = $state<Mode>('login');
  let email = $state('');
  let password = $state('');
  let newPw = $state('');
  let newPw2 = $state('');
  let devLink = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let hint = $state<string | null>(null);
  let verifying = $state(false);
  let passwordsEnabled = $state(false);
  let triedToken = '';

  $effect(() => {
    api<{ passwordsEnabled: boolean }>('/api/auth/config')
      .then((res) => (passwordsEnabled = res.passwordsEnabled))
      .catch(() => undefined);
  });

  $effect(() => {
    const token = router.query.get('token');
    if (token && token !== triedToken && !verifying) {
      triedToken = token;
      verifying = true;
      error = null;
      api<{ token: string; user: User; hasPassword: boolean; passwordsEnabled: boolean }>('/api/auth/verify', { body: { token } })
        .then((res) => {
          session.set(res.token, res.user);
          if (res.passwordsEnabled) {
            mode = 'setpw';
            router.go('/login');
          } else {
            router.go('/kalender');
          }
        })
        .catch((e) => {
          error = e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen';
        })
        .finally(() => {
          verifying = false;
        });
    }
  });

  async function login(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = null;
    hint = null;
    try {
      const res = await api<{ token: string; user: User }>('/api/auth/login', {
        body: { email: email.trim(), password },
      });
      session.set(res.token, res.user);
      router.go('/kalender');
    } catch (err) {
      if (err instanceof ApiError && err.data.needsSetup) {
        hint = String(err.data.error);
      } else {
        error = err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen';
      }
    } finally {
      busy = false;
    }
  }

  async function requestLink(): Promise<void> {
    if (!email.trim()) {
      error = 'Bitte zuerst deine E-Mail-Adresse eintragen.';
      return;
    }
    busy = true;
    error = null;
    hint = null;
    try {
      const res = await api<{ ok: boolean; devLink?: string }>('/api/auth/request-link', { body: { email: email.trim() } });
      devLink = res.devLink ?? null;
      mode = 'sent';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Anfrage fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  async function setPassword(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    if (newPw.length < 8 || newPw.length > 128) {
      error = 'Das Passwort muss 8 bis 128 Zeichen lang sein.';
      return;
    }
    if (newPw !== newPw2) {
      error = 'Die Passwörter stimmen nicht überein.';
      return;
    }
    busy = true;
    try {
      await api('/api/auth/set-password', { body: { password: newPw } });
      router.go('/kalender');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <div class="card login">
    <img class="logo" src="./img/wappen.png" alt="Wappen der Feuerwehr Horst-Eiberg" />
    <h1>MTF-Buchung</h1>
    <p class="muted small">FF Horst-Eiberg · Mannschaftstransportfahrzeug</p>

    {#if verifying}
      <p>Anmeldung läuft…</p>
    {:else if mode === 'setpw'}
      <h2>Passwort festlegen</h2>
      <p class="small">
        Fast geschafft, {session.user?.name}! Lege jetzt ein neues Passwort fest. Andere offene Sitzungen werden dabei beendet.
      </p>
      <form onsubmit={setPassword}>
        <input type="password" bind:value={newPw} placeholder="Neues Passwort (8–128 Zeichen)" required minlength="8" maxlength="128" autocomplete="new-password" />
        <input type="password" bind:value={newPw2} placeholder="Passwort wiederholen" required maxlength="128" autocomplete="new-password" />
        <button class="primary" disabled={busy}>{busy ? 'Speichert…' : 'Passwort speichern & loslegen'}</button>
      </form>
    {:else if mode === 'sent'}
      <div class="note green">
        Wenn deine E-Mail-Adresse freigeschaltet ist, liegt jetzt ein Anmeldelink in deinem Postfach (15 Minuten gültig).
        {#if passwordsEnabled}Nach dem Klick legst du dein Passwort fest.{/if}
      </div>
      {#if devLink}
        <p class="small"><a href={devLink}>Entwicklungsmodus: direkt anmelden →</a></p>
      {/if}
      <button class="ghost" onclick={() => (mode = 'login')}>Zurück zur Anmeldung</button>
    {:else if passwordsEnabled}
      <form onsubmit={login}>
        <input type="email" bind:value={email} placeholder="deine@email.de" required autocomplete="email" />
        <input type="password" bind:value={password} placeholder="Passwort" required maxlength="128" autocomplete="current-password" />
        <button class="primary" disabled={busy}>{busy ? 'Wird geprüft…' : 'Anmelden'}</button>
      </form>
      {#if hint}<div class="note amber">{hint}</div>{/if}
      <div class="alt">
        <button class="ghost" onclick={requestLink} disabled={busy}>
          Erste Anmeldung oder Passwort vergessen? → Anmeldelink anfordern
        </button>
      </div>
      <p class="small muted">Buchen können nur freigeschaltete Mitglieder – frag im Zweifel einen Admin.</p>
    {:else}
      <form onsubmit={(e) => { e.preventDefault(); requestLink(); }}>
        <input type="email" bind:value={email} placeholder="deine@email.de" required autocomplete="email" />
        <button class="primary" disabled={busy}>{busy ? 'Sende…' : 'Anmeldelink anfordern'}</button>
      </form>
      <p class="small muted">Du bekommst einen Anmeldelink per E-Mail. Buchen können nur freigeschaltete Mitglieder – frag im Zweifel einen Admin.</p>
    {/if}

    {#if error}<div class="note red">{error}</div>{/if}
  </div>
  <p class="legal-link small"><a href="#/impressum">Impressum &amp; Datenschutz</a></p>
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .login {
    width: 100%;
    max-width: 380px;
    text-align: center;
    padding: 28px 26px;
  }
  .legal-link { margin-top: 16px; }
  .legal-link a { color: var(--muted); }
  .logo {
    height: 86px;
    width: auto;
    display: block;
    margin: 0 auto 12px;
  }
  h1 { margin-bottom: 2px; }
  h2 { margin-top: 14px; }
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }
  .alt { margin-top: 10px; }
  .alt button { font-size: 13px; }
  .note { margin-top: 10px; text-align: left; }
</style>
