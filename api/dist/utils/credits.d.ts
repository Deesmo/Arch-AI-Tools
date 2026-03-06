import { AuthedRequest } from "../middleware/auth";
import { Response } from "express";
export declare function deductCredits(req: AuthedRequest, res: Response, toolName: string, cost: number): Promise<boolean>;
export declare function logError(agentId: string, toolName: string, cost: number): Promise<void>;
export declare function reqId(): string;
//# sourceMappingURL=credits.d.ts.map