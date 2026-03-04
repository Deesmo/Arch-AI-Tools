# Arch Tools MCP Server

MCP server for Arch Tools — exposes all API tools to MCP-compatible clients.

## Features

- Dynamically discovers tools from `GET /v1/tools`
- Dual transport: **Stdio** (local CLI) and **SSE** (web/hosted agents)
- Automatic tool registration with descriptions and credit costs
- Routes invocations through authenticated API calls

## Setup

```bash
cd mcp
cp .env.example .env  # Set ARCH_API_BASE_URL and ARCH_API_KEY
npm install
```

## Usage

### Stdio (for Claude Desktop, local tools)
```bash
npm run dev
```

### SSE (for web-based MCP clients, hosted agent platforms)
```bash
MCP_TRANSPORT=sse npm run dev
```

SSE endpoints:
- `GET /sse` — SSE connection
- `POST /messages?sessionId=...` — message handler
- `GET /health` — health check

### Claude Desktop config
```json
{
  "mcpServers": {
    "arch-tools": {
      "command": "npx",
      "args": ["-y", "arch-tools-mcp"],
      "env": {
        "ARCH_API_BASE_URL": "https://archtools.dev",
        "ARCH_API_KEY": "at_sk_your_key_here"
      }
    }
  }
}
```

## Deploy SSE on Render
Create a separate Web Service for the MCP SSE server:
- Root directory: `mcp`
- Build: `npm install && npm run build`
- Start: `npm run start:sse`
- Environment: `ARCH_API_BASE_URL`, `ARCH_API_KEY`, `MCP_TRANSPORT=sse`, `MCP_SSE_PORT=10000`
