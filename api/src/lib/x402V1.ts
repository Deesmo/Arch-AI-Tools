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
