/**
 * Seed script: Pre-register Claude as an OAuth client for the Connectors Directory.
 * Run with: DATABASE_URL=... npx tsx src/seed-claude-client.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
    const client = await prisma.oAuthClient.upsert({
        where: { clientId: "claude-anthropic" },
        create: {
            clientId: "claude-anthropic",
            clientSecret: null,
            name: "Claude",
            redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
            grantTypes: ["authorization_code", "refresh_token"],
            tokenEndpointAuthMethod: "none",
            isPublic: true,
        },
        update: {
            name: "Claude",
            redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
            isPublic: true,
            tokenEndpointAuthMethod: "none",
        },
    });
    console.log("✅ Claude OAuth client registered:", client.clientId);
}
main()
    .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed-claude-client.js.map