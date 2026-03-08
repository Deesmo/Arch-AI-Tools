/**
 * x402 Payment Middleware — v15
 *
 * Implements the Coinbase x402 protocol for HTTP-native USDC payments.
 * AI agents that don't have pre-purchased credits can pay per-call with USDC on Base.
 *
 * Flow:
 *   1. Agent hits /v1/tools/:tool with no API key (or insufficient credits)
 *   2. Server returns 402 with x-payment-details header
 *   3. Agent signs USDC payment, retries request with X-Payment header
 *   4. Middleware verifies payment with facilitator, then allows request through
 *
 * Official package: npm install x402-express (swap this in for production if preferred)
 */

import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { prisma } from "../lib/prisma";
import { config } from "../config";

// USDC contract addresses by network
const USDC_CONTRACTS: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// Per-tool pricing in USDC (string to avoid float issues)
export const X402_PRICES: Record<string, string> = {
  "validate-data": "0.001",
  "generate-hash": "0.001",
  "qr-code": "0.002",
  "convert-format": "0.002",
  "transform-text": "0.003",
  "extract-metadata": "0.003",
  "web-scrape": "0.005",
  "extract-page": "0.005",
  "search-web": "0.005",
  "rss-parse": "0.004",
  "ip-lookup": "0.002",
  "whois-lookup": "0.003",
  "email-verify": "0.003",
  "phone-validate": "0.002",
  "currency-convert": "0.002",
  "timezone-convert": "0.001",
  "generate-uuid": "0.001",
  "diff-text": "0.002",
  "readability-score": "0.002",
  "language-detect": "0.003",
  "sentiment-analysis": "0.008",
  "summarize": "0.010",
  "extract-entities": "0.008",
  "regex-generate": "0.008",
  "pii-detect": "0.010",
  "web-search": "0.010",
  "ai-generate": "0.020",
  "ocr-extract": "0.010",
  "browser-task": "0.010",
  "extract-pdf": "0.006",
  "screenshot-capture": "0.010",
  "html-to-markdown": "0.002",
  "url-shorten": "0.001",
  "webhook-send": "0.002",
  "jsonpath-query": "0.001",
  "image-generate": "0.015",
  "barcode-generate": "0.002",
  "workflow-agent": "0.025",
  "crypto-price": "0.001",
  "crypto-ohlcv": "0.002",
  "crypto-market-cap": "0.001",
  "crypto-fear-greed": "0.001",
  "crypto-sentiment": "0.002",
  "crypto-news": "0.002",
  "token-lookup": "0.001",
};

function buildPaymentRequired(toolName: string, price: string): object {
  const network = config.x402.network;
  const chainId = network === "base" ? "eip155:8453" : "eip155:84532";
  const usdcContract = USDC_CONTRACTS[network] ?? USDC_CONTRACTS["base"];
  // Convert price to USDC atomic units (6 decimals)
  const amountAtomic = Math.round(parseFloat(price) * 1_000_000).toString();

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: chainId,
        maxAmountRequired: amountAtomic,
        resource: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}`,
        description: `Arch Tools — ${toolName}`,
        mimeType: "application/json",
        payTo: config.x402.walletAddress,
        maxTimeoutSeconds: 60,
        asset: usdcContract,
        extra: {
          name: "USD Coin",
          version: "2",
        },
      },
    ],
    error: "X-PAYMENT-REQUIRED",
  };
}

async function verifyPayment(paymentHeader: string, toolName: string): Promise<boolean> {
  if (!config.x402.facilitatorUrl) return false;
  try {
    const res = await axios.post(
      `${config.x402.facilitatorUrl}/verify`,
      { payment: paymentHeader, resource: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}` },
      { timeout: 8000 }
    );
    return res.data?.isValid === true;
  } catch {
    return false;
  }
}

async function settlePayment(paymentHeader: string, toolName: string): Promise<string | null> {
  if (!config.x402.facilitatorUrl) return null;
  try {
    const res = await axios.post(
      `${config.x402.facilitatorUrl}/settle`,
      { payment: paymentHeader, resource: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}` },
      { timeout: 10000 }
    );
    return res.data?.txHash ?? null;
  } catch {
    return null;
  }
}

/**
 * x402 middleware — attach to any tool route.
 * Checks for X-Payment header; if missing + no valid API key, returns 402.
 * If X-Payment present, verifies with facilitator and logs payment.
 */
export function x402Middleware(toolName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // If wallet address not configured, skip x402 (Stripe-only mode)
    if (!config.x402.walletAddress) {
      next();
      return;
    }

    const paymentHeader = req.headers["x-payment"] as string | undefined;

    // No payment header — check if they have a valid API key with credits
    if (!paymentHeader) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        // Let auth middleware handle it
        next();
        return;
      }

      // Return 402 Payment Required
      const price = X402_PRICES[toolName] ?? "0.005";
      res.status(402)
        .header("Content-Type", "application/json")
        .header("Access-Control-Expose-Headers", "X-Payment-Required")
        .json(buildPaymentRequired(toolName, price));
      return;
    }

    // Payment header present — verify with facilitator
    const isValid = await verifyPayment(paymentHeader, toolName);
    if (!isValid) {
      res.status(402).json({
        ok: false,
        error: "payment_invalid",
        message: "x402 payment verification failed",
      });
      return;
    }

    // Settle payment
    const txHash = await settlePayment(paymentHeader, toolName);
    const price = X402_PRICES[toolName] ?? "0.005";

    // Log the x402 payment
    try {
      await prisma.x402Payment.create({
        data: {
          toolName,
          amountUsdc: price,
          txHash: txHash ?? undefined,
          network: config.x402.network,
          status: "settled",
        },
      });
    } catch {
      // Non-fatal — don't block the request
    }

    // Mark request as x402-paid so tool handler can skip credit check
    (req as Request & { x402Paid?: boolean }).x402Paid = true;

    // Log x402 tool call to ApiRequest for admin stats visibility
    try {
      await prisma.apiRequest.create({
        data: {
          agentId: "x402_anonymous",
          toolName,
          creditsUsed: 0,
          status: "SUCCESS",
          callerType: "x402",
          callerName: "x402-payment",
        },
      });
    } catch {
      // Non-fatal
    }

    next();
  };
}
