/**
 * Upstream context window for session-message.
 *
 * Sessions store up to 50 messages of up to 10k chars each; sending all of it
 * upstream on every call is up to ~500k chars of provider input at a fixed
 * per-call price — a cost-abuse vector exploitable in a loop (audit
 * 2026-07-28). This trims what is SENT upstream; stored session history is
 * never modified.
 *
 * Rules:
 *  - keep the newest messages, dropping oldest-first once maxChars is exceeded
 *  - the newest message is always kept (even if it alone exceeds maxChars)
 *  - the window must open with a user turn (the Anthropic Messages API rejects
 *    assistant-first conversations), so a leading assistant message left
 *    behind by the cut — or by the 50-message history cap — is dropped
 *
 * Pure module — no imports, no side effects (unit-tested directly).
 */
export interface SessionContextMessage {
  role: "user" | "assistant";
  content: string;
}

export function trimSessionContext<T extends SessionContextMessage>(
  messages: T[],
  maxChars: number,
): { window: T[]; truncated: boolean } {
  let chars = 0;
  let start = messages.length;
  while (start > 0) {
    const next = chars + messages[start - 1].content.length;
    // The newest message is always included; older ones only while they fit.
    if (start < messages.length && next > maxChars) break;
    chars = next;
    start--;
  }
  let window = messages.slice(start);
  while (window.length > 1 && window[0].role !== "user") {
    window = window.slice(1);
  }
  return { window, truncated: window.length < messages.length };
}
