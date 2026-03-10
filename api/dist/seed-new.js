"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const tools = [
        { name: "news-search", description: "Search for recent news articles on any topic. Returns title, URL, description, source, and publication date from Brave News, Tavily, or Serper.", category: "search", credits: 3 },
        { name: "research-report", description: "Generate a structured AI research report on any topic. Searches multiple sources and synthesizes findings into executive summary, key findings, and conclusion with citations.", category: "ai", credits: 15 },
        { name: "fact-check", description: "Verify the accuracy of a claim. Returns verdict (TRUE/FALSE/MIXED/UNVERIFIED/MISLEADING), confidence score, summary, and supporting/contradicting evidence with sources.", category: "ai", credits: 10 }
    ];
    for (const t of tools) {
        await prisma.tool.upsert({
            where: { name: t.name },
            update: { description: t.description, category: t.category, credits: t.credits, active: true, endpoint: `/v1/tools/${t.name}`, method: "GET" },
            create: { name: t.name, description: t.description, category: t.category, credits: t.credits, active: true, endpoint: `/v1/tools/${t.name}`, method: "GET" }
        });
        console.log("Seeded:", t.name);
    }
    const count = await prisma.tool.count({ where: { active: true } });
    console.log("Total active tools:", count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=seed-new.js.map