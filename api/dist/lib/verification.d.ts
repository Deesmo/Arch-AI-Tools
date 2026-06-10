export declare const SIGNUP_FREE_CREDITS: number;
export declare function isDisposableEmail(email: string): boolean;
/**
 * Normalize an email to a canonical identity for grant-eligibility checks:
 * - lowercase + trim (all domains)
 * - gmail.com / googlemail.com ONLY: strip +alias, strip dots in the local
 *   part, and canonicalize the domain to gmail.com
 *   (u.s.e.r+x@googlemail.com → user@gmail.com)
 * - every other domain: the local part is treated LITERALLY — + and dots are
 *   significant (a+x@fastmail.com and a+y@fastmail.com are distinct identities)
 */
export declare function normalizeEmailIdentity(email: string): string;
/**
 * Atomically claim the free-grant slot for a normalized email identity.
 * INSERT … ON CONFLICT DO NOTHING against the UNIQUE "SignupIdentity" table —
 * the database is the arbiter, so concurrent signups for the same identity
 * cannot both win (no SELECT-then-INSERT race).
 *
 * Returns true if this identity claimed the grant (first claim), false if it
 * was already claimed. Fails OPEN (true) on unexpected DB errors so a guard
 * outage never blocks legitimate signups (per-IP cap + Agent-table checks
 * remain as defense-in-depth).
 */
export declare function claimSignupIdentity(email: string): Promise<boolean>;
/**
 * Enforce signup/free-grant limits. Returns null if the signup is allowed,
 * or an error descriptor { status, error, message } if it must be blocked.
 * Does NOT block a first legitimate signup.
 */
export declare function enforceSignupLimits(email: string, ip: string | undefined): Promise<{
    status: number;
    error: string;
    message: string;
} | null>;
/**
 * Set up the verification gate for a freshly-created agent:
 * moves `creditsToGate` into pendingCredits, issues a token, sends the email.
 * Non-fatal on email failure (token can be re-issued via /v1/verify-email/resend).
 *
 * The free-credit grant is gated by an ATOMIC claim on the normalized email
 * identity (SignupIdentity unique insert). If the identity already claimed a
 * grant, the signup still succeeds but 0 credits are gated.
 * Returns the number of credits actually gated.
 */
export declare function issueEmailVerification(agentId: string, email: string, creditsToGate: number): Promise<number>;
/**
 * Verify a token. Returns the credits activated, or null if invalid/expired.
 */
export declare function verifyEmailToken(token: string): Promise<{
    email: string;
    creditsActivated: number;
} | null>;
//# sourceMappingURL=verification.d.ts.map