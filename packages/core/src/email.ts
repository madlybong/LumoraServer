import nodemailer from "nodemailer";
import type { SQL } from "bun";

export interface SmtpStaticConfig {
  source: "static";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export interface SmtpDbConfig {
  source: "db";
  table: string;   // e.g. "app_settings"
  keyColumn: string;   // column containing the setting name, default "key"
  valueColumn: string; // column containing the setting value, default "value"
}

export type LumoraEmailConfig = SmtpStaticConfig | SmtpDbConfig;

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface LumoraEmailService {
  send(options: SendMailOptions): Promise<void>;
  test(): Promise<{ ok: boolean; error?: string }>;
}

async function resolveSmtpConfig(
  cfg: LumoraEmailConfig,
  sql?: SQL
): Promise<SmtpStaticConfig> {
  if (cfg.source === "static") return cfg;

  if (!sql) throw new Error("DB-backed SMTP config requires a database connection.");

  const keyCol = cfg.keyColumn ?? "key";
  const valCol = cfg.valueColumn ?? "value";
  const rows = await sql.unsafe<{ key: string; value: string }[]>(
    `SELECT \`${keyCol}\` as key, \`${valCol}\` as value FROM \`${cfg.table}\`
     WHERE \`${keyCol}\` IN ('smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from_name','smtp_from_email')`
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    source: "static",
    host: m.smtp_host ?? "",
    port: Number(m.smtp_port ?? 587),
    secure: m.smtp_secure === "true",
    user: m.smtp_user ?? "",
    pass: m.smtp_pass ?? "",
    fromName: m.smtp_from_name ?? "",
    fromEmail: m.smtp_from_email ?? "",
  };
}

export function createEmailService(
  cfg: LumoraEmailConfig,
  sql?: SQL
): LumoraEmailService {
  return {
    async send(options) {
      const resolved = await resolveSmtpConfig(cfg, sql);
      const transporter = nodemailer.createTransport({
        host: resolved.host,
        port: resolved.port,
        secure: resolved.secure,
        auth: { user: resolved.user, pass: resolved.pass },
      });
      await transporter.sendMail({
        from: `"${resolved.fromName}" <${resolved.fromEmail}>`,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    },
    async test() {
      try {
        const resolved = await resolveSmtpConfig(cfg, sql);
        const transporter = nodemailer.createTransport({
          host: resolved.host,
          port: resolved.port,
          secure: resolved.secure,
          auth: { user: resolved.user, pass: resolved.pass },
        });
        await transporter.verify();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
