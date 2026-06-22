/**
 * Security/Hygiene Alerting — posts directly to a Discord webhook.
 *
 * Fully fail-safe by design:
 * - If ARCH_ALERT_DISCORD_WEBHOOK is unset → every call is a silent no-op.
 * - All sends are fire-and-forget with a hard timeout; errors are swallowed.
 * - In-memory rate limit: max 1 alert per type per ARCH_ALERT_COOLDOWN_MS
 *   (default 10 minutes) so a sustained attack can never spam the channel.
 *
 * This module must NEVER throw into a request path.
 */

const WEBHOOK_URL = process.env.ARCH_ALERT_DISCORD_WEBHOOK || "";
const COOLDOWN_MS = Number(process.env.ARCH_ALERT_COOLDOWN_MS) > 0
  ? Number(process.env.ARCH_ALERT_COOLDOWN_MS)
  : 10 * 60 * 1000; // 10 min per alert type

const lastSentByType = new Map<string, number>();

export type SecurityAlertType =
  | "auth_fail_burst"
  | "unauthed_billable_hit"
  | "credit_drain_spike"
  | "test";

export interface SecurityAlertPayload {
  type: SecurityAlertType;
  title: string;
  detail: string;
  severity?: "info" | "warning" | "critical";
  fields?: Record<string, string | number>;
}

const SEVERITY_COLOR: Record<string, number> = {
  info: 0x3498db,
  warning: 0xf39c12,
  critical: 0xe74c3c,
};

/**
 * Send a security alert to Discord. Fire-and-forget, rate-limited per type.
 * Returns true if the alert was dispatched (not rate-limited / not disabled).
 */
export function sendSecurityAlert(payload: SecurityAlertPayload): boolean {
  try {
    if (!WEBHOOK_URL) return false;

    const now = Date.now();
    const last = lastSentByType.get(payload.type) ?? 0;
    if (now - last < COOLDOWN_MS) return false;
    lastSentByType.set(payload.type, now);

    const severity = payload.severity ?? "warning";
    const embed = {
      title: `🛡️ ${payload.title}`,
      description: payload.detail.slice(0, 2000),
      color: SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.warning,
      fields: Object.entries(payload.fields ?? {})
        .slice(0, 10)
        .map(([name, value]) => ({
          name: name.slice(0, 100),
          value: String(value).slice(0, 500),
          inline: true,
        })),
      footer: { text: `arch-tools-hygiene • ${payload.type} • ${severity}` },
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    void fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "arch-tools-hygiene", embeds: [embed] }),
      signal: controller.signal,
    })
      .catch(() => { /* swallowed — alerting must never affect requests */ })
      .finally(() => clearTimeout(timer));

    return true;
  } catch {
    return false; // absolute fail-safe
  }
}

export function alertingEnabled(): boolean {
  return !!WEBHOOK_URL;
}
