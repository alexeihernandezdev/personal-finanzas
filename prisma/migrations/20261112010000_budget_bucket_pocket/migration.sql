-- AlterTable
ALTER TABLE "BudgetBucket" ADD COLUMN     "pocketId" TEXT;

-- AlterTable
ALTER TABLE "PocketMovement" ADD COLUMN     "sourceTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "PocketMovement_sourceTransactionId_idx" ON "PocketMovement"("sourceTransactionId");

-- AddForeignKey
ALTER TABLE "BudgetBucket" ADD CONSTRAINT "BudgetBucket_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PocketMovement" ADD CONSTRAINT "PocketMovement_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

