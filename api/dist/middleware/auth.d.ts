import { Request, Response, NextFunction } from "express";
export interface AuthedRequest extends Request {
    agent?: {
        id: string;
        apiKey: string;
        email: string;
        credits: number;
        tier: string;
        totalCalls: number;
    };
}
export declare function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void>;
export declare function requireAdmin(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map