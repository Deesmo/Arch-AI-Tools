import { Router } from "express";

export const openApiRouter = Router();

/**
 * GET /openapi.json
 * Minimal-but-high-quality OpenAPI spec for Arch Tools.
 * This is intentionally curated (not auto-generated) so it stays stable and premium.
 */
openApiRouter.get("/openapi.json", (_req, res) => {
  const apiBase = process.env.PUBLIC_API_BASE_URL || "https://archtools.dev";

  res.json({
    openapi: "3.0.3",
    info: {
      title: "Arch Tools API",
      version: "1.0.0",
      description:
        "Production-ready API tools for developers and AI agents. Discover tools, authenticate agents, invoke tools, and purchase credits via Stripe.",
      termsOfService: `${apiBase}/legal/terms`,
      contact: {
        name: "Arch Tools",
        url: "https://archtools.dev",
      },
    },
    servers: [{ url: apiBase }],
    tags: [
      { name: "Status" },
      { name: "Tools" },
      { name: "Agents" },
      { name: "Billing" },
      { name: "Legal" },
      { name: "Docs" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
          description:
            "Use the agent API key from POST /v1/agent/register as `Authorization: Bearer <api_key>`.",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: false },
            error: { type: "string", example: "invalid_request" },
            message: { type: "string", example: "Missing required field: url" },
            request_id: { type: "string", example: "req_01H..." },
          },
          required: ["ok", "error", "request_id"],
        },
        AgentRegisterRequest: {
          type: "object",
          properties: {
            name: { type: "string", example: "My Agent" },
            email: { type: "string", example: "me@example.com" },
          },
          additionalProperties: false,
        },
        AgentRegisterResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            agent_id: { type: "string", example: "ckz..." },
            api_key: { type: "string", example: "arch_..." },
            request_id: { type: "string", example: "req_01H..." },
          },
          required: ["ok", "agent_id", "api_key", "request_id"],
        },
        ToolListResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            tools: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", example: "web-scrape" },
                  description: { type: "string" },
                  price: { type: "integer", example: 5 },
                  schemaJson: { type: "object" },
                },
                required: ["name", "description", "price"],
              },
            },
            request_id: { type: "string", example: "req_01H..." },
          },
          required: ["ok", "tools", "request_id"],
        },
        AgentUsageResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            credits_remaining: { type: "integer", example: 950 },
            calls_today: { type: "integer", example: 12 },
            total_calls: { type: "integer", example: 180 },
            recent_activity: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  toolName: { type: "string", example: "web-scrape" },
                  cost: { type: "integer", example: 5 },
                  status: { type: "string", example: "SUCCESS" },
                  createdAt: { type: "string", example: "2026-03-03T21:05:00.000Z" },
                },
              },
            },
            request_id: { type: "string", example: "req_01H..." },
          },
          required: ["ok", "credits_remaining", "calls_today", "total_calls", "recent_activity", "request_id"],
        },
        CheckoutRequest: {
          type: "object",
          properties: {
            price_id: { type: "string", example: "price_..." },
            success_url: { type: "string", example: "https://archtools.dev/success" },
            cancel_url: { type: "string", example: "https://archtools.dev/pricing" },
          },
          required: ["price_id", "success_url", "cancel_url"],
          additionalProperties: false,
        },
        CheckoutResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            checkout_url: { type: "string", example: "https://checkout.stripe.com/c/pay/cs_test_..." },
            request_id: { type: "string", example: "req_01H..." },
          },
          required: ["ok", "checkout_url", "request_id"],
        },
        ToolInvokeResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            tool: { type: "string", example: "web-scrape" },
            credits_used: { type: "integer", example: 5 },
            credits_remaining: { type: "integer", example: 95 },
            result: { type: "object" },
            request_id: { type: "string", example: "req_01H..." },
          },
          required: ["ok", "tool", "credits_used", "credits_remaining", "result", "request_id"],
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/status": {
        get: {
          tags: ["Status"],
          summary: "Service status",
          responses: {
            "200": { description: "OK" },
          },
        },
      },
      "/health": {
        get: {
          tags: ["Status"],
          summary: "Health check",
          responses: { "200": { description: "OK" } },
        },
      },
      "/docs": {
        get: {
          tags: ["Docs"],
          summary: "Branded API documentation",
          responses: { "200": { description: "HTML docs" } },
        },
      },
      "/openapi.json": {
        get: {
          tags: ["Docs"],
          summary: "OpenAPI specification (JSON)",
          responses: { "200": { description: "OpenAPI JSON" } },
        },
      },
      "/legal": {
        get: { tags: ["Legal"], summary: "Legal index", responses: { "200": { description: "OK" } } },
      },
      "/legal/terms": {
        get: { tags: ["Legal"], summary: "Terms of Service", responses: { "200": { description: "OK" } } },
      },
      "/legal/privacy": {
        get: { tags: ["Legal"], summary: "Privacy Policy", responses: { "200": { description: "OK" } } },
      },
      "/legal/aup": {
        get: { tags: ["Legal"], summary: "Acceptable Use Policy", responses: { "200": { description: "OK" } } },
      },
      "/legal/refund": {
        get: { tags: ["Legal"], summary: "Refund Policy", responses: { "200": { description: "OK" } } },
      },
      "/legal/security": {
        get: { tags: ["Legal"], summary: "Security Policy", responses: { "200": { description: "OK" } } },
      },
      "/legal/retention": {
        get: { tags: ["Legal"], summary: "Data Retention", responses: { "200": { description: "OK" } } },
      },
      "/legal/subprocessors": {
        get: { tags: ["Legal"], summary: "Subprocessors", responses: { "200": { description: "OK" } } },
      },
      "/v1/tools": {
        get: {
          tags: ["Tools"],
          summary: "List available tools",
          responses: {
            "200": {
              description: "Tool registry",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ToolListResponse" } } },
            },
          },
        },
      },
      "/v1/agent/register": {
        post: {
          tags: ["Agents"],
          summary: "Register an agent and issue an API key",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentRegisterRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Agent created",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AgentRegisterResponse" } } },
            },
            "409": {
              description: "Email already registered",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
            },
          },
          security: [],
        },
      },
      "/v1/agent/usage": {
        get: {
          tags: ["Agents"],
          summary: "Agent usage and credit balance",
          responses: {
            "200": {
              description: "Usage stats",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AgentUsageResponse" } } },
            },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/checkout": {
        post: {
          tags: ["Billing"],
          summary: "Create a Stripe Checkout session",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutRequest" } } },
          },
          responses: {
            "200": { description: "Checkout created", content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutResponse" } } } },
            "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/v1/tools/{toolName}": {
        post: {
          tags: ["Tools"],
          summary: "Invoke a tool by name",
          parameters: [
            { name: "toolName", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
                examples: {
                  validateData: { summary: "validate-data", value: { input: { email: "me@example.com" }, rules: { email: "email" } } },
                  generateHash: { summary: "generate-hash", value: { algorithm: "sha256", input: "hello" } },
                  qrCode: { summary: "qr-code", value: { text: "https://archtools.dev", format: "png" } },
                  convertFormat: { summary: "convert-format", value: { from: "json", to: "yaml", data: { hello: "world" } } },
                  transformText: { summary: "transform-text", value: { mode: "slug", text: "Arch Tools Premium API" } },
                  extractMetadata: { summary: "extract-metadata", value: { url: "https://archtools.dev" } },
                  webScrape: { summary: "web-scrape", value: { url: "https://example.com", mode: "readable" } },
                  aiGenerate: { summary: "ai-generate", value: { prompt: "Write a short product description for Arch Tools.", max_tokens: 120 } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Tool response", content: { "application/json": { schema: { $ref: "#/components/schemas/ToolInvokeResponse" } } } },
            "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "402": { description: "Insufficient credits", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "404": { description: "Tool not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
    },
  });
});
