import { AuthedRequest } from "../middleware/auth.js";
import { Response } from "express";
export declare function deductCredits(req: AuthedRequest, res: Response, toolName: string, cost: number): Promise<boolean>;
export declare function logError(agentId: string, toolName: string, cost: number): Promise<void>;
export declare function reqId(): string;
export declare function safeErr(e: unknown): string;
//# sourceMappingURL=credits.d.ts.map