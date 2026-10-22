import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  defaultTo?: string;
};

export function getMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.AUTH_ADMIN_EMAIL?.trim() ||
    "";
  if (!host || !from) return null;

  const port = Number(process.env.SMTP_PORT || "587");
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS?.trim() || undefined,
    from,
    defaultTo:
      process.env.REPORT_DEFAULT_TO?.trim() ||
      process.env.AUTH_ADMIN_EMAIL?.trim() ||
      undefined,
  };
}

export function isMailConfigured(): boolean {
  return getMailConfig() != null;
}

let cached: Transporter | null = null;

export function getMailTransport(): Transporter {
  const cfg = getMailConfig();
  if (!cfg) {
    throw new Error(
      "Email non configurata: imposta SMTP_HOST e SMTP_FROM nel .env",
    );
  }
  if (!cached) {
    cached = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user
        ? { user: cfg.user, pass: cfg.pass ?? "" }
        : undefined,
    });
  }
  return cached;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<{ messageId: string }> {
  const cfg = getMailConfig();
  if (!cfg) {
    throw new Error(
      "Email non configurata: imposta SMTP_HOST e SMTP_FROM nel .env",
    );
  }
  const transport = getMailTransport();
  const info = await transport.sendMail({
    from: cfg.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    replyTo: opts.replyTo,
  });
  return { messageId: String(info.messageId ?? "") };
}
