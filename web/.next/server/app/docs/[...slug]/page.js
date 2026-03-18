(()=>{var e={};e.id=687,e.ids=[687],e.modules={2934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},4580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},5869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},9715:(e,t,s)=>{"use strict";s.r(t),s.d(t,{GlobalError:()=>i.a,__next_app__:()=>u,originalPathname:()=>h,pages:()=>d,routeModule:()=>p,tree:()=>c}),s(6633),s(9264),s(5866);var o=s(3191),a=s(8716),r=s(7922),i=s.n(r),l=s(5231),n={};for(let e in l)0>["default","tree","pages","GlobalError","originalPathname","__next_app__","routeModule"].indexOf(e)&&(n[e]=()=>l[e]);s.d(t,n);let c=["",{children:["docs",{children:["[...slug]",{children:["__PAGE__",{},{page:[()=>Promise.resolve().then(s.bind(s,6633)),"/Volumes/PRO-G40/.openclaw/workspace/repos/Arch-AI-Tools/web/src/app/docs/[...slug]/page.tsx"]}]},{}]},{}]},{layout:[()=>Promise.resolve().then(s.bind(s,9264)),"/Volumes/PRO-G40/.openclaw/workspace/repos/Arch-AI-Tools/web/src/app/layout.tsx"],"not-found":[()=>Promise.resolve().then(s.t.bind(s,5866,23)),"next/dist/client/components/not-found-error"]}],d=["/Volumes/PRO-G40/.openclaw/workspace/repos/Arch-AI-Tools/web/src/app/docs/[...slug]/page.tsx"],h="/docs/[...slug]/page",u={require:s,loadChunk:()=>Promise.resolve()},p=new o.AppPageRouteModule({definition:{kind:a.x.APP_PAGE,page:"/docs/[...slug]/page",pathname:"/docs/[...slug]",bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:c}})},3219:(e,t,s)=>{Promise.resolve().then(s.t.bind(s,2994,23)),Promise.resolve().then(s.t.bind(s,6114,23)),Promise.resolve().then(s.t.bind(s,9727,23)),Promise.resolve().then(s.t.bind(s,9671,23)),Promise.resolve().then(s.t.bind(s,1868,23)),Promise.resolve().then(s.t.bind(s,4759,23))},6807:(e,t,s)=>{Promise.resolve().then(s.t.bind(s,9404,23))},3355:(e,t,s)=>{Promise.resolve().then(s.bind(s,2548))},2548:(e,t,s)=>{"use strict";s.d(t,{Navbar:()=>n});var o=s(326),a=s(434),r=s(5047),i=s(2345);let l=[{href:"/docs",label:"Docs"},{href:"/playground",label:"Playground"},{href:"/pricing",label:"Pricing"},{href:"/changelog",label:"Changelog"},{href:"/dashboard",label:"Dashboard"}];function n(){let e=(0,r.usePathname)();return o.jsx("header",{className:"sticky top-0 z-50 border-b border-white/[0.08] bg-[#070812]/80 backdrop-blur-xl",children:(0,o.jsxs)("div",{className:"mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5",children:[(0,o.jsxs)(a.default,{href:"/",className:"flex items-center gap-2.5",children:[o.jsx("div",{className:"relative h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-400/90 to-emerald-300/80 shadow-lg shadow-indigo-500/20",children:o.jsx("div",{className:"absolute inset-0 rounded-xl bg-white/10"})}),(0,o.jsxs)("div",{className:"leading-tight",children:[o.jsx("div",{className:"text-sm font-semibold tracking-tight",children:"Arch Tools"}),o.jsx("div",{className:"text-[10px] text-white/40",children:"Infrastructure for AI agents"})]})]}),o.jsx("nav",{className:"hidden items-center gap-1 md:flex",children:l.map(({href:t,label:s})=>o.jsx(a.default,{href:t,className:`rounded-xl px-3 py-2 text-sm transition-colors ${e?.startsWith(t)?"bg-white/8 text-white":"text-white/60 hover:text-white hover:bg-white/5"}`,children:s},t))}),(0,o.jsxs)("div",{className:"flex items-center gap-2",children:[o.jsx(a.default,{href:"/docs",className:"hidden rounded-xl border border-white/12 px-3 py-2 text-sm text-white/65 hover:border-white/25 hover:text-white transition-colors md:inline-flex",children:"View docs"}),(0,o.jsxs)(a.default,{href:"/signin",className:"inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors",children:["Get API key ",o.jsx(i.Z,{size:14})]})]})]})})}},7371:(e,t,s)=>{"use strict";s.d(t,{default:()=>a.a});var o=s(1812),a=s.n(o)},1812:(e,t,s)=>{"use strict";let{createProxy:o}=s(8570);e.exports=o("/Volumes/PRO-G40/.openclaw/workspace/repos/Arch-AI-Tools/web/node_modules/next/dist/client/link.js")},6633:(e,t,s)=>{"use strict";s.r(t),s.d(t,{default:()=>i});var o=s(9510),a=s(7371);let r={quickstart:{title:"Quickstart",sections:[{heading:"1. Sign up",body:"Go to archtools.dev/signin and enter your email. You'll receive a magic link — click it to verify and receive your API key. It's shown once, so save it somewhere safe."},{heading:"2. Make your first tool call",body:"Use the API key in the Authorization header. Here's a complete example calling the ip-lookup tool:",code:`curl -X POST https://archtools.dev/v1/tools/ip-lookup \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "ip": "8.8.8.8" }'`,lang:"bash"},{heading:"Response shape",body:"Every tool returns a consistent envelope:",code:`{
  "tool": "ip-lookup",
  "request_id": "uuid",
  "credits_used": 2,
  "credits_remaining": 98,
  "latency_ms": 142,
  "cache_hit": false,
  "result": {
    "ok": true,
    "ip": "8.8.8.8",
    "country": "United States",
    "city": "Mountain View",
    "isp": "Google LLC"
  }
}`,lang:"json"},{heading:"3. Node.js SDK (optional)",body:"Install the SDK for cleaner integration:",code:`npm install archtools

import { ArchTools } from 'archtools'

const arch = new ArchTools(process.env.ARCH_API_KEY)
const result = await arch.tools.run('sentiment-analysis', {
  text: 'Arch Tools is incredible!'
})
console.log(result.sentiment) // "positive"`,lang:"js"},{heading:"4. Python SDK (optional)",body:"",code:`pip install archtools

from archtools import ArchTools

arch = ArchTools(api_key="YOUR_API_KEY")
result = arch.tools.run("ip-lookup", {"ip": "8.8.8.8"})
print(result["result"]["country"])`,lang:"python"}]},tools:{title:"Tools reference",sections:[{body:"All tools run through a unified endpoint. Discover available tools without authentication:",code:"GET https://archtools.dev/v1/tools",lang:"bash"},{heading:"Call a tool",body:"POST to /v1/tools/:toolName with a JSON body. Authentication required.",code:`POST /v1/tools/sentiment-analysis
Authorization: Bearer YOUR_KEY
Content-Type: application/json

{ "text": "This API is absolutely fantastic!" }`,lang:"bash"},{heading:"Semantic search",body:"Find tools by task description — useful for agents discovering capabilities:",code:`POST /v1/tools/search
{ "task": "detect language of text", "limit": 5 }`,lang:"bash"},{heading:"Tool categories",body:`Data     — validate-data, convert-format, diff-text, generate-hash
Text     — transform-text, summarize, readability-score
AI       — ai-generate, ocr-extract, extract-entities, sentiment-analysis, pii-detect
Web      — web-scrape, search-web, web-search, extract-page, rss-parse, extract-metadata
Browser  — browser-task (Playwright)
Network  — ip-lookup, whois-lookup, email-verify, phone-validate
Finance  — currency-convert
Utility  — timezone-convert, generate-uuid, regex-generate, qr-code, extract-pdf`}]},workflows:{title:"Workflow engine",sections:[{body:"Run up to 8 tools sequentially in a single API call. Steps execute in order, and each step can reference the previous step's output using $last."},{heading:"Basic workflow",code:`POST /v1/workflows/run
Authorization: Bearer YOUR_KEY

{
  "steps": [
    { "tool": "web-scrape",  "input": { "url": "https://techcrunch.com" } },
    { "tool": "summarize",   "input": { "text": "$last", "style": "bullets" } },
    { "tool": "pii-detect",  "input": { "text": "$last", "redact": true } }
  ]
}`,lang:"json"},{heading:"Response",body:"The workflow response includes per-step outputs, total credits used, and overall latency:",code:`{
  "workflow_id": "uuid",
  "steps": [
    { "step": 1, "tool": "web-scrape",  "credits": 5, "latency_ms": 820, "result": {...} },
    { "step": 2, "tool": "summarize",   "credits": 10,"latency_ms": 340, "result": {...} },
    { "step": 3, "tool": "pii-detect",  "credits": 10,"latency_ms": 210, "result": {...} }
  ],
  "credits_used": 25,
  "credits_remaining": 75,
  "latency_ms": 1370
}`,lang:"json"},{heading:"$last templating",body:"$last is replaced with the string representation of the prior step's result. For nested access, pass the full prior result and use ai-generate to extract fields."}]},agent:{title:"Agent runtime",sections:[{body:"Submit a natural language task. The runtime plans a bounded workflow of up to 5 steps and executes it with automatic credit billing."},{heading:"Execute a task",code:`POST /v1/agent/execute
Authorization: Bearer YOUR_KEY

{
  "task": "Find the latest news about Nvidia and write a 3-bullet summary"
}`,lang:"json"},{heading:"Response",code:`{
  "request_id": "uuid",
  "task": "Find the latest news about Nvidia...",
  "plan": ["search-web", "summarize"],
  "steps": [...],
  "result": "• Nvidia reported record Q3 revenue...
• ...",
  "credits_used": 15,
  "credits_remaining": 85
}`,lang:"json"},{heading:"When to use the agent vs. workflows",body:`Use workflows when:
- You know the exact tools and order needed
- You need deterministic, repeatable execution
- You want predictable credit costs

Use the agent when:
- The task is open-ended
- You want the system to choose tools automatically
- Flexibility matters more than determinism`}]},"browser-automation":{title:"Browser automation",sections:[{body:"The browser-task tool uses Playwright to control a headless Chromium instance. Supports extract, click, type, and html actions."},{heading:"Extract text with a CSS selector",code:`POST /v1/tools/browser-task
{
  "url": "https://news.ycombinator.com",
  "action": "extract",
  "selector": ".titleline"
}`,lang:"json"},{heading:"Get full page HTML",code:`{
  "url": "https://example.com",
  "action": "html"
}`,lang:"json"},{heading:"Click a button",code:`{
  "url": "https://example.com/login",
  "action": "click",
  "selector": "#submit-btn"
}`,lang:"json"},{heading:"Type into a field",code:`{
  "url": "https://example.com/search",
  "action": "type",
  "selector": "input[name=q]",
  "text": "Arch Tools"
}`,lang:"json"},{heading:"Security",body:"All requests are SSRF-hardened: private IP ranges, cloud metadata endpoints (169.254.169.254), and localhost are blocked. Results are bounded to 50,000 characters."}]}};async function i({params:e}){let t=r[(e.slug||[]).join("/").split("/")[0]];return t?(0,o.jsxs)("div",{className:"pt-14 max-w-3xl",children:[o.jsx(a.default,{className:"text-sm text-white/45 hover:text-white/80 transition-colors mb-8 inline-block",href:"/docs",children:"← Docs"}),o.jsx("h1",{className:"text-4xl font-semibold tracking-tight mb-10",children:t.title}),o.jsx("div",{className:"flex flex-col gap-8",children:t.sections.map((e,t)=>(0,o.jsxs)("div",{children:[e.heading&&o.jsx("h2",{className:"text-base font-semibold text-white mb-3",children:e.heading}),e.body&&o.jsx("p",{className:"text-sm text-white/55 leading-relaxed whitespace-pre-line mb-3",children:e.body}),e.code&&(0,o.jsxs)("div",{className:"rounded-xl border border-white/10 bg-black/40 overflow-hidden",children:[e.lang&&o.jsx("div",{className:"border-b border-white/8 px-4 py-1.5 text-xs text-white/25 font-mono",children:e.lang}),o.jsx("pre",{className:"overflow-auto p-4 text-xs text-white/75 leading-relaxed font-mono",children:e.code})]})]},t))}),(0,o.jsxs)("div",{className:"mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex items-center justify-between gap-4",children:[o.jsx("div",{className:"text-sm text-white/45",children:"Ready to try it?"}),(0,o.jsxs)("div",{className:"flex gap-2",children:[o.jsx(a.default,{href:"/playground",className:"rounded-xl border border-white/15 px-4 py-2 text-sm text-white/65 hover:border-white/30 hover:text-white transition-colors",children:"Playground"}),o.jsx(a.default,{href:"/signin",className:"rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#070812] hover:bg-white/90 transition-colors",children:"Get API key"})]})]})]}):(0,o.jsxs)("div",{className:"pt-14",children:[o.jsx(a.default,{className:"text-sm text-white/50 hover:text-white mb-6 inline-block",href:"/docs",children:"← Docs"}),o.jsx("h1",{className:"text-3xl font-semibold",children:"Page not found"}),o.jsx("p",{className:"mt-3 text-white/55",children:"That doc page doesn't exist yet."})]})}},9264:(e,t,s)=>{"use strict";s.r(t),s.d(t,{default:()=>l,metadata:()=>r});var o=s(9510);s(5023);let a=(0,s(8570).createProxy)(String.raw`/Volumes/PRO-G40/.openclaw/workspace/repos/Arch-AI-Tools/web/src/components/navbar.tsx#Navbar`),r={title:"Arch Tools — Infrastructure for AI Agents",description:"30 production-ready API tools for developers and AI agents. Authentication, credit billing, workflows, MCP, and x402 USDC payments built in.",keywords:"API tools, AI agents, MCP, workflow engine, web scraping, sentiment analysis, developer tools",openGraph:{title:"Arch Tools — Infrastructure for AI Agents",description:"30 production-ready API tools with auth, billing, and MCP support.",url:"https://archtools.dev",siteName:"Arch Tools",type:"website"}},i=[{label:"Docs",href:"/docs"},{label:"Pricing",href:"/pricing"},{label:"Playground",href:"/playground"},{label:"Dashboard",href:"/dashboard"},{label:"OpenAPI",href:"/openapi.json"},{label:"Status",href:"/v1/status"}];function l({children:e}){return o.jsx("html",{lang:"en",className:"scroll-smooth",children:(0,o.jsxs)("body",{className:"min-h-screen antialiased",children:[o.jsx(a,{}),o.jsx("main",{className:"mx-auto max-w-6xl px-6 pb-24",children:e}),o.jsx("footer",{className:"border-t border-white/[0.07] mt-8",children:o.jsx("div",{className:"mx-auto max-w-6xl px-6 py-10",children:(0,o.jsxs)("div",{className:"flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between",children:[(0,o.jsxs)("div",{children:[(0,o.jsxs)("div",{className:"flex items-center gap-2 mb-1",children:[o.jsx("div",{className:"h-6 w-6 rounded-lg bg-gradient-to-br from-indigo-400/90 to-emerald-300/80"}),o.jsx("span",{className:"text-sm font-semibold text-white/80",children:"Arch Tools"})]}),(0,o.jsxs)("div",{className:"text-xs text-white/30",children:["\xa9 ",new Date().getFullYear()," Arch Enterprises LLC \xb7 Columbia, SC"]})]}),o.jsx("nav",{className:"flex flex-wrap gap-x-5 gap-y-2",children:i.map(({label:e,href:t})=>o.jsx("a",{href:t,className:"text-xs text-white/40 hover:text-white/70 transition-colors",children:e},e))})]})})})]})})}},5023:()=>{}};var t=require("../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),o=t.X(0,[226],()=>s(9715));module.exports=o})();