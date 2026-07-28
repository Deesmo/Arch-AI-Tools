/**
 * x402 v2 seller-side helpers.
 *
 * Spec (read 2026-07-28, DOC-FIRST):
 *  - coinbase/x402 specs/x402-specification-v2.md §5.1 PaymentRequired
 *    ({ x402Version: 2, error?, resource{url,description?,mimeType?}, accepts[], extensions? };
 *    accepts entries = { scheme, network (CAIP-2), amount, asset, payTo, maxTimeoutSeconds, extra? })
 *  - coinbase/x402 specs/x402-specification-v2.md §5.2 PaymentPayload
 *    ({ x402Version: 2, resource?, accepted, payload, extensions? })
 *  - coinbase/x402 specs/transports-v2/http.md (PAYMENT-REQUIRED / PAYMENT-SIGNATURE /
 *    PAYMENT-RESPONSE base64 headers; "Response bodies are a server implementation concern")
 *
 * Pure functions only — no imports beyond x402V1, no side effects (unit-tested from dist,
 * same pattern as lib/x402V1.ts).
 */

import { V1_TO_CAIP2 } from "./x402V1.js";

/** Canonical Solana mainnet CAIP-2 reference (genesis hash form — spec §11.1; the
 * "solana:mainnet" alias is non-canonical and only warn-passes ecosystem validators). */
export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/** Canonical Solana devnet CAIP-2 reference (spec §11.1). */
export const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/**
 * Normalize a network identifier to CAIP-2.
 *  - v1 named networks (base, polygon, …) map through V1_TO_CAIP2 (proven-with-CDP set only)
 *  - Solana aliases canonicalize to the genesis-hash form
 *  - identifiers already containing ":" pass through unchanged (already CAIP-2 style)
 * Returns null when no mapping exists (caller must drop/skip — never guess a chain id).
 */
export function toCaip2(network: unknown): string | null {
  if (typeof network !== "string" || network.length === 0) return null;
  if (network === "solana" || network === "solana:mainnet") return SOLANA_MAINNET_CAIP2;
  if (network === "solana-devnet" || network === "solana:devnet") return SOLANA_DEVNET_CAIP2;
  if (network.includes(":")) return network;
  return V1_TO_CAIP2[network] ?? null;
}

/** True when two network identifiers name the same chain (exact or via CAIP-2 normalization). */
export function networksEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string" && a === b) return true;
  const ca = toCaip2(a);
  const cb = toCaip2(b);
  return ca !== null && ca === cb;
}

/**
 * x402 v2 PaymentRequirements (spec §5.1.2) from an internal v1-shaped accepts entry.
 * Emits EXACTLY the spec fields — CAIP-2 network, `amount` (v1 maxAmountRequired dropped),
 * no per-entry resource/description/mimeType/outputSchema (v2 moved those to the top-level
 * resource object / extensions.bazaar). Returns null when the network can't be normalized.
 */
export function toV2Accept(r: any): object | null {
  const network = toCaip2(r?.network);
  if (!network) return null;
  const amount = r.amount ?? r.maxAmountRequired;
  if (typeof amount !== "string" || amount.length === 0) return null;
  return {
    scheme: r.scheme,
    network,
    amount,
    asset: r.asset,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds ?? 60,
    ...(r.extra !== undefined ? { extra: r.extra } : {}),
  };
}

/**
 * Full spec §5.1 PaymentRequired from our internal v1-shaped 402 body
 * (buildPaymentRequired output: top-level resource object + v1 accepts entries +
 * optional bazaar `description`/`extensions` merged in).
 * Accepts entries that can't be normalized to CAIP-2 are dropped rather than guessed.
 */
export function toV2PaymentRequired(v1Body: any): object {
  const accepts = (Array.isArray(v1Body?.accepts) ? v1Body.accepts : [])
    .map(toV2Accept)
    .filter((a: object | null): a is object => a !== null);

  const url = v1Body?.resource?.url ?? (typeof v1Body?.resource === "string" ? v1Body.resource : "");
  // Prefer the richer Bazaar description (≤500 chars) merged at the body top level;
  // fall back to the short per-resource description.
  const description = v1Body?.description ?? v1Body?.resource?.description;
  const mimeType = v1Body?.resource?.mimeType ?? "application/json";

  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url,
      ...(description !== undefined ? { description } : {}),
      ...(mimeType !== undefined ? { mimeType } : {}),
    },
    accepts,
    ...(v1Body?.extensions !== undefined ? { extensions: v1Body.extensions } : {}),
  };
}

/** Protocol version claimed by a decoded payment payload (1, 2, or null when neither). */
export function paymentPayloadVersion(p: any): 1 | 2 | null {
  const v = Number(p?.x402Version);
  return v === 1 ? 1 : v === 2 ? 2 : null;
}

/**
 * Build the facilitator /verify + /settle arguments for a payment processed as x402 v2:
 * native v2 payloads (PAYMENT-SIGNATURE clients) and Solana payments (CDP requires the
 * v2 shape for Solana regardless of the client's claimed version).
 *
 * Server-authoritative by construction — exact parity with the proven v1→v2
 * translated path (lib/x402V1.ts toV2Payload):
 *  - `accepted`/paymentRequirements are rebuilt from OUR matched requirements entry
 *    (CAIP-2 network + `amount`), never trusted from the client
 *  - `resource` is ALWAYS derived from the matched requirements entry; the client
 *    echo is ignored. Spec basis: payload `resource` is Optional (v2 spec §5.2.2) and
 *    the facilitator catalogs discovery info under the payload's resource URL
 *    (specs/extensions/bazaar.md "Extract the discovery information (resource URL,
 *    ...)"), so forwarding a client-echoed resource would let a payer for tool A
 *    submit our server bazaar block under an arbitrary attacker-chosen URL
 *  - `extensions` forwarded to the facilitator are the SERVER'S ONLY (the bazaar
 *    block) — client-echoed extension keys are dropped, exactly like toV2Payload,
 *    so nothing client-controlled rides to CDP under our JWT
 *
 * Returns null when the client payload has no inner `payload` object or the matched
 * requirements can't be expressed in v2 (caller must fail closed).
 */
export function toV2FacilitatorArgs(
  clientPayload: any,
  reqs: any,
  serverExtensions?: object | null,
): { paymentPayload: object; paymentRequirements: object } | null {
  if (!clientPayload?.payload || typeof clientPayload.payload !== "object") return null;
  const paymentRequirements = toV2Accept(reqs);
  if (!paymentRequirements) return null;

  // Whitelist: forward only the server's own extension blocks (never client echoes).
  const extensions =
    serverExtensions && typeof serverExtensions === "object" && Object.keys(serverExtensions).length > 0
      ? serverExtensions
      : undefined;

  // Server-derived resource only (client echo intentionally ignored — see docstring).
  const resource =
    typeof reqs?.resource === "string" && reqs.resource.length > 0
      ? { url: reqs.resource, description: reqs.description, mimeType: reqs.mimeType }
      : undefined;

  return {
    paymentPayload: {
      x402Version: 2,
      ...(resource !== undefined ? { resource } : {}),
      accepted: paymentRequirements,
      payload: clientPayload.payload,
      ...(extensions !== undefined ? { extensions } : {}),
    },
    paymentRequirements,
  };
}
