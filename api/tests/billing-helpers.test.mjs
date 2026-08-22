/**
 * Regression coverage for billing helper paths that are difficult to exercise
 * without Stripe webhook signing.
 *
 * Run: node api/tests/billing-helpers.test.mjs (after npm run build)
 */
process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";
process.env.JWT_SECRET ??= "test-secret-for-billing-helper-import";

const {
  agentUpdateForPaidSubscriptionInvoice,
  paymentIntentIdFromCheckoutSession,
} = await import("../dist/routes/billing.js");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  OK ${msg}`); }
  else { failed++; console.log(`  FAIL ${msg}`); }
}

console.log("\nBilling helper tests");

let retrieveCalls = 0;
const direct = await paymentIntentIdFromCheckoutSession(
  { payment_intent: "pi_direct", invoice: "in_unused" },
  async () => {
    retrieveCalls++;
    return { payment_intent: "pi_should_not_load" };
  },
);
assert(direct === "pi_direct", "uses direct PaymentIntent when Checkout Session has one");
assert(retrieveCalls === 0, "does not retrieve invoice when direct PaymentIntent exists");

const fromInvoice = await paymentIntentIdFromCheckoutSession(
  { invoice: "in_first_subscription" },
  async (invoiceId) => {
    retrieveCalls++;
    assert(invoiceId === "in_first_subscription", "retrieves the subscription's first invoice");
    return { payment_intent: { id: "pi_first_invoice" } };
  },
);
assert(fromInvoice === "pi_first_invoice", "uses first invoice PaymentIntent for subscription Checkout Sessions");

const missing = await paymentIntentIdFromCheckoutSession({}, async () => {
  retrieveCalls++;
  return { payment_intent: "pi_unreachable" };
});
assert(missing === null, "returns null when neither session nor invoice has a PaymentIntent");

const paidRenewalUpdate = agentUpdateForPaidSubscriptionInvoice(30000, "pro-monthly");
assert(paidRenewalUpdate.credits?.increment === 30000, "paid renewal increments subscription credits");
assert(paidRenewalUpdate.tier === "pro", "paid renewal restores the paid tier after a failed-payment downgrade");

const malformedRenewalUpdate = agentUpdateForPaidSubscriptionInvoice(30000, undefined);
assert(malformedRenewalUpdate.credits?.increment === 30000, "malformed renewal metadata still increments allowed credits");
assert(!("tier" in malformedRenewalUpdate), "malformed renewal metadata does not downgrade the existing tier");

console.log(`Billing helper tests passed: ${passed}, failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
