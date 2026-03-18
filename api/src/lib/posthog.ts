/**
 * PostHog server-side analytics client
 * Events: signup, trial_activated, login, api_call, x402_payment
 */
import { PostHog } from "posthog-node";
import { logger } from "./logger.js";

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? "";
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

let client: PostHog | null = null;

if (POSTHOG_API_KEY) {
  client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST, flushAt: 10, flushInterval: 5000 });
  logger.info("PostHog analytics initialized");
} else {
  logger.warn("POSTHOG_API_KEY not set — analytics disabled");
}

export function captureEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties });
  } catch (e) {
    logger.error({ error: e }, "PostHog capture failed");
  }
}

export function identifyUser(distinctId: string, properties?: Record<string, unknown>): void {
  if (!client) return;
  try {
    client.identify({ distinctId, properties });
  } catch (e) {
    logger.error({ error: e }, "PostHog identify failed");
  }
}

export async function shutdownPostHog(): Promise<void> {
  if (client) await client.shutdown();
}
