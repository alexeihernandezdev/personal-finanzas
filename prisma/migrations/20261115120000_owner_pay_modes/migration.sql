-- Sueldo del dueño de un negocio: monto fijo al mes o % de la ganancia del mes.
-- CreateEnum
CREATE TYPE "OwnerPayMode" AS ENUM ('NONE', 'FIXED', 'PROFIT_PERCENT');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "ownerPayAmount" DECIMAL(20,8),
ADD COLUMN     "ownerPayCurrency" TEXT,
ADD COLUMN     "ownerPayMode" "OwnerPayMode" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "OwnerPay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPay_businessId_month_key" ON "OwnerPay"("businessId", "month");

-- AddForeignKey
ALTER TABLE "OwnerPay" ADD CONSTRAINT "OwnerPay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPay" ADD CONSTRAINT "OwnerPay_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- El sueldo que ya era un % de cada ingreso pasa a ser un % de la ganancia
UPDATE "Business" SET "ownerPayMode" = 'PROFIT_PERCENT' WHERE "ownerPayPercent" > 0;
