export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  adminKey: process.env.ADMIN_KEY ?? "changeme",
  publicSiteUrl: process.env.PUBLIC_SITE_URL ?? "https://archtools.dev",
  corsOrigin: (process.env.CORS_ORIGIN ?? "https://archtools.dev").split(",").map(s => s.trim()),
  freeMonthlyCredits: parseInt(process.env.FREE_MONTHLY_CREDITS ?? "1000", 10),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY ?? "",
  },
  xai: {
    apiKey: process.env.XAI_API_KEY ?? "",
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
  },
  coingecko: {
    apiKey: process.env.COINGECKO_API_KEY ?? "",
  },
  cdp: {
    apiKeyId: process.env.CDP_API_KEY_ID ?? "",
    apiKeySecret: process.env.CDP_API_KEY_SECRET ?? "",
    projectId: process.env.CDP_PROJECT_ID ?? "",
  },
  redisUrl: process.env.REDIS_URL ?? "",
  x402: {
    // Only use wallet address if it looks like a real Ethereum/Base address (0x + 40 hex chars)
    walletAddress: /^0x[a-fA-F0-9]{40}$/.test(process.env.WALLET_ADDRESS ?? "") ? (process.env.WALLET_ADDRESS ?? "") : "",
    network: process.env.X402_NETWORK ?? "base",
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://api.cdp.coinbase.com/platform/v2/x402",
  },
  facilitator: {
    feePercent: parseFloat(process.env.FACILITATOR_FEE_PERCENT ?? "2.5"),
  },
  rateLimits: {
    free: parseInt(process.env.RATE_LIMIT_FREE ?? "60", 10),
    pro: parseInt(process.env.RATE_LIMIT_PRO ?? "300", 10),
    business: parseInt(process.env.RATE_LIMIT_BUSINESS ?? "1000", 10),
  },
};
