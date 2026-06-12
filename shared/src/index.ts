export type Role = 'member' | 'manager';

export const LICENSE_CLASSES = ['B', 'B96', 'BE', 'C1', 'C1E', 'C', 'CE', 'D1', 'D1E', 'D', 'DE'] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];
export type BookingStatus = 'confirmed' | 'pending' | 'rejected' | 'cancelled';
export type WaitlistStatus = 'waiting' | 'offered' | 'claimed' | 'expired';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  disabled?: number;
}

export interface DriverOption {
  id: number;
  name: string;
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
  memberTelegram: boolean;
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

export interface Meta {
  rules: Rules;
  blackouts: Blackout[];
  features: Features;
  vehicles: Vehicle[];
  vapidPublicKey: string | null;
  botUsername: string | null;
}

export interface Booking {
  id: number;
  groupId: number;
  vehicleId: number;
  vehicleName: string;
  start: string;
  end: string;
  status: BookingStatus;
  seriesKey: string | null;
  purpose: string;
  userName: string;
  mine: boolean;
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

export interface SeriesUpdateRequest {
  groupId: number;
  seriesKey: string;
  items: CheckoutItem[];
}

export interface TripLog {
  kmStart: number | null;
  kmEnd: number | null;
  note: string | null;
}

export interface MyBookingItem {
  id: number;
  start: string;
  end: string;
  status: BookingStatus;
  seriesKey: string | null;
  vehicleName: string;
  cancellable: boolean;
  started: boolean;
  tripLog: TripLog | null;
}

export interface WaitlistEntry {
  id: number;
  start_ts: string;
  end_ts: string;
  vehicle_name: string;
  status: WaitlistStatus;
  offered_until: string | null;
}

export interface Comment {
  id: number;
  text: string;
  created_at: string;
  name: string;
  role: Role;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  detail: string;
  created_at: string;
}

export interface Stats {
  months: { month: string; count: number; hours: number }[];
  topUsers: { name: string; count: number; hours: number }[];
  weekdays: { weekday: number; hours: number }[];
}

export interface MyGroup {
  id: number;
  purpose: string;
  driver: string;
  createdAt: string;
  items: MyBookingItem[];
}

export interface CheckoutProblem {
  index: number;
  start: string;
  end: string;
  reason: string;
}

export interface AdminGroup {
  id: number;
  purpose: string;
  driver: string;
  created_at: string;
  owner: { id: number; email: string; name: string };
  items: {
    id: number;
    vehicle_id: number;
    start_ts: string;
    end_ts: string;
    status: BookingStatus;
    series_key: string | null;
  }[];
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  disabled: number;
  created_at: string;
  telegram_linked: number;
  has_password: number;
  license_classes: string;
}

export interface AdminStatus {
  telegram: { configured: boolean; linkedManagers: number; botUsername: string | null };
  webPush: { configured: boolean; subscriptions: number };
  email: { configured: boolean };
}
