declare const router: import("express-serve-static-core").Router;
export declare function signSession(agentId: string): string;
export declare function verifySession(token: string): {
    sub: string;
} | null;
export default router;
//# sourceMappingURL=auth.d.ts.map