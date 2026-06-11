import { session } from './session.svelte';

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8787').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(status: number, data: Record<string, unknown>) {
    super(typeof data.error === 'string' ? data.error : `Fehler ${status}`);
    this.status = status;
    this.data = data;
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(API_BASE + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && session.loggedIn) session.clear();
    throw new ApiError(res.status, data);
  }
  return data as T;
}
