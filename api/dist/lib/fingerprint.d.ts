/**
 * Agent Fingerprinting
 * Identifies which AI platform or runtime is calling each tool.
 * This builds a proprietary dataset of agent behavior patterns — our moat.
 */
export interface AgentFingerprint {
    callerType: "ai-agent" | "sdk" | "script" | "human" | "unknown";
    callerName: string;
    callerVersion?: string;
}
export declare function fingerprintCaller(userAgent?: string): AgentFingerprint;
//# sourceMappingURL=fingerprint.d.ts.map