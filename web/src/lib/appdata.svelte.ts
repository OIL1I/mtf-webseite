import { api } from './api';
import type { Meta } from './types';

class AppData {
  meta = $state<Meta | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  async load(force = false): Promise<void> {
    if (this.meta && !force) return;
    this.loading = true;
    this.error = null;
    try {
      this.meta = await api<Meta>('/api/meta');
    } catch (e) {
      // 401 räumt api() bereits ab (→ Login). Andere Fehler hier anzeigbar machen,
      // statt die aufrufenden Seiten mit einer unbehandelten Rejection leer zu lassen.
      this.error = e instanceof Error ? e.message : 'Daten konnten nicht geladen werden';
    } finally {
      this.loading = false;
    }
  }
}

export const appData = new AppData();
