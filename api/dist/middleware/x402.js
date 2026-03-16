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
import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { redis } from "../lib/redis.js";
// USDC contract addresses by network (native USDC, not bridged)
const USDC_CONTRACTS = {
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    unichain: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    monad: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
};
// Solana USDC mint address (native USDC on Solana mainnet)
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// USDT contract addresses by network (Tether)
const USDT_CONTRACTS = {
    ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    optimism: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
};
// Aptos native USDC token address (Circle native, launched Jan 2025)
const APTOS_USDC_ADDRESS = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
// Per-tool pricing in USDC (string to avoid float issues)
export const X402_PRICES = {
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
    "html-to-markdown": "0.003",
    "url-shorten": "0.001",
    "webhook-send": "0.002",
    "jsonpath-query": "0.001",
    "image-generate": "0.030",
    "barcode-generate": "0.002",
    "workflow-agent": "0.025",
    "crypto-price": "0.001",
    "crypto-ohlcv": "0.002",
    "crypto-market-cap": "0.001",
    "crypto-fear-greed": "0.001",
    "crypto-sentiment": "0.002",
    "crypto-news": "0.002",
    "token-lookup": "0.001",
    "ai-oracle": "0.025",
    "session-create": "0.005",
    "session-message": "0.020",
    "text-to-speech": "0.010",
    "transcribe-audio": "0.012",
    "email-send": "0.003",
    "design-create": "0.030",
    "domain-check": "0.002",
    "news-search": "0.003",
    "research-report": "0.015",
    "fact-check": "0.010",
};
function buildPaymentRequired(toolName, price) {
    const network = config.x402.network;
    const chainId = network === "base" ? "eip155:8453" : "eip155:84532";
    const usdcContract = USDC_CONTRACTS[network] ?? USDC_CONTRACTS["base"];
    // Convert price to USDC atomic units (6 decimals)
    const amountAtomic = Math.round(parseFloat(price) * 1_000_000).toString();
    const resource = `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}`;
    const evmWallet = config.x402.walletAddress;
    const accepts = [];
    // Option 1: USDC on Coinbase Base (EVM L2 — fast, cheap)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: chainId,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Base)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["base"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 2: USDC on Ethereum mainnet (same EVM wallet address)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:1",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Ethereum)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["ethereum"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 3: USDC on Arbitrum (same EVM wallet, fast + cheap L2)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:42161",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Arbitrum)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["arbitrum"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 4: USDC on Polygon (same EVM wallet)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:137",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Polygon)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["polygon"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 5: USDC on Optimism (same EVM wallet)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:10",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Optimism)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["optimism"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 6: USDC on Avalanche C-Chain (same EVM wallet)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:43114",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Avalanche)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["avalanche"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 7: USDC on Solana
    const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
    if (solanaWallet) {
        accepts.push({
            scheme: "exact",
            network: "solana:mainnet",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Solana)`,
            mimeType: "application/json",
            payTo: solanaWallet,
            maxTimeoutSeconds: 60,
            asset: SOLANA_USDC_MINT,
            extra: { name: "USD Coin", version: "spl" },
        });
    }
    // Option 8: USDC on Noble (Cosmos native USDC issuance chain — IBC to 50+ Cosmos chains)
    const nobleWallet = process.env.NOBLE_WALLET_ADDRESS;
    if (nobleWallet) {
        accepts.push({
            scheme: "exact",
            network: "cosmos:noble-1",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Noble/Cosmos)`,
            mimeType: "application/json",
            payTo: nobleWallet,
            maxTimeoutSeconds: 60,
            asset: "uusdc",
            extra: { name: "USD Coin", version: "cosmos-ibc" },
        });
    }
    // Option 9: USDC on Algorand (ASA ID 31566704, native Circle USDC)
    const algorandWallet = process.env.ALGORAND_WALLET_ADDRESS;
    if (algorandWallet) {
        accepts.push({
            scheme: "exact",
            network: "algorand:mainnet",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Algorand)`,
            mimeType: "application/json",
            payTo: algorandWallet,
            maxTimeoutSeconds: 60,
            asset: "31566704",
            extra: { name: "USD Coin", version: "asa" },
        });
    }
    // Option 10: USDC on Stellar (native USDC, 17-sec settlement — MEMO REQUIRED for Coinbase)
    const stellarWallet = process.env.STELLAR_WALLET_ADDRESS;
    const stellarMemo = process.env.STELLAR_WALLET_MEMO;
    if (stellarWallet) {
        accepts.push({
            scheme: "exact",
            network: "stellar:pubnet",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Stellar)`,
            mimeType: "application/json",
            payTo: stellarWallet,
            maxTimeoutSeconds: 60,
            asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            extra: { name: "USD Coin", version: "stellar", memo: stellarMemo ?? "" },
        });
    }
    // Option 11: USDC on Sui (Move-based L1, native USDC via Circle CCTP)
    const suiWallet = process.env.SUI_WALLET_ADDRESS;
    if (suiWallet) {
        accepts.push({
            scheme: "exact",
            network: "sui:mainnet",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Sui)`,
            mimeType: "application/json",
            payTo: suiWallet,
            maxTimeoutSeconds: 60,
            asset: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
            extra: { name: "USD Coin", version: "sui-move" },
        });
    }
    // Option 12: USDC on Unichain (Uniswap's OP-Stack L2, chain ID 130, native USDC)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:130",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Unichain)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["unichain"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 13: USDC on Monad (EVM-compatible high-perf L1, chain ID 143)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:143",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Monad)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["monad"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 14: USDC on Polkadot Asset Hub (asset ID 1337, Circle native USDC, XCM to all parachains)
    const polkadotWallet = process.env.POLKADOT_WALLET_ADDRESS;
    if (polkadotWallet) {
        accepts.push({
            scheme: "exact",
            network: "polkadot:asset-hub",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Polkadot)`,
            mimeType: "application/json",
            payTo: polkadotWallet,
            maxTimeoutSeconds: 120,
            asset: "1337",
            extra: { name: "USD Coin", version: "asset-hub" },
        });
    }
    // Option 15: USDC on Aptos (Move-based L1, native USDC since Jan 2025)
    const aptosWallet = process.env.APTOS_WALLET_ADDRESS;
    if (aptosWallet) {
        accepts.push({
            scheme: "exact",
            network: "aptos:mainnet",
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Aptos)`,
            mimeType: "application/json",
            payTo: aptosWallet,
            maxTimeoutSeconds: 60,
            asset: APTOS_USDC_ADDRESS,
            extra: { name: "USD Coin", version: "aptos-fa" },
        });
    }
    // Native ETH — agents holding ETH can pay directly (fixed pricing per tier)
    const ethWallet = process.env.ETH_WALLET_ADDRESS;
    if (ethWallet) {
        // ETH pricing tiers (in wei, ~$2500/ETH): basic=0.0000004, mid=0.000004, heavy=0.000008
        const ethPriceFloat = parseFloat(price);
        let ethWei;
        if (ethPriceFloat <= 0.002)
            ethWei = "400000000000"; // ~$0.001
        else if (ethPriceFloat <= 0.005)
            ethWei = "800000000000"; // ~$0.002
        else if (ethPriceFloat <= 0.010)
            ethWei = "2000000000000"; // ~$0.005
        else if (ethPriceFloat <= 0.020)
            ethWei = "4000000000000"; // ~$0.010
        else
            ethWei = "8000000000000"; // ~$0.020
        // ETH on Ethereum mainnet
        accepts.push({
            scheme: "exact",
            network: "eip155:1",
            maxAmountRequired: ethWei,
            resource,
            description: `Arch Tools — ${toolName} (native ETH on Ethereum)`,
            mimeType: "application/json",
            payTo: ethWallet,
            maxTimeoutSeconds: 300,
            asset: "0x0000000000000000000000000000000000000000",
            extra: { name: "Ether", version: "native" },
        });
        // ETH on Base (same wallet, faster + cheaper)
        accepts.push({
            scheme: "exact",
            network: "eip155:8453",
            maxAmountRequired: ethWei,
            resource,
            description: `Arch Tools — ${toolName} (native ETH on Base)`,
            mimeType: "application/json",
            payTo: ethWallet,
            maxTimeoutSeconds: 60,
            asset: "0x0000000000000000000000000000000000000000",
            extra: { name: "Ether", version: "native-base" },
        });
    }
    // Native BNB on BNB Smart Chain (chain ID 56)
    const bnbWallet = process.env.BNB_WALLET_ADDRESS;
    if (bnbWallet) {
        const bnbPriceFloat = parseFloat(price);
        let bnbWei;
        if (bnbPriceFloat <= 0.002)
            bnbWei = "1600000000000"; // ~$0.001 at ~$600/BNB
        else if (bnbPriceFloat <= 0.005)
            bnbWei = "3200000000000";
        else if (bnbPriceFloat <= 0.010)
            bnbWei = "8000000000000";
        else if (bnbPriceFloat <= 0.020)
            bnbWei = "16000000000000";
        else
            bnbWei = "32000000000000";
        accepts.push({
            scheme: "exact",
            network: "eip155:56",
            maxAmountRequired: bnbWei,
            resource,
            description: `Arch Tools — ${toolName} (native BNB on BNB Chain)`,
            mimeType: "application/json",
            payTo: bnbWallet,
            maxTimeoutSeconds: 60,
            asset: "0x0000000000000000000000000000000000000000",
            extra: { name: "BNB", version: "native" },
        });
    }
    // Native NEAR on NEAR Protocol — #1 AI-agent blockchain, 24 decimals (yoctoNEAR), ~$4/NEAR
    const nearWallet = process.env.NEAR_WALLET_ADDRESS;
    if (nearWallet) {
        const nearPriceFloat = parseFloat(price);
        let yoctoNear;
        if (nearPriceFloat <= 0.002)
            yoctoNear = "250000000000000000000"; // 0.00025 NEAR ~$0.001
        else if (nearPriceFloat <= 0.005)
            yoctoNear = "750000000000000000000";
        else if (nearPriceFloat <= 0.010)
            yoctoNear = "1500000000000000000000";
        else if (nearPriceFloat <= 0.020)
            yoctoNear = "3000000000000000000000";
        else
            yoctoNear = "6000000000000000000000";
        accepts.push({
            scheme: "exact",
            network: "near:mainnet",
            maxAmountRequired: yoctoNear,
            resource,
            description: `Arch Tools — ${toolName} (NEAR token)`,
            mimeType: "application/json",
            payTo: nearWallet,
            maxTimeoutSeconds: 120,
            asset: "near",
            extra: { name: "NEAR Protocol", version: "native", decimals: "24" },
        });
    }
    // Native SOL on Solana mainnet (~$150/SOL, 9 decimals / lamports)
    const solNativeWallet = process.env.SOL_NATIVE_WALLET_ADDRESS;
    if (solNativeWallet) {
        const solPriceFloat = parseFloat(price);
        let lamports;
        if (solPriceFloat <= 0.002)
            lamports = "7000"; // ~0.000007 SOL ~$0.001
        else if (solPriceFloat <= 0.005)
            lamports = "17000";
        else if (solPriceFloat <= 0.010)
            lamports = "35000";
        else if (solPriceFloat <= 0.020)
            lamports = "70000";
        else
            lamports = "140000";
        accepts.push({
            scheme: "exact",
            network: "solana:mainnet",
            maxAmountRequired: lamports,
            resource,
            description: `Arch Tools — ${toolName} (native SOL)`,
            mimeType: "application/json",
            payTo: solNativeWallet,
            maxTimeoutSeconds: 60,
            asset: "native",
            extra: { name: "Solana", version: "native", decimals: "9" },
        });
    }
    // uSOL (bridged SOL on Base via Coinbase/CCIP, ERC-20, 9 decimals, ~$150/SOL)
    const solBaseWallet = process.env.SOL_BASE_WALLET_ADDRESS;
    if (solBaseWallet) {
        const solPriceFloat = parseFloat(price);
        let solAtomic;
        if (solPriceFloat <= 0.002)
            solAtomic = "7000"; // 0.000007 SOL ~$0.001
        else if (solPriceFloat <= 0.005)
            solAtomic = "17000";
        else if (solPriceFloat <= 0.010)
            solAtomic = "35000";
        else if (solPriceFloat <= 0.020)
            solAtomic = "70000";
        else
            solAtomic = "140000";
        accepts.push({
            scheme: "exact",
            network: "eip155:8453",
            maxAmountRequired: solAtomic,
            resource,
            description: `Arch Tools — ${toolName} (SOL on Base)`,
            mimeType: "application/json",
            payTo: solBaseWallet,
            maxTimeoutSeconds: 60,
            asset: "0x311935cd80b76769bf2ecc9d8ab7635b2139cf82",
            extra: { name: "Solana (Base)", version: "usol-erc20", decimals: "9" },
        });
    }
    // TAO (Bittensor) — AI-native blockchain, 9 decimals (Rao), ~$400/TAO
    const taoWallet = process.env.TAO_WALLET_ADDRESS;
    if (taoWallet) {
        const taoPriceFloat = parseFloat(price);
        let taoRao;
        if (taoPriceFloat <= 0.002)
            taoRao = "2500"; // 0.0000025 TAO ~$0.001
        else if (taoPriceFloat <= 0.005)
            taoRao = "6250";
        else if (taoPriceFloat <= 0.010)
            taoRao = "12500";
        else if (taoPriceFloat <= 0.020)
            taoRao = "25000";
        else
            taoRao = "62500";
        accepts.push({
            scheme: "exact",
            network: "bittensor:finney",
            maxAmountRequired: taoRao,
            resource,
            description: `Arch Tools — ${toolName} (TAO on Bittensor)`,
            mimeType: "application/json",
            payTo: taoWallet,
            maxTimeoutSeconds: 120,
            asset: "TAO",
            extra: { name: "Bittensor", version: "native", decimals: "9" },
        });
    }
    // UNI (Uniswap governance token) on Ethereum — ~$10/UNI, 18 decimals
    const uniWallet = process.env.UNI_WALLET_ADDRESS;
    if (uniWallet) {
        const uniPriceFloat = parseFloat(price);
        let uniAtomic;
        if (uniPriceFloat <= 0.002)
            uniAtomic = "100000000000000"; // 0.0001 UNI ~$0.001
        else if (uniPriceFloat <= 0.005)
            uniAtomic = "300000000000000";
        else if (uniPriceFloat <= 0.010)
            uniAtomic = "700000000000000";
        else if (uniPriceFloat <= 0.020)
            uniAtomic = "1400000000000000";
        else
            uniAtomic = "2500000000000000";
        accepts.push({
            scheme: "exact",
            network: "eip155:1",
            maxAmountRequired: uniAtomic,
            resource,
            description: `Arch Tools — ${toolName} (UNI on Ethereum)`,
            mimeType: "application/json",
            payTo: uniWallet,
            maxTimeoutSeconds: 60,
            asset: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
            extra: { name: "Uniswap", version: "erc20" },
        });
    }
    // USDT options — Tether (higher market cap than USDC, widely held by trading agents)
    const usdtWallet = process.env.USDT_ETH_WALLET_ADDRESS;
    if (usdtWallet) {
        const usdtNetworks = [
            { network: "eip155:1", chain: "ethereum" },
            { network: "eip155:42161", chain: "arbitrum" },
            { network: "eip155:137", chain: "polygon" },
            { network: "eip155:10", chain: "optimism" },
            { network: "eip155:43114", chain: "avalanche" },
            { network: "eip155:8453", chain: "base" },
        ];
        for (const { network, chain } of usdtNetworks) {
            if (USDT_CONTRACTS[chain]) {
                accepts.push({
                    scheme: "exact",
                    network,
                    maxAmountRequired: amountAtomic,
                    resource,
                    description: `Arch Tools — ${toolName} (USDT on ${chain.charAt(0).toUpperCase() + chain.slice(1)})`,
                    mimeType: "application/json",
                    payTo: usdtWallet,
                    maxTimeoutSeconds: 60,
                    asset: USDT_CONTRACTS[chain],
                    extra: { name: "Tether USD", version: "2" },
                });
            }
        }
    }
    return {
        x402Version: 1,
        accepts,
        error: "X-PAYMENT-REQUIRED",
    };
}
/**
 * Extract a nonce from the X-Payment header payload.
 * The x402 payment header is a base64-encoded JSON object. We extract the
 * `nonce` field (if present) for replay-attack prevention.
 */
function extractNonce(paymentHeader) {
    try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
        const payload = JSON.parse(decoded);
        const nonce = payload["nonce"];
        if (typeof nonce === "string" && nonce.length > 0)
            return nonce;
        // Some implementations nest under payload.payload
        const inner = payload["payload"];
        if (inner && typeof inner === "object") {
            const innerNonce = inner["nonce"];
            if (typeof innerNonce === "string" && innerNonce.length > 0)
                return innerNonce;
        }
        return null;
    }
    catch {
        return null;
    }
}
const NONCE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
/**
 * Check whether a nonce has been seen before (replay attack detection).
 * Returns true if the nonce is NEW (safe to proceed), false if already used.
 * If Redis is unavailable, falls back to allowing the request (non-blocking).
 */
async function checkAndStoreNonce(nonce) {
    if (!redis) {
        console.warn("[x402] Redis not configured — nonce deduplication disabled. Set REDIS_URL to enable replay protection.");
        return true; // allow but warn
    }
    const key = `x402:nonce:${nonce}`;
    // SET key "1" NX EX <ttl> — atomic: set only if not exists, returns null if already exists
    const result = await redis.set(key, "1", "EX", NONCE_TTL_SECONDS, "NX");
    return result === "OK"; // "OK" = new nonce stored; null = already existed (replay)
}
async function verifyPayment(paymentHeader, toolName) {
    if (!config.x402.facilitatorUrl)
        return false;
    try {
        const res = await axios.post(`${config.x402.facilitatorUrl}/verify`, { payment: paymentHeader, resource: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}` }, { timeout: 8000 });
        return res.data?.isValid === true;
    }
    catch {
        return false;
    }
}
async function settlePayment(paymentHeader, toolName) {
    if (!config.x402.facilitatorUrl)
        return null;
    try {
        const res = await axios.post(`${config.x402.facilitatorUrl}/settle`, { payment: paymentHeader, resource: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}` }, { timeout: 10000 });
        return res.data?.txHash ?? null;
    }
    catch {
        return null;
    }
}
/**
 * x402 middleware — attach to any tool route.
 * Checks for X-Payment header; if missing + no valid API key, returns 402.
 * If X-Payment present, verifies with facilitator and logs payment.
 */
export function x402Middleware(toolName) {
    return async (req, res, next) => {
        // If wallet address not configured, skip x402 (Stripe-only mode)
        if (!config.x402.walletAddress) {
            next();
            return;
        }
        const paymentHeader = req.headers["x-payment"];
        // No payment header — check if they have a valid API key with credits
        if (!paymentHeader) {
            const authHeader = req.headers.authorization;
            const apiKey = req.headers["x-api-key"];
            if (authHeader?.startsWith("Bearer ") || apiKey) {
                // Let auth middleware handle it (API key or Bearer token)
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
        // Security: extract and deduplicate nonce to prevent replay attacks.
        // A valid x402 payment header MUST include a `nonce` field.
        const nonce = extractNonce(paymentHeader);
        if (!nonce) {
            res.status(402).json({
                ok: false,
                error: "payment_nonce_missing",
                message: "x402 payment header must include a unique nonce field to prevent replay attacks.",
            });
            return;
        }
        const isNewNonce = await checkAndStoreNonce(nonce);
        if (!isNewNonce) {
            res.status(402).json({
                ok: false,
                error: "payment_replay_detected",
                message: "x402 nonce has already been used. Each payment must have a unique nonce.",
            });
            return;
        }
        // Payment header present — verify with facilitator
        const isValid = await verifyPayment(paymentHeader, toolName);
        if (!isValid) {
            // Nonce was already stored — clean it up on verification failure so the agent
            // can retry with the same nonce after fixing their payment header.
            if (redis)
                await redis.del(`x402:nonce:${nonce}`).catch(() => { });
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
        }
        catch {
            // Non-fatal — don't block the request
        }
        // Mark request as x402-paid so tool handler can skip credit check
        req.x402Paid = true;
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
        }
        catch {
            // Non-fatal
        }
        next();
    };
}
//# sourceMappingURL=x402.js.map