export declare const LOW_CREDIT_THRESHOLD: number;
export declare function sendVerificationEmail(args: {
    to: string;
    verifyUrl: string;
}): Promise<void>;
export declare function sendWelcomeEmail(to: string, agentId: string, apiKey: string, creditsGranted: number, referralCode?: string): Promise<void>;
export declare function sendLowCreditAlert(to: string, creditsRemaining: number, agentId: string): Promise<void>;
export declare function sendPurchaseConfirmation(to: string, credits: number, label: string, newBalance: number): Promise<void>;
export declare function sendAdminAlert(subject: string, body: string): Promise<void>;
export declare function sendMonthlyRefreshEmail(to: string, credits: number, newBalance: number): Promise<void>;
export declare function sendFeatureAnnouncement(to: string, opts: {
    headline: string;
    body: string;
    ctaLabel?: string;
    ctaUrl?: string;
}): Promise<boolean>;
export declare function sendX402PaymentReceipt(to: string, opts: {
    toolName: string;
    amountUsdc: string;
    txHash: string;
    network: string;
}): Promise<void>;
export declare function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
export declare function sendDay3FollowupEmail(to: string, agentId: string, creditsRemaining: number): Promise<void>;
export declare function sendDay7ReengagementEmail(to: string, creditsRemaining: number): Promise<void>;
export declare function sendEmail80PctAlert(to: string, creditsRemaining: number, agentId: string): Promise<void>;
export declare function sendCreditsDepletedAlert(to: string, agentId: string): Promise<void>;
//# sourceMappingURL=email.d.ts.map