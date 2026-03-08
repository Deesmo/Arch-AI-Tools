/**
 * seed-missing-tools.js — run once via Render job to add 8 missing tools
 * Command: node seed-missing-tools.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const tools = [
  { name: 'barcode-generate',  description: 'Generate Code128 barcodes as SVG',                           category: 'media',   credits: 2  },
  { name: 'html-to-markdown',  description: 'Convert HTML or any URL to clean Markdown',                  category: 'text',    credits: 3  },
  { name: 'image-generate',    description: 'Generate SVG images from text prompts via Claude',            category: 'ai',      credits: 15 },
  { name: 'jsonpath-query',    description: 'Run JSONPath expressions against any JSON payload',           category: 'data',    credits: 1  },
  { name: 'screenshot-capture',description: 'Capture page metadata and screenshot URL for any public URL',category: 'web',     credits: 10 },
  { name: 'url-shorten',       description: 'Shorten any URL via TinyURL',                                category: 'utility', credits: 1  },
  { name: 'webhook-send',      description: 'POST a JSON payload to any webhook URL',                     category: 'utility', credits: 2  },
  { name: 'workflow-agent',    description: 'Multi-step autonomous AI agent pipeline',                    category: 'ai',      credits: 25 },
];

async function main() {
  let ok = 0, skip = 0;
  for (const tool of tools) {
    try {
      await prisma.tool.upsert({
        where: { name: tool.name },
        update: { description: tool.description, category: tool.category, credits: tool.credits, enabled: true },
        create: { ...tool, enabled: true },
      });
      console.log('OK:', tool.name);
      ok++;
    } catch (e) {
      console.error('FAIL:', tool.name, e.message);
      skip++;
    }
  }
  const total = await prisma.tool.count();
  console.log(`Done: ${ok} upserted, ${skip} failed. Total tools in DB: ${total}`);
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); process.exit(1); });
