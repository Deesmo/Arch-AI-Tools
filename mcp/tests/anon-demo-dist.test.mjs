import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const tools = [
  { name: "video-generate", description: "Paid video generation", inputSchema: { type: "object" } },
  { name: "generate-hash", description: "Local hash utility", inputSchema: { type: "object" } },
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function reservePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP server did not start")), 10_000);

    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes("MCP SSE server running")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };

    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`MCP server exited before startup with code ${code}`));
    });
  });
}

async function rpcCall(port, toolName) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: toolName,
      method: "tools/call",
      params: { name: toolName, arguments: {} },
    }),
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  assert.ok(dataLine, `missing SSE data line in response: ${text}`);
  return JSON.parse(dataLine.slice("data: ".length));
}

const forwardedCalls = [];
const apiServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/tools") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tools }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/v1/tools/")) {
    forwardedCalls.push({
      path: req.url,
      apiKey: req.headers["x-api-key"],
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const apiPort = await listen(apiServer);
const mcpPort = await reservePort();
const mcpServer = spawn(process.execPath, ["dist/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    MCP_TRANSPORT: "sse",
    PORT: String(mcpPort),
    ARCH_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
    ARCH_API_KEY: "platform-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(mcpServer);

  const paidResult = await rpcCall(mcpPort, "video-generate");
  assert.equal(paidResult.result.isError, true);
  assert.match(paidResult.result.content[0].text, /api_key_required/);
  assert.deepEqual(forwardedCalls, []);

  const allowedResult = await rpcCall(mcpPort, "generate-hash");
  assert.equal(allowedResult.result.isError, undefined);
  assert.deepEqual(forwardedCalls, [{ path: "/v1/tools/generate-hash", apiKey: "platform-key" }]);
} finally {
  mcpServer.kill("SIGTERM");
  apiServer.close();
}
