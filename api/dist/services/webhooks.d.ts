/**
 * Webhook Delivery Service
 *
 * Fires events to registered webhook URLs with HMAC-SHA256 signatures.
 * Retries up to 3 times with exponential backoff on failure.
 */
export declare const WEBHOOK_EVENTS: readonly ["payment.received", "credits.low", "credits.depleted", "agent.registered", "tool.error"];
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export interface WebhookPayload {
    id: string;
    event: WebhookEvent;
    timestamp: string;
    data: Record<string, unknown>;
}
export declare function signPayload(payload: string, secret: string): string;
export declare function fireWebhookEvent(event: WebhookEvent, agentId: string, data: Record<string, unknown>): Promise<void>;
export declare function fireGlobalWebhookEvent(event: WebhookEvent, data: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=webhooks.d.ts.map