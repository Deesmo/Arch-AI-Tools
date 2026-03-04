# @archtools/sdk

A tiny, premium wrapper for the Arch Tools API.

## Install
```bash
npm i @archtools/sdk
```

## Usage
```ts
import { ArchTools } from "@archtools/sdk";

const client = new ArchTools({
  apiKey: process.env.ARCHTOOLS_API_KEY!,
  baseUrl: "https://archtools.dev"
});

const tools = await client.tools.list();
const usage = await client.agent.usage();
const out = await client.tools.invoke("web-scrape", { url: "https://example.com" });

console.log({ tools, usage, out });
```
