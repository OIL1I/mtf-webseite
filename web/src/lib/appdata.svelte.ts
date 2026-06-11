import { api } from './api';
import type { Meta } from './types';

const CACHE_KEY = 'mtf.cache.meta';

class AppData {
  meta = $state<Meta | null>(null);
  loading = $state(false);
  offline = $state(false);

  async load(force = false): Promise<void> {
    if (this.meta && !force) return;
    this.loading = true;
    try {
      this.meta = await api<Meta>('/api/meta');
      this.offline = false;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(this.meta));
      } catch {
        /* Speicher voll – egal */
      }
    } catch (err) {
      // Offline-Cache (Beta-Feature): zuletzt geladene Einstellungen verwenden
      if (!this.meta) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Meta | null;
          if (cached?.features?.offlineCache) {
            this.meta = cached;
            this.offline = true;
          }
        } catch {
          /* kein Cache */
        }
      }
      if (!this.meta) throw err;
    } finally {
      this.loading = false;
    }
  }
}

export const appData = new AppData();
