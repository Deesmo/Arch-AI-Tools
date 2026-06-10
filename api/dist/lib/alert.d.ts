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
export type SecurityAlertType = "auth_fail_burst" | "unauthed_billable_hit" | "credit_drain_spike" | "test";
export interface SecurityAlertPayload {
    type: SecurityAlertType;
    title: string;
    detail: string;
    severity?: "info" | "warning" | "critical";
    fields?: Record<string, string | number>;
}
/**
 * Send a security alert to Discord. Fire-and-forget, rate-limited per type.
 * Returns true if the alert was dispatched (not rate-limited / not disabled).
 */
export declare function sendSecurityAlert(payload: SecurityAlertPayload): boolean;
export declare function alertingEnabled(): boolean;
//# sourceMappingURL=alert.d.ts.map