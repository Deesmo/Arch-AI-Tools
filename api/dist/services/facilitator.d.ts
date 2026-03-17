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
import { type Address, type Hex } from "viem";
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
export declare function checkNonce(nonce: string, providerId: string): Promise<boolean>;
export declare function releaseNonce(nonce: string, providerId: string): Promise<void>;
export declare function decodePayment(paymentB64: string): PaymentPayload | null;
export declare function verifyPayment(paymentB64: string, paymentDetails: VerifyRequest["paymentDetails"], providerId: string): Promise<VerifyResponse>;
export declare function settlePayment(paymentB64: string, paymentDetails: SettleRequest["paymentDetails"]): Promise<SettleResponse>;
/** Default fee from env (FACILITATOR_FEE_PERCENT), falls back to 2.5% */
export declare function getDefaultFeePercent(): number;
export declare function calculateFee(amountAtomic: string, feePercent: number): string;
/** Calculate what the provider receives after fee deduction */
export declare function calculateProviderPayout(amountAtomic: string, feePercent: number): {
    fee: string;
    payout: string;
};
export declare function getSupportedNetworks(): Array<{
    network: string;
    name: string;
    token: string;
}>;
//# sourceMappingURL=facilitator.d.ts.map