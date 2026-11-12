-- Reserva de gastos fijos: cada gasto fijo indica de qué apartado se paga
ALTER TABLE "RecurringExpense" ADD COLUMN "pocketId" TEXT;
ALTER TABLE "Pocket" ADD COLUMN "isFixedReserve" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_pocketId_fkey" FOREIGN KEY ("pocketId") REFERENCES "Pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
