import type { User } from '@mtf/shared';

export * from '@mtf/shared';

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

export interface Vars {
  user: User;
}
