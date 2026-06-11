export interface Env {
  DB: D1Database;
  SITE_ORIGIN: string;
  SITE_URL: string;
  MAIL_FROM: string;
  TELEGRAM_BOT_USERNAME: string;
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  DEV_MODE?: string;
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  VAPID_PRIVATE_JWK?: string;
  MASTER_PASSWORD?: string;
}

export type Role = 'member' | 'manager';

/** Deutsche Führerscheinklassen (PKW/LKW/Bus), wie auf der Karte aufgedruckt */
export const LICENSE_CLASSES = ['B', 'B96', 'BE', 'C1', 'C1E', 'C', 'CE', 'D1', 'D1E', 'D', 'DE'] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];
export type BookingStatus = 'confirmed' | 'pending' | 'rejected' | 'cancelled';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  disabled: number;
}

export interface DayHours {
  enabled: boolean;
  open: string;
  close: string;
}

export interface Rules {
  weeklyHours: DayHours[];
  maxDurationHours: number;
  minLeadHours: number;
  maxLeadDays: number;
  cancelDeadlineHours: number;
  bufferMinutes: number;
  reviewDurationEnabled: boolean;
  reviewDurationOverHours: number;
  reviewShortNoticeEnabled: boolean;
  reviewShortNoticeUnderHours: number;
  reviewSeries: boolean;
  reviewAll: boolean;
}

export interface Features {
  reminders: boolean;
  reminderLeadHours: number;
  tripLog: boolean;
  waitlist: boolean;
  vehicles: boolean;
  stats: boolean;
  dragSelect: boolean;
  ics: boolean;
  comments: boolean;
  rateLimit: boolean;
  auditLog: boolean;
  csvExport: boolean;
  offlineCache: boolean;
}

export interface Vehicle {
  id: number;
  name: string;
  active: number;
  available_from: string | null;
  available_to: string | null;
  note: string | null;
  required_class: string | null;
}

export interface Blackout {
  id: number;
  title: string;
  kind: 'weekly' | 'once';
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  start_ts: string | null;
  end_ts: string | null;
}

export interface BookingRow {
  id: number;
  group_id: number;
  user_id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts: string;
  status: BookingStatus;
  series_key: string | null;
}

export interface CheckoutItem {
  start: string;
  end: string;
  seriesKey?: string | null;
}

export interface CheckoutRequest {
  purpose: string;
  driverId: number;
  vehicleId?: number;
  items: CheckoutItem[];
}

export interface Vars {
  user: User;
}
