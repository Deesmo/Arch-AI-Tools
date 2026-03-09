export declare const LOW_CREDIT_THRESHOLD: number;
export declare function sendVerificationEmail(args: {
    to: string;
    verifyUrl: string;
}): Promise<void>;
export declare function sendWelcomeEmail(to: string, agentId: string, apiKey: string, creditsGranted: number): Promise<void>;
export declare function sendLowCreditAlert(to: string, creditsRemaining: number, agentId: string): Promise<void>;
export declare function sendPurchaseConfirmation(to: string, credits: number, label: string, newBalance: number): Promise<void>;
export declare function sendAdminAlert(subject: string, body: string): Promise<void>;
export declare function sendMonthlyRefreshEmail(to: string, credits: number, newBalance: number): Promise<void>;
export declare function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
//# sourceMappingURL=email.d.ts.map