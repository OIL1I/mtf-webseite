<script lang="ts">
  import { api } from '../../lib/api';
  import { session } from '../../lib/session.svelte';
  import { LICENSE_CLASSES, type AdminUser } from '../../lib/types';

  let users = $state<AdminUser[]>([]);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);

  let newName = $state('');
  let newEmail = $state('');
  let newRole = $state<'member' | 'manager'>('member');

  async function load(): Promise<void> {
    try {
      const res = await api<{ users: AdminUser[] }>('/api/admin/users');
      users = res.users;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Laden fehlgeschlagen';
    }
  }

  $effect(() => {
    load();
  });

  async function invite(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    note = null;
    try {
      await api('/api/admin/users', { body: { name: newName.trim(), email: newEmail.trim(), role: newRole } });
      note = `${newName.trim()} wurde eingeladen und kann sich jetzt anmelden.`;
      newName = '';
      newEmail = '';
      newRole = 'member';
      await load();
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : 'Einladen fehlgeschlagen';
    }
  }

  async function patch(user: AdminUser, body: Record<string, unknown>): Promise<void> {
    error = null;
    note = null;
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body });
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Änderung fehlgeschlagen';
      await load();
    }
  }

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  // Führerscheinklassen-Pflege
  let licenseOpenFor = $state<number | null>(null);

  function classesOf(user: AdminUser): string[] {
    try {
      return JSON.parse(user.license_classes || '[]') as string[];
    } catch {
      return [];
    }
  }

  async function toggleClass(user: AdminUser, cl: string): Promise<void> {
    const current = classesOf(user);
    const next = current.includes(cl) ? current.filter((c) => c !== cl) : [...current, cl];
    await patch(user, { licenseClasses: next });
  }
</script>

{#if note}<div class="note green">{note}</div>{/if}
{#if error}<div class="note red">{error}</div>{/if}

<div class="card">
  <h2>👥 Nutzer &amp; Rollen</h2>
  {#each users as user (user.id)}
    <div class="row line" class:disabled-user={user.disabled}>
      <span class="avatar" aria-hidden="true">{initials(user.name)}</span>
      <div class="grow">
        <strong class="small">{user.name}{user.id === session.user?.id ? ' (du)' : ''}</strong>
        <div class="small muted">{user.email}</div>
      </div>
      <button
        class="ghost license-btn"
        onclick={() => (licenseOpenFor = licenseOpenFor === user.id ? null : user.id)}
        title="Führerscheinklassen pflegen"
      >
        🪪 {classesOf(user).length > 0 ? classesOf(user).join(', ') : 'keine Klassen'}
      </button>
      {#if user.role === 'manager' && user.telegram_linked}
        <span class="badge green" title="Telegram verknüpft">✈ verknüpft</span>
      {/if}
      {#if !user.has_password}
        <span class="badge amber" title="Hat sich noch nicht angemeldet bzw. kein Passwort festgelegt">ohne Passwort</span>
      {/if}
      <select
        value={user.role}
        onchange={(e) => patch(user, { role: (e.currentTarget as HTMLSelectElement).value })}
        aria-label={`Rolle von ${user.name}`}
      >
        <option value="member">Mitglied</option>
        <option value="manager">Admin</option>
      </select>
      <button
        class={user.disabled ? '' : 'ghost'}
        onclick={() => patch(user, { disabled: !user.disabled })}
        title={user.disabled ? 'Wieder aktivieren' : 'Deaktivieren – kann sich nicht mehr anmelden'}
      >
        {user.disabled ? 'Aktivieren' : 'Deaktivieren'}
      </button>
    </div>
    {#if licenseOpenFor === user.id}
      <div class="license-edit">
        <span class="small muted">Führerscheinklassen von {user.name} (alle Klassen ankreuzen, die auf der Karte stehen):</span>
        <div class="chips">
          {#each LICENSE_CLASSES as cl (cl)}
            <button class="chip" class:on={classesOf(user).includes(cl)} onclick={() => toggleClass(user, cl)}>{cl}</button>
          {/each}
        </div>
      </div>
    {/if}
  {/each}
</div>

<form class="card invite" onsubmit={invite}>
  <h2>✉ Nutzer einladen</h2>
  <p class="small muted">Nur eingetragene Adressen können sich anmelden (geschlossene Liste). Die Person bekommt eine Einladungs-Mail.</p>
  <div class="row">
    <input bind:value={newName} placeholder="Name" required />
    <input type="email" bind:value={newEmail} placeholder="E-Mail-Adresse" required />
    <select bind:value={newRole}>
      <option value="member">Mitglied</option>
      <option value="manager">Admin</option>
    </select>
    <button class="primary">Einladen</button>
  </div>
</form>

<style>
  .line {
    border-top: 1px solid var(--border);
    padding: 8px 0;
  }
  .line:first-of-type { border-top: none; }
  .disabled-user { opacity: 0.5; }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex: none;
  }
  .grow { flex: 1; min-width: 0; }
  select { padding: 5px 8px; font-size: 13px; }
  .invite { margin-top: 14px; }
  .invite input { flex: 1; min-width: 160px; }
  .note { margin-bottom: 10px; }
  .license-btn { font-size: 12px; white-space: nowrap; }
  .license-edit {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .chip {
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 600;
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
</style>
