-- Facilitator-as-a-Service: Let other API providers use Arch Tools as their x402 facilitator

-- Providers who register to use our facilitator
CREATE TABLE "FacilitatorProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "api_key_hash" TEXT,
    "wallet_address" TEXT NOT NULL,
    "webhook_url" TEXT,
    "feePercent" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "networks" TEXT[] DEFAULT ARRAY['eip155:8453']::TEXT[],
    "endpoints" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "total_payments" INTEGER NOT NULL DEFAULT 0,
    "total_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilitatorProvider_pkey" PRIMARY KEY ("id")
);

-- Payments processed through our facilitator
CREATE TABLE "FacilitatorPayment" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "payment_payload" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT 'USDC',
    "network" TEXT NOT NULL DEFAULT 'eip155:8453',
    "payer_address" TEXT,
    "tx_hash" TEXT,
    "fee_amount" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "error_message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilitatorPayment_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "FacilitatorProvider_email_key" ON "FacilitatorProvider"("email");
CREATE UNIQUE INDEX "FacilitatorProvider_api_key_key" ON "FacilitatorProvider"("api_key");
CREATE INDEX "FacilitatorProvider_api_key_idx" ON "FacilitatorProvider"("api_key");
CREATE INDEX "FacilitatorProvider_email_idx" ON "FacilitatorProvider"("email");

CREATE INDEX "FacilitatorPayment_provider_id_idx" ON "FacilitatorPayment"("provider_id");
CREATE INDEX "FacilitatorPayment_status_idx" ON "FacilitatorPayment"("status");
CREATE INDEX "FacilitatorPayment_tx_hash_idx" ON "FacilitatorPayment"("tx_hash");
CREATE INDEX "FacilitatorPayment_createdAt_idx" ON "FacilitatorPayment"("createdAt");

-- Foreign key
ALTER TABLE "FacilitatorPayment" ADD CONSTRAINT "FacilitatorPayment_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "FacilitatorProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
