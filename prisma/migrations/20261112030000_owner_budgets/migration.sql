-- Presupuesto por dueño (Personal = NULL o un negocio)
ALTER TABLE "BudgetBucket" ADD COLUMN "businessId" TEXT;
CREATE INDEX "BudgetBucket_businessId_idx" ON "BudgetBucket"("businessId");
ALTER TABLE "BudgetBucket" ADD CONSTRAINT "BudgetBucket_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Caja de cada dueño
ALTER TABLE "Pocket" ADD COLUMN "isMain" BOOLEAN NOT NULL DEFAULT false;

-- Movimientos de apartado agrupados por operación
ALTER TABLE "PocketMovement" ADD COLUMN "groupId" TEXT;
CREATE INDEX "PocketMovement_groupId_idx" ON "PocketMovement"("groupId");
