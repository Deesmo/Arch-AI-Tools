export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  adminKey: process.env.ADMIN_KEY ?? "changeme",
  publicSiteUrl: process.env.PUBLIC_SITE_URL ?? "https://archtools.dev",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  freeMonthlyCredits: parseInt(process.env.FREE_MONTHLY_CREDITS ?? "100", 10),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
  },
  x402: {
    walletAddress: process.env.WALLET_ADDRESS ?? "",
    network: process.env.X402_NETWORK ?? "base",
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
  },
  rateLimits: {
    free: parseInt(process.env.RATE_LIMIT_FREE ?? "60", 10),
    pro: parseInt(process.env.RATE_LIMIT_PRO ?? "300", 10),
    business: parseInt(process.env.RATE_LIMIT_BUSINESS ?? "1000", 10),
  },
};
