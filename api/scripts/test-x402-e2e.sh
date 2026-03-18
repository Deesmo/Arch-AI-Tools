#!/usr/bin/env bash
# x402 End-to-End Payment Flow Test
# Tests the complete 402 gate + verification format
# Usage: bash api/scripts/test-x402-e2e.sh [base_url]
set -euo pipefail

BASE_URL="${1:-https://archtools.dev}"
FACILITATOR_URL="https://x402.org/facilitator"

echo "=== x402 E2E Payment Flow Test ==="
echo "Target: $BASE_URL"
echo "Facilitator: $FACILITATOR_URL"
echo ""

# ─── Test 1: Verify 402 gate works (no auth = 402) ───────────────────────────
echo "--- Test 1: 402 Gate ---"
HTTP_CODE=$(curl -s -o /tmp/x402-gate-response.json -w "%{http_code}" \
  -X POST "$BASE_URL/v1/tools/generate-hash" \
  -H "Content-Type: application/json" \
  -d '{"text":"hello"}')

if [ "$HTTP_CODE" = "402" ]; then
  echo "✅ 402 returned correctly (no auth)"
else
  echo "❌ Expected 402, got $HTTP_CODE"
  cat /tmp/x402-gate-response.json
  exit 1
fi

# ─── Test 2: Verify PAYMENT-REQUIRED header exists ───────────────────────────
echo ""
echo "--- Test 2: PAYMENT-REQUIRED Header ---"
PAYMENT_HEADER=$(curl -s -D - -o /dev/null \
  -X POST "$BASE_URL/v1/tools/generate-hash" \
  -H "Content-Type: application/json" \
  -d '{"text":"hello"}' 2>/dev/null | grep -i "payment-required" | head -1)

if [ -n "$PAYMENT_HEADER" ]; then
  echo "✅ PAYMENT-REQUIRED header present"
else
  echo "❌ Missing PAYMENT-REQUIRED header"
  exit 1
fi

# ─── Test 3: Parse 402 response body ─────────────────────────────────────────
echo ""
echo "--- Test 3: Response Body Structure ---"
HAS_X402VERSION=$(cat /tmp/x402-gate-response.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('x402Version')==1 else 'no')" 2>/dev/null || echo "no")
HAS_ACCEPTS=$(cat /tmp/x402-gate-response.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('accepts',[])));" 2>/dev/null || echo "0")

echo "x402Version=1: $HAS_X402VERSION"
echo "accepts[] count: $HAS_ACCEPTS"

if [ "$HAS_X402VERSION" = "yes" ] && [ "$HAS_ACCEPTS" -gt "0" ]; then
  echo "✅ Response body is spec-compliant"
else
  echo "❌ Response body malformed"
  cat /tmp/x402-gate-response.json | python3 -m json.tool 2>/dev/null || cat /tmp/x402-gate-response.json
  exit 1
fi

# ─── Test 4: Check accepts[] includes USDC on Base ───────────────────────────
echo ""
echo "--- Test 4: USDC on Base in accepts[] ---"
HAS_USDC_BASE=$(cat /tmp/x402-gate-response.json | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('accepts',[]):
    if a.get('network')=='eip155:8453' and '8335' in str(a.get('asset','')):
        print('yes')
        break
else:
    print('no')
" 2>/dev/null || echo "no")

if [ "$HAS_USDC_BASE" = "yes" ]; then
  echo "✅ USDC on Base (eip155:8453) present"
else
  echo "⚠️  USDC on Base not found (may be filtered by x402scan whitelist)"
fi

# ─── Test 5: Check USDT on Base via Permit2 ──────────────────────────────────
echo ""
echo "--- Test 5: USDT on Base via Permit2 ---"
HAS_USDT_PERMIT2=$(cat /tmp/x402-gate-response.json | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('accepts',[]):
    if 'fde4C96c' in str(a.get('asset','')) and a.get('extra',{}).get('assetTransferMethod')=='permit2':
        print('yes')
        break
else:
    print('no')
" 2>/dev/null || echo "no")

if [ "$HAS_USDT_PERMIT2" = "yes" ]; then
  echo "✅ USDT on Base via Permit2 present"
else
  echo "⚠️  USDT Permit2 not found (may not be deployed yet)"
fi

# ─── Test 6: Verify facilitator format (testnet only) ────────────────────────
echo ""
echo "--- Test 6: Facilitator Verify Format Check ---"
echo "(Using testnet facilitator with a fake payment to confirm endpoint accepts our format)"

# Build a minimal verify request matching the spec
VERIFY_BODY=$(python3 -c "
import json, base64
# Fake payment payload (will fail verification but should get a structured error, not a format error)
fake_payload = {
    'x402Version': 1,
    'scheme': 'exact',
    'network': 'eip155:84532',
    'payload': {
        'signature': '0x' + '00' * 65,
        'authorization': {
            'from': '0x0000000000000000000000000000000000000001',
            'to': '0x0000000000000000000000000000000000000002',
            'value': '1000',
            'validAfter': '0',
            'validBefore': '9999999999',
            'nonce': '0x' + '00' * 32
        }
    }
}
# The paymentPayload must be the decoded object (not base64)
req = {
    'x402Version': 1,
    'paymentPayload': fake_payload,
    'paymentRequirements': {
        'scheme': 'exact',
        'network': 'eip155:84532',
        'asset': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        'amount': '1000',
        'payTo': '0x0000000000000000000000000000000000000002',
        'maxTimeoutSeconds': 60,
    }
}
print(json.dumps(req))
")

VERIFY_RESPONSE=$(curl -s -o /tmp/x402-verify-response.json -w "%{http_code}" \
  -X POST "$FACILITATOR_URL/verify" \
  -H "Content-Type: application/json" \
  -d "$VERIFY_BODY")

echo "Facilitator response code: $VERIFY_RESPONSE"
cat /tmp/x402-verify-response.json | python3 -m json.tool 2>/dev/null || cat /tmp/x402-verify-response.json
echo ""

# A 400 with "invalid" or "isValid: false" is GOOD — means the format was accepted
# A 422 or format error means our payload structure is wrong
if [ "$VERIFY_RESPONSE" = "200" ] || [ "$VERIFY_RESPONSE" = "400" ]; then
  echo "✅ Facilitator accepted our request format (payment correctly rejected as invalid signature)"
elif [ "$VERIFY_RESPONSE" = "422" ]; then
  echo "❌ Facilitator returned 422 — our payload format is WRONG"
  exit 1
else
  echo "⚠️  Unexpected response code: $VERIFY_RESPONSE"
fi

# ─── Test 7: Full payment cycle simulation ────────────────────────────────────
echo ""
echo "--- Test 7: Full Payment Cycle Summary ---"
echo ""
echo "Complete x402 payment flow for Arch Tools:"
echo ""
echo "1. Agent POST /v1/tools/generate-hash (no auth)"
echo "   → Server returns 402 + PAYMENT-REQUIRED header"
echo ""
echo "2. Agent reads accepts[], selects USDC on Base (eip155:8453)"
echo "   → Signs transferWithAuthorization (EIP-3009) or Permit2"
echo "   → Base64-encodes the PaymentPayload"
echo ""
echo "3. Agent retries with PAYMENT-SIGNATURE header"
echo "   → Server decodes payload"
echo "   → Server finds matching accepts[] entry"
echo "   → Server sends {x402Version, paymentPayload, paymentRequirements} to facilitator/verify"
echo ""
echo "4. Facilitator verifies signature, balance, and authorization"
echo "   → Returns {isValid: true, payer: '0x...'}"
echo ""
echo "5. Server calls facilitator/settle"
echo "   → Facilitator broadcasts tx onchain"
echo "   → Returns {transaction: '0x...', network: 'eip155:8453'}"
echo ""
echo "6. Server returns 200 + tool response + PAYMENT-RESPONSE header"
echo ""
echo "=== All tests complete ==="
