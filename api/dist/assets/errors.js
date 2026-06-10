export const ERROR_REGISTRY = [
    {
        code: "unauthorized",
        title: "Missing or invalid API key",
        whatItMeans: "Your request is missing an Authorization bearer token, or the key is invalid/revoked.",
        fastFix: "Set header: Authorization: Bearer <api_key> (from /v1/agent/register).",
    },
    {
        code: "insufficient_credits",
        title: "Not enough credits",
        whatItMeans: "Your account balance is lower than the tool cost. The response includes credits_remaining and credits_needed so you can plan a top-up.",
        fastFix: "Top up at https://archtools.dev/pricing, or earn 500 bonus credits by referring a friend via /v1/referral/code. Free plans also refresh monthly.",
    },
    {
        code: "validation_failed",
        title: "Schema validation failed",
        whatItMeans: "The request body does not match the tool's JSON Schema.",
        fastFix: "Open /openapi.json → find the tool schema → send only the required fields in the correct types.",
    },
    {
        code: "tool_not_found",
        title: "Tool not found",
        whatItMeans: "The tool name is not registered or is misspelled.",
        fastFix: "Call GET /v1/tools and use one of the returned tool names.",
    },
    {
        code: "tool_disabled",
        title: "Tool inactive",
        whatItMeans: "The tool exists but is currently disabled.",
        fastFix: "Pick another tool or contact support if you believe this is a mistake.",
    },
    {
        code: "rate_limited",
        title: "Rate limited",
        whatItMeans: "You exceeded your plan's request budget or a safety limit.",
        fastFix: "Back off and retry after RateLimit-Reset. Upgrade plan if needed.",
    },
    {
        code: "internal_server_error",
        title: "Unexpected server error",
        whatItMeans: "The server hit an exception.",
        fastFix: "Retry with the same X-Request-Id in your support message so we can trace it.",
    },
];
//# sourceMappingURL=errors.js.map