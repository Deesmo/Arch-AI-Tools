#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://archtools.dev}"
echo "Using BASE_URL=$BASE_URL"

echo "1) Health"
curl -sS "$BASE_URL/health" | head -c 400; echo; echo

echo "2) List tools"
curl -sS "$BASE_URL/v1/tools" | head -c 800; echo; echo

echo "3) Register agent"
REG=$(curl -sS -X POST "$BASE_URL/v1/agent/register" -H "Content-Type: application/json" -d '{"name":"SmokeTest","email":"smoketest-'$(date +%s)'@example.com"}')
echo "$REG" | head -c 400; echo; echo
API_KEY=$(python - <<'PY'
import json,sys
obj=json.loads(sys.stdin.read())
print(obj.get("api_key",""))
PY
<<<"$REG")
if [ -z "$API_KEY" ]; then echo "No api_key returned"; exit 1; fi

echo "4) Usage"
curl -sS "$BASE_URL/v1/agent/usage" -H "Authorization: Bearer $API_KEY" | head -c 400; echo; echo

echo "5) Invoke validate-data"
curl -sS -X POST "$BASE_URL/v1/tools/validate-data" -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"data":{"email":"test@example.com"},"rules":{"email":"email"}}' | head -c 800; echo; echo

echo "Smoke test complete."
