#!/usr/bin/env bash
#
# Arch Tools — Health Check Script
# Quick endpoint verification. Returns exit 1 if anything fails.
# Usage: ./scripts/health-check.sh [base_url]
#

BASE_URL="${1:-https://archtools.dev}"
PASSED=0
FAILED=0
FAILURES=()

check() {
  local expected="$1"
  local path="$2"
  local desc="$3"
  
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${path}" --max-time 10)
  
  if [ "$status" = "$expected" ]; then
    echo "  ✅ $status $path — $desc"
    ((PASSED++))
  else
    echo "  ❌ $status $path — expected $expected — $desc"
    FAILURES+=("$path (got $status, expected $expected)")
    ((FAILED++))
  fi
}

echo ""
echo "🏥 Arch Tools Health Check"
echo "   Target: $BASE_URL"
echo ""

# Core health
echo "── Core ──"
check 200 "/health"                     "API health endpoint"

# Pages
echo ""
echo "── Pages ──"
check 200 "/"                           "Landing page"
check 200 "/directory"                  "Tool directory"
check 200 "/playground"                 "Playground"
check 200 "/docs"                       "Documentation"
check 200 "/blog"                       "Blog"
check 200 "/changelog"                  "Changelog"
check 200 "/sdk"                        "SDK page"
check 200 "/fund"                       "Fund page"

# Static HTML
echo ""
echo "── Static Pages ──"
check 200 "/blog-x402.html"             "x402 blog post"
check 200 "/blog-x402-directory.html"   "x402 directory blog"
check 200 "/docs-x402-guide.html"       "x402 guide"
check 200 "/compare.html"               "Compare page"
check 200 "/integrations.html"          "Integrations page"
check 200 "/facilitator.html"           "Facilitator page"
check 200 "/agents.html"                "Agents page"

# API
echo ""
echo "── API ──"
check 200 "/api/v1/x402/directory"      "x402 directory"
check 200 "/api/v1/x402/pricing"        "x402 pricing"
check 200 "/api/v1/agents/leaderboard"  "Agent leaderboard"
check 200 "/v1/tools"                   "Tools list"

# Discovery
echo ""
echo "── Discovery ──"
check 200 "/sitemap.xml"                "Sitemap"
check 200 "/robots.txt"                 "Robots.txt"
check 200 "/llms.txt"                   "LLMs.txt"
check 200 "/llms-full.txt"              "LLMs full"
check 200 "/openapi.json"               "OpenAPI spec"
check 200 "/tools.json"                 "Tools JSON"

# Summary
echo ""
echo "──────────────────────────────────────────────────"
TOTAL=$((PASSED + FAILED))
echo "  $TOTAL checks | ✅ $PASSED passed | ❌ $FAILED failed"

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo ""
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do
    echo "    • $f"
  done
fi

echo ""
exit $((FAILED > 0 ? 1 : 0))
