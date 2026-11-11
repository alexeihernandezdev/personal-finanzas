-- CreateEnum
CREATE TYPE "PocketKind" AS ENUM ('SAVINGS', 'GOAL', 'EMERGENCY', 'RESERVE');

-- CreateTable
CREATE TABLE "Pocket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PocketKind" NOT NULL DEFAULT 'SAVINGS',
    "businessId" TEXT,
    "targetAmount" DECIMAL(20,8),
    "targetDate" DATE,
    "color" TEXT NOT NULL DEFAULT '#0f766e',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pocket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PocketMovement" (
    "id" TEXT NOT NULL,
    "pocketId" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PocketMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pocket_userId_idx" ON "Pocket"("userId");

-- CreateIndex
CREATE INDEX "Pocket_walletId_idx" ON "Pocket"("walletId");

-- CreateIndex
CREATE INDEX "PocketMovement_pocketId_idx" ON "PocketMovement"("pocketId");

-- AddForeignKey
ALTER TABLE "Pocket" ADD CONSTRAINT "Pocket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pocket" ADD CONSTRAINT "Pocket_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pocket" ADD CONSTRAINT "Pocket_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PocketMovement" ADD CONSTRAINT "PocketMovement_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

