import type { Env } from './types';
import { escapeHtml } from './html';

export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[E-Mail übersprungen, kein RESEND_API_KEY] an=${to} betreff=${subject}`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) console.error('Resend-Fehler', res.status, await res.text());
  return res.ok;
}

export function emailLayout(title: string, bodyHtml: string, footerNote?: string): string {
  const safeTitle = escapeHtml(title);
  const footer = footerNote ? `<div style="margin-bottom:8px;">${footerNote}</div>` : '';
  return `<!doctype html><html lang="de"><body style="margin:0;padding:24px;background:#f4f3f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e4e2dc;">
    <div style="font-size:14px;font-weight:600;color:#a32d2d;margin-bottom:14px;">&#128658; MTF-Buchung · FF Horst-Eiberg</div>
    <h1 style="font-size:19px;margin:0 0 12px;color:#1a1a1a;">${safeTitle}</h1>
    <div style="font-size:15px;line-height:1.6;color:#333;">${bodyHtml}</div>
    <div style="font-size:12px;color:#999;margin-top:22px;border-top:1px solid #eee;padding-top:12px;">
      ${footer}Diese Nachricht wurde automatisch vom MTF-Buchungssystem verschickt.
    </div>
  </div></body></html>`;
}
