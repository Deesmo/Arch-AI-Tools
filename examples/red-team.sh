#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8787}"
echo "Base: $BASE"

echo "1) Health"
curl -sS "$BASE/health" | head -c 200; echo

echo "2) Register agent"
AGENT=$(curl -sS -X POST "$BASE/v1/agent/register" -H "Content-Type: application/json" -d '{"name":"redteam","email":"redteam+'$(date +%s)'@example.com"}')
echo "$AGENT" | head -c 200; echo
API_KEY=$(python - <<'PY'
import json,sys
obj=json.loads(sys.stdin.read())
print(obj["api_key"])
PY
<<<"$AGENT")

echo "3) Tools discovery"
curl -sS "$BASE/v1/tools" -H "Authorization: Bearer $API_KEY" | head -c 200; echo

echo "4) Invoke validate-data"
curl -sS -X POST "$BASE/v1/tools/validate-data" -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"data":{"a":1},"rules":{"required":["a"]}}' | head -c 200; echo

echo "5) SSRF block check (should block)"
curl -sS -X POST "$BASE/v1/tools/web-scrape" -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"url":"http://127.0.0.1"}' | head -c 200; echo

echo "Done."
