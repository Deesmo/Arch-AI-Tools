export declare function logAudit(opts: {
    agentId?: string;
    action: string;
    resource?: string;
    ip?: string;
    userAgent?: string;
    status?: "success" | "failure";
    meta?: Record<string, unknown>;
}): Promise<void>;
//# sourceMappingURL=audit.d.ts.map