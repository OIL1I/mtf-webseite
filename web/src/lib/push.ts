import { api } from './api';

export type PushState = 'unsupported' | 'denied' | 'inactive' | 'active';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js');
  } catch (err) {
    console.error('Service-Worker-Registrierung fehlgeschlagen', err);
    return null;
  }
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'inactive';
  try {
    const res = await api<{ subscribed: boolean }>('/api/push/check', { body: { endpoint: sub.endpoint } });
    return res.subscribed ? 'active' : 'inactive';
  } catch {
    return 'inactive';
  }
}

function vapidKeyToBytes(key: string): Uint8Array {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function enablePush(vapidPublicKey: string): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.getRegistration());
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'inactive';
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToBytes(vapidPublicKey).buffer as ArrayBuffer,
    }));
  await api('/api/push/subscribe', { body: sub.toJSON() });
  return 'active';
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
}
