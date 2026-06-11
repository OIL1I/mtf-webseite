class Router {
  hash = $state(typeof location !== 'undefined' ? location.hash : '');

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.hash = location.hash;
      });
    }
  }

  get path(): string {
    const raw = this.hash.replace(/^#/, '');
    const path = raw.split('?')[0];
    return path && path !== '/' ? path : '/kalender';
  }

  get query(): URLSearchParams {
    const idx = this.hash.indexOf('?');
    return new URLSearchParams(idx >= 0 ? this.hash.slice(idx + 1) : '');
  }

  go(path: string): void {
    location.hash = path;
  }
}

export const router = new Router();
