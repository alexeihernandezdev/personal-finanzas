-- El apartado deja de estar ligado a una cuenta: conserva solo la divisa
ALTER TABLE "Pocket" ADD COLUMN "currencyCode" TEXT;

UPDATE "Pocket" p SET "currencyCode" = w."currencyCode" FROM "Wallet" w WHERE w."id" = p."walletId";

ALTER TABLE "Pocket" ALTER COLUMN "currencyCode" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "Pocket" DROP CONSTRAINT "Pocket_walletId_fkey";

-- DropIndex
DROP INDEX "Pocket_walletId_idx";

-- AlterTable
ALTER TABLE "Pocket" DROP COLUMN "walletId";
