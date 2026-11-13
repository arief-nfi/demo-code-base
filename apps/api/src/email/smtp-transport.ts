import * as nodemailer from 'nodemailer';
import type { EmailEnv } from './email-env';

export interface EmailEnvelope {
  /** An object, never a formatted string: nodemailer encodes the name, so it can't inject headers */
  from: { name: string; address: string };
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailEnvelope): Promise<{ messageId?: string }>;
}

/** Holds the transport, or null when SMTP isn't configured (messages are then SKIPPED). */
export interface EmailTransportRef {
  current: EmailTransport | null;
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

export function createSmtpTransport(env: EmailEnv): EmailTransport | null {
  if (!env.smtpHost || !env.mailFrom) return null;

  const port = env.smtpPort ?? 587;
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port,
    secure: port === 465,
    ...(env.smtpUser ? { auth: { user: env.smtpUser, pass: env.smtpPass ?? '' } } : {}),
  });

  return {
    async send(message) {
      const info = await transporter.sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { messageId: info.messageId };
    },
  };
}
