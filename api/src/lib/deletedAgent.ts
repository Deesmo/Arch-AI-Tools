/**
 * Deleted accounts are anonymized in-place so retained Purchase/X402 rows keep
 * their foreign-key integrity. This predicate is the durable "disabled" marker
 * for those anonymized Agent rows: deletion clears every credential and rewrites
 * the email into the reserved deleted.invalid domain.
 */
export function isDeletedAgent(agent: {
  email?: string | null;
  apiKeyHash?: string | null;
  apiKeyPrefix?: string | null;
  passwordHash?: string | null;
} | null | undefined): boolean {
  if (!agent) return false;
  return Boolean(
    agent.email?.endsWith("@deleted.invalid") &&
    !agent.apiKeyHash &&
    !agent.apiKeyPrefix &&
    !agent.passwordHash
  );
}
