import jwt from "jsonwebtoken";

// Browser sign-in sessions (the arch_session cookie). Kept out of routes/auth.ts
// so middleware can verify a session without importing a router whose module
// load refuses to start when JWT_SECRET is unset.
const SESSION_TTL_JWT = "7d";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export function signSession(agentId: string): string {
  return jwt.sign({ sub: agentId }, secret(), { expiresIn: SESSION_TTL_JWT });
}

export function verifySession(token: string): { sub: string } | null {
  try {
    // Pin the algorithm so a token cannot be presented with a different/none alg.
    return jwt.verify(token, secret(), { algorithms: ["HS256"] }) as { sub: string };
  } catch {
    return null;
  }
}
