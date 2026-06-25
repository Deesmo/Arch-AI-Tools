/**
 * Webhook Delivery Service
 *
 * Fires events to registered webhook URLs with HMAC-SHA256 signatures.
 * Retries up to 3 times with exponential backoff on failure.
 */

import { createHmac, randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { safeFetch } from "../lib/ssrf.js";

// ─── Event types ────────────────────────────────────────────────────────────
export const WEBHOOK_EVENTS = [
  "payment.received",
  "credits.low",
  "credits.depleted",
  "agent.registered",
  "tool.error",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// ─── Payload shape ──────────────────────────────────────────────────────────
export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Signature generation ───────────────────────────────────────────────────
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ─── Deliver a single webhook ───────────────────────────────────────────────
async function deliverWebhook(
  webhookId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  deliveryId: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      // safeFetch re-validates the URL (and every redirect hop) at delivery time,
      // closing the DNS-rebinding gap between registration-time validation and the
      // actual outbound request.
      const response = await safeFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Id": payload.id,
          "X-Webhook-Event": payload.event,
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Timestamp": payload.timestamp,
          "User-Agent": "ArchTools-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Update delivery record
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: response.ok ? "delivered" : "failed",
          httpStatus: response.status,
          attempts: attempt,
          lastError: response.ok ? null : `HTTP ${response.status}`,
          deliveredAt: response.ok ? new Date() : null,
        },
      });

      if (response.ok) {
        console.log(`[webhooks] Delivered ${payload.event} to ${url} (attempt ${attempt})`);
        return;
      }

      // Non-retryable status codes
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        console.warn(`[webhooks] Non-retryable ${response.status} from ${url} for ${payload.event}`);
        return;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "failed",
          attempts: attempt,
          lastError: errMsg,
        },
      }).catch(() => {});

      console.warn(`[webhooks] Attempt ${attempt}/${maxAttempts} failed for ${url}: ${errMsg}`);
    }

    // Exponential backoff: 1s, 4s, 9s
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * attempt * 1000));
    }
  }

  console.error(`[webhooks] All ${maxAttempts} attempts failed for ${payload.event} → ${url}`);
}

// ─── Fire an event to all subscribers ────────────────────────────────────────
export async function fireWebhookEvent(
  event: WebhookEvent,
  agentId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    // Find all active webhooks for this agent subscribed to this event
    const webhooks = await prisma.webhook.findMany({
      where: {
        agentId,
        active: true,
        events: { has: event },
      },
    });

    if (webhooks.length === 0) return;

    const payload: WebhookPayload = {
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      event,
      timestamp: new Date().toISOString(),
      data: {
        agent_id: agentId,
        ...data,
      },
    };

    // Deliver to all webhooks concurrently (non-blocking)
    for (const wh of webhooks) {
      // Create delivery record first
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: wh.id,
          event,
          payload: payload as any,
          status: "pending",
          attempts: 0,
        },
      });

      // Fire and forget — don't block the main request
      deliverWebhook(wh.id, wh.url, wh.secret, payload, delivery.id).catch((err) => {
        console.error(`[webhooks] Delivery error for ${wh.id}:`, err);
      });
    }

    console.log(`[webhooks] Fired ${event} for agent ${agentId} → ${webhooks.length} subscriber(s)`);
  } catch (err) {
    // Webhook delivery should never crash the main app
    console.error("[webhooks] fireWebhookEvent error:", err);
  }
}

// ─── Convenience: fire event for ALL webhooks matching event (no agent filter) ─
// Used for global events like tool.error where agent context might be optional
export async function fireGlobalWebhookEvent(
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  if (!data.agent_id || typeof data.agent_id !== "string") return;
  await fireWebhookEvent(event, data.agent_id as string, data);
}
