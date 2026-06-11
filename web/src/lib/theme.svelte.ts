type Mode = 'auto' | 'light' | 'dark';

const KEY = 'mtf.theme';

class Theme {
  mode = $state<Mode>((localStorage.getItem(KEY) as Mode) || 'auto');
  resolved = $state<'light' | 'dark'>('light');

  constructor() {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => this.apply());
    this.apply();
  }

  apply(): void {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.resolved = this.mode === 'auto' ? (dark ? 'dark' : 'light') : this.mode;
    document.documentElement.dataset.theme = this.resolved;
  }

  toggle(): void {
    this.mode = this.resolved === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, this.mode);
    this.apply();
  }
}

export const theme = new Theme();
