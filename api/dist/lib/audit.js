import { prisma } from "./prisma.js";
export async function logAudit(opts) {
    try {
        // Anonymize IP for GDPR — zero out last octet
        const ip = opts.ip ? opts.ip.replace(/\.\d+$/, ".0") : undefined;
        await prisma.auditLog.create({
            data: {
                agentId: opts.agentId,
                action: opts.action,
                resource: opts.resource,
                ip,
                userAgent: opts.userAgent?.slice(0, 200),
                status: opts.status ?? "success",
                meta: opts.meta,
            }
        });
    }
    catch {
        // Never let audit logging break the main flow
    }
}
//# sourceMappingURL=audit.js.map