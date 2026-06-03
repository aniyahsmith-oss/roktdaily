/**
 * Email delivery via Resend (preferred) or Nodemailer (SMTP fallback).
 *
 * Set RESEND_API_KEY to use Resend.
 * Set SMTP_HOST + SMTP_USER + SMTP_PASS to use SMTP.
 */
import nodemailer from 'nodemailer';
import { format } from 'date-fns';
import { log } from '../utils/logger.js';

async function sendViaResend(to, from, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendViaSMTP(to, from, subject, html) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter.sendMail({ from, to, subject, html });
}

export async function sendBriefingEmail(exec, date, html) {
  const to = exec.preferences.briefingEmail ?? process.env.BRIEFING_EMAIL_TO ?? exec.email;
  const from = process.env.BRIEFING_EMAIL_FROM ?? 'rokt-daily@rokt.com';
  const dayStr = format(new Date(date), 'EEE MMM d');
  const subject = `Rokt Daily — ${dayStr}`;

  log.info(`Sending email to ${to}…`);

  if (process.env.RESEND_API_KEY) {
    await sendViaResend(to, from, subject, html);
  } else if (process.env.SMTP_HOST) {
    await sendViaSMTP(to, from, subject, html);
  } else {
    throw new Error('No email provider configured. Set RESEND_API_KEY or SMTP_HOST.');
  }

  log.success(`Email delivered to ${to}`);
}
