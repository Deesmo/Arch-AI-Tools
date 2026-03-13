/**
 * Agent Fingerprinting
 * Identifies which AI platform or runtime is calling each tool.
 * This builds a proprietary dataset of agent behavior patterns — our moat.
 */
const AI_AGENT_PATTERNS = [
    // MCP clients
    { pattern: /claude[\s\-_]?desktop/i, name: "claude-desktop" },
    { pattern: /cursor/i, name: "cursor" },
    { pattern: /windsurf/i, name: "windsurf" },
    { pattern: /cline/i, name: "cline" },
    { pattern: /continue[\s\-_]?dev/i, name: "continue-dev" },
    { pattern: /zed/i, name: "zed" },
    // AI platforms calling directly
    { pattern: /anthropic[\s\-_]?sdk/i, name: "anthropic-sdk" },
    { pattern: /claude[\s\-_]?(api|client)/i, name: "claude-api" },
    { pattern: /openai/i, name: "openai-sdk" },
    { pattern: /gpt[\s\-_]?4/i, name: "gpt4" },
    { pattern: /gemini/i, name: "google-gemini" },
    { pattern: /copilot/i, name: "github-copilot" },
    { pattern: /langchain/i, name: "langchain" },
    { pattern: /llamaindex/i, name: "llamaindex" },
    { pattern: /autogen/i, name: "autogen" },
    { pattern: /crewai/i, name: "crewai" },
    { pattern: /pydantic[\s\-_]?ai/i, name: "pydantic-ai" },
    { pattern: /vercel[\s\-_]?ai/i, name: "vercel-ai-sdk" },
    { pattern: /cohere/i, name: "cohere" },
    { pattern: /perplexity/i, name: "perplexity" },
    { pattern: /arch[\s\-_]?tools/i, name: "arch-tools-sdk" },
    // Scripting runtimes
    { pattern: /python[\s\-_]?requests/i, name: "python-requests" },
    { pattern: /python/i, name: "python" },
    { pattern: /node[\s\-_]?fetch/i, name: "node-fetch" },
    { pattern: /axios/i, name: "axios" },
    { pattern: /go[\s\-_]?http/i, name: "go" },
    { pattern: /ruby/i, name: "ruby" },
    { pattern: /java/i, name: "java" },
    { pattern: /php/i, name: "php" },
    { pattern: /curl/i, name: "curl" },
    { pattern: /insomnia/i, name: "insomnia" },
    { pattern: /postman/i, name: "postman" },
    // Browsers (human likely)
    { pattern: /mozilla.*chrome/i, name: "chrome" },
    { pattern: /safari/i, name: "safari" },
    { pattern: /firefox/i, name: "firefox" },
];
const AI_AGENT_NAMES = new Set([
    "claude-desktop", "cursor", "windsurf", "cline", "continue-dev", "zed",
    "anthropic-sdk", "claude-api", "openai-sdk", "gpt4", "google-gemini",
    "github-copilot", "langchain", "llamaindex", "autogen", "crewai",
    "pydantic-ai", "vercel-ai-sdk", "cohere", "perplexity", "arch-tools-sdk",
]);
const BROWSER_NAMES = new Set(["chrome", "safari", "firefox"]);
export function fingerprintCaller(userAgent) {
    if (!userAgent) {
        return { callerType: "unknown", callerName: "no-user-agent" };
    }
    for (const { pattern, name } of AI_AGENT_PATTERNS) {
        if (pattern.test(userAgent)) {
            const versionMatch = userAgent.match(/[\d.]+/);
            const callerVersion = versionMatch?.[0];
            let callerType;
            if (AI_AGENT_NAMES.has(name)) {
                callerType = "ai-agent";
            }
            else if (BROWSER_NAMES.has(name)) {
                callerType = "human";
            }
            else if (["python", "python-requests", "node-fetch", "axios", "go", "ruby", "java", "php", "curl"].includes(name)) {
                callerType = "sdk";
            }
            else {
                callerType = "script";
            }
            return { callerType, callerName: name, callerVersion };
        }
    }
    return { callerType: "unknown", callerName: "other", callerVersion: undefined };
}
//# sourceMappingURL=fingerprint.js.map