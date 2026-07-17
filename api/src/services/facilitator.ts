/**
 * Facilitator-as-a-Service — Core Service
 *
 * This is the "AWS play" — Arch Tools becomes the infrastructure layer.
 * Other API providers use OUR facilitator instead of running their own.
 *
 * What a facilitator does:
 *   1. VERIFY: Validate an x402 payment payload (signature, amount, nonce, expiry)
 *   2. SETTLE: Submit the validated payment to the blockchain
 *   3. COLLECT FEE: Take a small % fee from each transaction
 *
 * Uses viem (already in dependency tree via @x402 packages).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Chain,
  parseAbi,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet, arbitrum, polygon, optimism, avalanche } from "viem/chains";
import { redis } from "../lib/redis.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentPayload {
  scheme: string;
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
    token?: Address;
  };
}

export interface VerifyRequest {
  payment: string;
  paymentDetails: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    payTo: string;
    asset: string;
    maxTimeoutSeconds?: number;
  };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
}

export interface SettleRequest {
  payment: string;
  paymentDetails: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    payTo: string;
    asset: string;
  };
}

export interface SettleResponse {
  success: boolean;
  txHash?: string;
  network?: string;
  errorMessage?: string;
}

// ─── Network Configuration ────────────────────────────────────────────────────

const CHAIN_MAP: Record<string, Chain> = {
  "eip155:8453":  base,
  "eip155:84532": baseSepolia,
  "eip155:1":     mainnet,
  "eip155:42161": arbitrum,
  "eip155:137":   polygon,
  "eip155:10":    optimism,
  "eip155:43114": avalanche,
};

const RPC_OVERRIDES: Record<string, string> = {
  "eip155:8453":  process.env.BASE_RPC_URL       || "",
  "eip155:84532": process.env.BASE_SEPOLIA_RPC    || "",
  "eip155:1":     process.env.ETH_RPC_URL         || "",
  "eip155:42161": process.env.ARBITRUM_RPC_URL     || "",
  "eip155:137":   process.env.POLYGON_RPC_URL      || "",
  "eip155:10":    process.env.OPTIMISM_RPC_URL     || "",
  "eip155:43114": process.env.AVALANCHE_RPC_URL    || "",
};

const USDC_CONTRACTS: Record<string, Address> = {
  "eip155:8453":  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:1":     "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "eip155:137":   "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  "eip155:10":    "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "eip155:43114": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};

// EIP-3009 ABI (minimal)
const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) external",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

function getPublicClient(networkId: string) {
  const chain = CHAIN_MAP[networkId];
  if (!chain) return null;
  const rpcOverride = RPC_OVERRIDES[networkId];
  return createPublicClient({
    chain,
    transport: http(rpcOverride || undefined),
  });
}

// ─── Nonce Deduplication ──────────────────────────────────────────────────────

const NONCE_TTL = 24 * 60 * 60;

// In-memory fallback dedup (same-process). This is safe only for immediate
// verify-then-settle flows; standalone /verify must use shared storage because
// providers may serve content before settlement consumes the on-chain nonce.
const memFacilitatorNonces = new Map<string, number>();
function memCheckFacilitatorNonce(key: string): boolean {
  const now = Date.now();
  if (memFacilitatorNonces.size > 50_000) {
    for (const [k, exp] of memFacilitatorNonces) if (exp <= now) memFacilitatorNonces.delete(k);
  }
  const existing = memFacilitatorNonces.get(key);
  if (existing && existing > now) return false; // replay
  memFacilitatorNonces.set(key, now + NONCE_TTL * 1000);
  return true;
}

type RedisNonceClient = { set: (...args: any[]) => Promise<any> } | null;
export type FacilitatorNonceStatus = "new" | "replay" | "unavailable";

export async function reserveNonce(
  nonce: string,
  providerId: string,
  options: { allowLocalFallback?: boolean; redisClient?: RedisNonceClient } = {},
): Promise<FacilitatorNonceStatus> {
  const key = `facilitator:nonce:${providerId}:${nonce}`;
  const redisClient = options.redisClient === undefined ? redis : options.redisClient;
  const useLocalFallback = () => (
    options.allowLocalFallback ? (memCheckFacilitatorNonce(key) ? "new" : "replay") : "unavailable"
  );

  if (!redisClient) return useLocalFallback();

  try {
    const result = await redisClient.set(key, "1", "EX", NONCE_TTL, "NX");
    return result === "OK" ? "new" : "replay";
  } catch {
    return useLocalFallback();
  }
}

export async function checkNonce(nonce: string, providerId: string): Promise<boolean> {
  return (await reserveNonce(nonce, providerId, { allowLocalFallback: true })) === "new";
}

export async function releaseNonce(nonce: string, providerId: string): Promise<void> {
  if (!redis) return;
  await redis.del(`facilitator:nonce:${providerId}:${nonce}`).catch(() => {});
}

// ─── Payment Decoding ─────────────────────────────────────────────────────────

export function decodePayment(paymentB64: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(paymentB64, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    if (!parsed.scheme || !parsed.network || !parsed.payload) return null;
    if (!parsed.payload.signature || !parsed.payload.authorization) return null;

    const auth = parsed.payload.authorization;
    if (!auth.from || !auth.to || !auth.value || !auth.nonce) return null;

    return parsed as PaymentPayload;
  } catch {
    return null;
  }
}

// ─── Verification ─────────────────────────────────────────────────────────────

export async function verifyPayment(
  paymentB64: string,
  paymentDetails: VerifyRequest["paymentDetails"],
  providerId: string,
  options: { allowLocalNonceFallback?: boolean } = {},
): Promise<VerifyResponse> {
  // 1. Decode
  const payment = decodePayment(paymentB64);
  if (!payment) {
    return { isValid: false, invalidReason: "malformed_payment_payload" };
  }

  // 2. Network support
  if (!CHAIN_MAP[payment.network]) {
    return { isValid: false, invalidReason: `unsupported_network: ${payment.network}` };
  }

  // 3. Scheme match
  if (payment.scheme !== paymentDetails.scheme) {
    return { isValid: false, invalidReason: "scheme_mismatch" };
  }

  // 4. Network match
  if (payment.network !== paymentDetails.network) {
    return { isValid: false, invalidReason: "network_mismatch" };
  }

  const auth = payment.payload.authorization;

  // 5. Amount check
  const paymentAmount = BigInt(auth.value);
  const requiredAmount = BigInt(paymentDetails.maxAmountRequired);
  if (paymentAmount < requiredAmount) {
    return { isValid: false, invalidReason: `insufficient_amount: got ${auth.value}, need ${paymentDetails.maxAmountRequired}` };
  }

  // 6. Recipient match
  if (auth.to.toLowerCase() !== paymentDetails.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "recipient_mismatch" };
  }

  // 7. Time validity
  const now = Math.floor(Date.now() / 1000);
  if (now < parseInt(auth.validAfter, 10)) {
    return { isValid: false, invalidReason: "payment_not_yet_valid" };
  }
  if (now > parseInt(auth.validBefore, 10)) {
    return { isValid: false, invalidReason: "payment_expired" };
  }

  // 8. Nonce replay. Standalone /verify must fail closed if shared nonce
  // storage is unavailable; otherwise another instance could approve the same
  // still-unsettled payment and a provider might serve twice before /settle.
  const nonceStatus = await reserveNonce(auth.nonce, providerId, {
    allowLocalFallback: options.allowLocalNonceFallback === true,
  });
  if (nonceStatus === "unavailable") {
    return { isValid: false, invalidReason: "replay_protection_unavailable" };
  }
  if (nonceStatus === "replay") {
    return { isValid: false, invalidReason: "nonce_already_used" };
  }

  // 9. On-chain checks
  const client = getPublicClient(payment.network);
  if (client) {
    const tokenAddress = (USDC_CONTRACTS[payment.network] || paymentDetails.asset) as Address;
    const isToken = tokenAddress && tokenAddress !== "0x0000000000000000000000000000000000000000";

    if (isToken) {
      try {
        // Balance check
        const balance = await client.readContract({
          address: tokenAddress,
          abi: EIP3009_ABI,
          functionName: "balanceOf",
          args: [auth.from],
        });
        if (BigInt(balance as bigint) < paymentAmount) {
          await releaseNonce(auth.nonce, providerId);
          return { isValid: false, invalidReason: "insufficient_balance" };
        }
      } catch (err) {
        // Pre-flight balance check is an optimization only — settlement reverts
        // on insufficient balance — so a transient RPC failure must not reject a
        // valid payer. Warn and proceed; settle is authoritative.
        console.warn(`[facilitator] Balance check skipped (RPC):`, (err as Error).message?.slice(0, 100));
      }

      try {
        // On-chain nonce check
        const nonceUsed = await client.readContract({
          address: tokenAddress,
          abi: EIP3009_ABI,
          functionName: "authorizationState",
          args: [auth.from, auth.nonce as Hex],
        });
        if (nonceUsed) {
          await releaseNonce(auth.nonce, providerId);
          return { isValid: false, invalidReason: "nonce_consumed_onchain" };
        }
      } catch {
        // authorizationState pre-check is best-effort (not all tokens expose it,
        // and RPC can blip). Settlement reverts on a consumed nonce, so proceed.
      }
    }
  }

  // 10. EIP-712 signature verification
  try {
    const chainId = parseInt(payment.network.split(":")[1], 10);
    const tokenAddress = (USDC_CONTRACTS[payment.network] || paymentDetails.asset) as Address;

    let tokenName = "USD Coin";
    let tokenVersion = "2";

    if (client) {
      try {
        tokenName = await client.readContract({ address: tokenAddress, abi: EIP3009_ABI, functionName: "name" }) as string;
        tokenVersion = await client.readContract({ address: tokenAddress, abi: EIP3009_ABI, functionName: "version" }) as string;
      } catch { /* use defaults */ }
    }

    const valid = await verifyTypedData({
      address: auth.from,
      domain: {
        name: tokenName,
        version: tokenVersion,
        chainId: BigInt(chainId),
        verifyingContract: tokenAddress,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as Hex,
      },
      signature: payment.payload.signature,
    });

    if (!valid) {
      await releaseNonce(auth.nonce, providerId);
      return { isValid: false, invalidReason: "invalid_signature" };
    }
  } catch (err) {
    // FAIL CLOSED: a thrown error (RPC failure, malformed signature, bad token
    // metadata) must NOT be treated as a valid signature. Previously this swallowed
    // the error and returned isValid:true, letting forged authorizations through.
    console.warn(`[facilitator] Sig verification failed:`, (err as Error).message?.slice(0, 200));
    await releaseNonce(auth.nonce, providerId);
    return { isValid: false, invalidReason: "signature_verification_failed" };
  }

  return { isValid: true };
}

// ─── Settlement ───────────────────────────────────────────────────────────────

export async function settlePayment(
  paymentB64: string,
  paymentDetails: SettleRequest["paymentDetails"],
): Promise<SettleResponse> {
  const payment = decodePayment(paymentB64);
  if (!payment) {
    return { success: false, errorMessage: "malformed_payment_payload" };
  }

  const chain = CHAIN_MAP[payment.network];
  if (!chain) {
    return { success: false, errorMessage: `unsupported_network: ${payment.network}` };
  }

  const facilitatorPk = process.env.FACILITATOR_PRIVATE_KEY as Hex | undefined;
  if (!facilitatorPk) {
    return { success: false, errorMessage: "facilitator_not_configured: missing FACILITATOR_PRIVATE_KEY" };
  }

  try {
    const account = privateKeyToAccount(facilitatorPk);
    const rpcOverride = RPC_OVERRIDES[payment.network];

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcOverride || undefined),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcOverride || undefined),
    });

    const tokenAddress = (USDC_CONTRACTS[payment.network] || paymentDetails.asset) as Address;
    if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") {
      return { success: false, errorMessage: "native_token_settlement_not_supported" };
    }

    const auth = payment.payload.authorization;

    // Execute transferWithAuthorization
    const txHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [
        auth.from,
        auth.to,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce as Hex,
        payment.payload.signature,
      ],
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      timeout: 30_000,
    });

    if (receipt.status === "success") {
      return { success: true, txHash, network: payment.network };
    } else {
      return { success: false, txHash, errorMessage: "transaction_reverted" };
    }
  } catch (err) {
    const message = (err as Error).message || "";

    if (message.includes("insufficient funds")) {
      return { success: false, errorMessage: "facilitator_insufficient_gas" };
    }
    if (message.includes("authorization is used") || message.includes("AuthorizationUsed")) {
      return { success: false, errorMessage: "nonce_already_consumed" };
    }

    return { success: false, errorMessage: `settlement_failed: ${message.slice(0, 200)}` };
  }
}

// ─── Fee Calculation ──────────────────────────────────────────────────────────

/** Default fee from env (FACILITATOR_FEE_PERCENT), falls back to 2.5% */
export function getDefaultFeePercent(): number {
  return parseFloat(process.env.FACILITATOR_FEE_PERCENT ?? "2.5");
}

export function calculateFee(amountAtomic: string, feePercent: number): string {
  const amount = BigInt(amountAtomic);
  const feeBps = Math.round(feePercent * 100);
  const fee = (amount * BigInt(feeBps)) / BigInt(10000);
  return fee.toString();
}

/** Calculate what the provider receives after fee deduction */
export function calculateProviderPayout(amountAtomic: string, feePercent: number): { fee: string; payout: string } {
  const amount = BigInt(amountAtomic);
  const feeBps = Math.round(feePercent * 100);
  const fee = (amount * BigInt(feeBps)) / BigInt(10000);
  const payout = amount - fee;
  return { fee: fee.toString(), payout: payout.toString() };
}

// ─── Supported Networks ───────────────────────────────────────────────────────

export function getSupportedNetworks(): Array<{ network: string; name: string; token: string }> {
  return [
    { network: "eip155:8453",  name: "Base",      token: "USDC" },
    { network: "eip155:84532", name: "Base Sepolia (testnet)", token: "USDC" },
    { network: "eip155:1",     name: "Ethereum",  token: "USDC" },
    { network: "eip155:42161", name: "Arbitrum",   token: "USDC" },
    { network: "eip155:137",   name: "Polygon",    token: "USDC" },
    { network: "eip155:10",    name: "Optimism",   token: "USDC" },
    { network: "eip155:43114", name: "Avalanche",  token: "USDC" },
  ];
}
