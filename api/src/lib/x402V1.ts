/**
 * x402 V1 facilitator pass-through helpers.
 *
 * Spec: coinbase/x402 specs/x402-specification-v1.md §7.1 — POST /verify (and /settle,
 * same shape) take the client's V1 PaymentPayload UNCHANGED next to canonical V1
 * PaymentRequirements. CDP's validator is a strict union; it rejected our previous
 * v2 re-wrap of V1 payloads with 400 "x402V1PaymentPayload requires 'scheme'"
 * (proven live 2026-07-27, correlationId a21ba425dc9c5ed7-IAD).
 *
 * Pure functions only — no imports, no side effects (unit-tested directly from dist).
 */

/**
 * Canonical x402 V1 PaymentRequirements — exactly the §7.1 fields, nothing else.
 * Our accepts[] entries carry a duplicate `amount` alongside `maxAmountRequired`
 * plus `outputSchema`; extra keys can fail the facilitator's strict-union match
 * (council review 2026-07-27: outputSchema must be stripped).
 */
export function toV1Requirements(r: any): object {
  return {
    scheme: r.scheme,
    network: r.network,
    maxAmountRequired: r.maxAmountRequired ?? r.amount,
    resource: r.resource,
    description: r.description,
    mimeType: r.mimeType,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds ?? 60,
    asset: r.asset,
    ...(r.extra !== undefined ? { extra: r.extra } : {}),
  };
}

/**
 * Validate + sanitize a V1 client payment payload for facilitator pass-through.
 * Returns a clean `{x402Version, scheme, network, payload}` (the V1 spec shape and
 * nothing client-controlled beyond it — no extensions injection), or null when the
 * payload is not a well-formed V1 payment or its signed rail doesn't match the
 * requirements entry we matched (fail closed on scheme/network desync).
 */
export function asV1Payload(p: any, reqs: any): object | null {
  if (Number(p?.x402Version) !== 1) return null;
  if (typeof p.scheme !== "string" || typeof p.network !== "string") return null;
  if (p.payload === null || typeof p.payload !== "object") return null;
  if (p.scheme !== (reqs as any)?.scheme || p.network !== (reqs as any)?.network) return null;
  return { x402Version: 1, scheme: p.scheme, network: p.network, payload: p.payload };
}

/** True when the client payload CLAIMS x402 v1 (numeric or string version). */
export function claimsV1(p: any): boolean {
  return Number(p?.x402Version) === 1;
}

/**
 * V1 network names → CAIP-2 identifiers (x402 v2 spec requires CAIP-2).
 * Deliberately ONLY the networks our 402s actually offer and that are proven with the
 * CDP facilitator (council 2026-07-27: do not enable unproven networks by mapping).
 */
export const V1_TO_CAIP2: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
};

/** x402 v2 PaymentRequirements (spec §5.1.2): `amount` + CAIP-2 network. */
export function toV2Requirements(r: any): object | null {
  const network = V1_TO_CAIP2[r?.network];
  if (!network) return null;
  return {
    scheme: r.scheme,
    network,
    amount: r.maxAmountRequired ?? r.amount,
    asset: r.asset,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds ?? 60,
    ...(r.extra !== undefined ? { extra: r.extra } : {}),
  };
}

/**
 * Translate a sanitized V1 payment into an x402 v2 PaymentPayload (spec §5.2) so the
 * facilitator processes protocol extensions — the Bazaar only catalogs from v2
 * payloads (proven live 2026-07-27: V1+extensions → EXTENSION-RESPONSES {} and no
 * catalog entry; v2 translation → {"bazaar":{"status":"processing"}}). The EIP-3009
 * signature is bound to the chain's EIP-712 domain, not the protocol representation,
 * so the same signed payload verifies identically. Returns null when the network has
 * no CAIP-2 mapping — caller falls back to plain V1 pass-through.
 */
export function toV2Payload(v1Payload: any, reqs: any, extensions?: object | null): object | null {
  const accepted = toV2Requirements(reqs);
  if (!accepted || !v1Payload?.payload) return null;
  // resource.url must be a real URL — decline translation (caller falls back to the
  // proven V1 pass-through) rather than send a malformed v2 resource (council finding).
  if (typeof reqs?.resource !== "string" || reqs.resource.length === 0) return null;
  return {
    x402Version: 2,
    resource: { url: reqs.resource, description: reqs.description, mimeType: reqs.mimeType },
    accepted,
    payload: v1Payload.payload,
    ...(extensions ? { extensions } : {}),
  };
}
