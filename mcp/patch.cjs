const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'index.ts');
let c = fs.readFileSync(file, 'utf8');

// Fix 1: Replace ONLY the MCP SDK import block (not other imports)
// Match specifically: import { McpServer, StdioServerTransport, } from "...index.js"
c = c.replace(
  /import \{[\s]*McpServer,[\s]*StdioServerTransport,[\s]*\} from "@modelcontextprotocol\/sdk\/server\/index\.js";/,
  'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";'
);

// Fix 2: type the implicit any on tool handler
c = c.replace(
  'async ({ input }) => {',
  'async ({ input }: { input?: unknown }) => {'
);

fs.writeFileSync(file, c);
console.log('✅ MCP imports patched');
