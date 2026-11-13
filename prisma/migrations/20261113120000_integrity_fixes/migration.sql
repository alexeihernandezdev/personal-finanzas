-- Movimientos de apartados que quedaron huérfanos al borrar cuentas: su movimiento de origen ya no
-- existe (sourceTransactionId pasó a null). Se reconocen por la entrada que abrió su grupo
-- ("Ingreso: …", "Gasto: …", préstamos, cobros y pagos); los traspasos entre apartados no la tienen.
DELETE FROM "PocketMovement" WHERE "groupId" IN (
  SELECT "groupId" FROM "PocketMovement"
  WHERE "groupId" IS NOT NULL AND "sourceTransactionId" IS NULL
    AND "description" ~ '^(Ingreso: |Gasto: |Préstamo a |Préstamo de |Devolución de |Cobro: |Pago: |Pago de préstamo a )'
);
-- Repartos manuales de un ingreso que ya no existe
DELETE FROM "PocketMovement"
WHERE "groupId" IS NULL AND "sourceTransactionId" IS NULL AND "description" LIKE 'Presupuesto: %';

-- Los movimientos de apartados se borran con el movimiento que los originó
ALTER TABLE "PocketMovement" DROP CONSTRAINT "PocketMovement_sourceTransactionId_fkey";
ALTER TABLE "PocketMovement" ADD CONSTRAINT "PocketMovement_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Frecuencia de los ingresos fijos
ALTER TABLE "RecurringIncome" ADD COLUMN "intervalMonths" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "startMonth" TEXT;
