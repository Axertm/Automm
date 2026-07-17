-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketChannelId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "buyerDiscordId" TEXT NOT NULL,
    "sellerDiscordId" TEXT NOT NULL,
    "expectedAmount" TEXT NOT NULL,
    "feeBasisPointsSnapshot" INTEGER NOT NULL,
    "payoutAddress" TEXT,
    "payoutAddressConfirmedBySeller" BOOLEAN NOT NULL DEFAULT false,
    "buyerReleaseConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "payoutAddressOverriddenByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "payoutOverrideReason" TEXT,
    "payoutOverrideByDiscordId" TEXT,
    "frozenFromState" TEXT,
    "frozenReason" TEXT,
    "frozenByDiscordId" TEXT,
    "cancelReason" TEXT,
    "refundReason" TEXT,
    "refundAddress" TEXT,
    "payoutFeeTxId" TEXT,
    "payoutMainTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fundedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "derivationPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "completedFlag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "buyerCompletedRoleId" TEXT,
    "sellerCompletedRoleId" TEXT,
    "escrowCategoryId" TEXT,
    "feeWalletLtc" TEXT NOT NULL,
    "feeWalletSol" TEXT NOT NULL,
    "feeBasisPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildAdminRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "GuildAdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_ticketChannelId_key" ON "Deal"("ticketChannelId");

-- CreateIndex
CREATE INDEX "Deal_state_idx" ON "Deal"("state");

-- CreateIndex
CREATE INDEX "Deal_guildId_idx" ON "Deal"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_dealId_key" ON "Wallet"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_dealId_txid_direction_key" ON "Transaction"("dealId", "txid", "direction");

-- CreateIndex
CREATE INDEX "AuditEntry_dealId_idx" ON "AuditEntry"("dealId");

-- CreateIndex
CREATE INDEX "AuditEntry_createdAt_idx" ON "AuditEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Party_dealId_discordUserId_role_key" ON "Party"("dealId", "discordUserId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "GuildAdminRole_guildId_roleId_key" ON "GuildAdminRole"("guildId", "roleId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildAdminRole" ADD CONSTRAINT "GuildAdminRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE RESTRICT ON UPDATE CASCADE;

