import assert from "node:assert/strict";
import http from "node:http";

process.env.ARCH_API_KEY = "stale-env-key";
process.env.ARCH_API_BASE_URL = "http://127.0.0.1:1";

const { default: createHostedServer } = await import("../dist/index.js");
const seen = [];

const api = http.createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({
      method: req.method,
      url: req.url,
      apiKey: Array.isArray(req.headers["x-api-key"])
        ? req.headers["x-api-key"][0]
        : req.headers["x-api-key"],
      body,
    });

    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/v1/tools") {
      res.end(JSON.stringify({
        tools: [{
          name: "generate-hash",
          description: "Generate a hash",
          inputSchema: { type: "object", properties: {} },
        }],
      }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/tools/generate-hash") {
      res.end(JSON.stringify({ ok: true, echoed: body }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
});

await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

try {
  const address = api.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const server = await createHostedServer({
    config: {
      apiKey: "configured-user-key",
      baseUrl,
    },
  });

  const handlers = server._requestHandlers;

  const toolsList = await handlers.get("tools/list")?.({ method: "tools/list", params: {} }, {});
  assert.equal(toolsList.tools[0].name, "generate-hash");

  const toolCall = await handlers.get("tools/call")?.({
    method: "tools/call",
    params: { name: "generate-hash", arguments: { text: "abc" } },
  }, {});

  assert.equal(JSON.parse(toolCall.content[0].text).echoed.text, "abc");
  assert.deepEqual(
    seen.map((request) => ({
      method: request.method,
      url: request.url,
      apiKey: request.apiKey,
    })),
    [
      { method: "GET", url: "/v1/tools", apiKey: "configured-user-key" },
      { method: "POST", url: "/v1/tools/generate-hash", apiKey: "configured-user-key" },
    ],
  );
} finally {
  await new Promise((resolve, reject) => {
    api.close((err) => (err ? reject(err) : resolve()));
  });
}
