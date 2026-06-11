import type { User } from './types';

const TOKEN_KEY = 'mtf.token';
const USER_KEY = 'mtf.user';

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
  }
}

export const session = new Session();
