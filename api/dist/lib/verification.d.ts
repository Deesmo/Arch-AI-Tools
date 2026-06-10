export declare const SIGNUP_FREE_CREDITS: number;
export declare function isDisposableEmail(email: string): boolean;
/**
 * Set up the verification gate for a freshly-created agent:
 * moves `creditsToGate` into pendingCredits, issues a token, sends the email.
 * Non-fatal on email failure (token can be re-issued via /v1/verify-email/resend).
 */
export declare function issueEmailVerification(agentId: string, email: string, creditsToGate: number): Promise<void>;
/**
 * Verify a token. Returns the credits activated, or null if invalid/expired.
 */
export declare function verifyEmailToken(token: string): Promise<{
    email: string;
    creditsActivated: number;
} | null>;
//# sourceMappingURL=verification.d.ts.map