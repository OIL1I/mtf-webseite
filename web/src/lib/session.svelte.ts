import type { User } from './types';

const TOKEN_KEY = 'mtf.token';
const USER_KEY = 'mtf.user';
const CART_KEY = 'mtf.cart';
const BOOKING_CACHE_PREFIX = 'mtf.cache.bookings';
const SESSION_RESET_EVENT = 'mtf:session-reset';

function clearPrivateCaches(): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(BOOKING_CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

function readUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null;
  } catch {
    return null;
  }
}

class Session {
  token = $state<string | null>(localStorage.getItem(TOKEN_KEY));
  user = $state<User | null>(readUser());

  get loggedIn(): boolean {
    return !!this.token && !!this.user;
  }

  get isManager(): boolean {
    return this.user?.role === 'manager';
  }

  set(token: string, user: User): void {
    if (this.user && this.user.id !== user.id) {
      localStorage.removeItem(CART_KEY);
      window.dispatchEvent(new Event(SESSION_RESET_EVENT));
    }
    this.token = token;
    this.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  clear(): void {
    this.token = null;
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(CART_KEY);
    clearPrivateCaches();
    window.dispatchEvent(new Event(SESSION_RESET_EVENT));
  }
}

export const session = new Session();
