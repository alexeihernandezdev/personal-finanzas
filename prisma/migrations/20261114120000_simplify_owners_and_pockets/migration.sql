-- Simplificación: un movimiento es de un solo dueño, las partidas del presupuesto pasan a ser
-- apartados con porcentaje y los gastos fijos se pagan siempre del apartado "Gastos fijos".

-- ─── Movimientos: un solo dueño ─────────────────────────────────────────────
ALTER TABLE "Transaction" ADD COLUMN "businessId" TEXT;

-- Si un movimiento estaba dividido entre varios dueños, se queda con el de la parte más grande
UPDATE "Transaction" t
SET "businessId" = s."businessId"
FROM (
  SELECT DISTINCT ON ("transactionId") "transactionId", "businessId"
  FROM "TransactionSplit"
  ORDER BY "transactionId", "amount" DESC, "id"
) s
WHERE s."transactionId" = t."id";

CREATE INDEX "Transaction_businessId_idx" ON "Transaction"("businessId");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Partidas → apartados con porcentaje ────────────────────────────────────
ALTER TABLE "Pocket" ADD COLUMN "percent" DECIMAL(5,2);
ALTER TABLE "Business" ADD COLUMN "ownerPayPercent" DECIMAL(5,2);

-- Partida de un negocio que iba a la Caja Personal: es el sueldo del dueño
UPDATE "Business" b
SET "ownerPayPercent" = LEAST(100, s.total)
FROM (
  SELECT bb."businessId", SUM(bb."percent") AS total
  FROM "BudgetBucket" bb
  JOIN "Pocket" p ON p."id" = bb."pocketId"
  WHERE bb."businessId" IS NOT NULL AND p."isMain" AND p."businessId" IS NULL AND NOT p."archived"
  GROUP BY bb."businessId"
) s
WHERE s."businessId" = b."id";

-- Partida que iba a un apartado normal del mismo dueño: el apartado se lleva su porcentaje
UPDATE "Pocket" p
SET "percent" = LEAST(100, s.total)
FROM (
  SELECT bb."pocketId", SUM(bb."percent") AS total
  FROM "BudgetBucket" bb
  JOIN "Pocket" p2 ON p2."id" = bb."pocketId"
  WHERE NOT p2."isMain" AND NOT p2."isFixedReserve" AND NOT p2."archived"
    AND p2."businessId" IS NOT DISTINCT FROM bb."businessId"
  GROUP BY bb."pocketId"
) s
WHERE s."pocketId" = p."id";

-- El resto de partidas (sin apartado, con uno archivado, de otro dueño o de reserva) se vuelven
-- un apartado nuevo de su dueño, en la divisa de su Caja (o la del usuario). Las que iban a la
-- Caja de su propio dueño no hacen falta: lo que sobra ya se queda en la Caja.
INSERT INTO "Pocket" ("id", "userId", "currencyCode", "name", "kind", "businessId", "color", "percent", "createdAt")
SELECT
  'mig' || md5(bb."id"),
  bb."userId",
  COALESCE(
    (SELECT c."currencyCode" FROM "Pocket" c
     WHERE c."userId" = bb."userId" AND c."isMain" AND c."businessId" IS NOT DISTINCT FROM bb."businessId"
     ORDER BY c."createdAt" LIMIT 1),
    u."displayCurrency"
  ),
  bb."name",
  'SAVINGS',
  bb."businessId",
  bb."color",
  bb."percent",
  bb."createdAt"
FROM "BudgetBucket" bb
JOIN "User" u ON u."id" = bb."userId"
LEFT JOIN "Pocket" p ON p."id" = bb."pocketId"
WHERE NOT (
  -- ya migradas arriba
  (p."id" IS NOT NULL AND NOT p."archived" AND p."isMain" AND p."businessId" IS NULL AND bb."businessId" IS NOT NULL)
  OR (p."id" IS NOT NULL AND NOT p."archived" AND NOT p."isMain" AND NOT p."isFixedReserve"
      AND p."businessId" IS NOT DISTINCT FROM bb."businessId")
  -- iba a la Caja de su propio dueño
  OR (p."id" IS NOT NULL AND NOT p."archived" AND p."isMain" AND p."businessId" IS NOT DISTINCT FROM bb."businessId")
);

DROP TABLE "BudgetBucket";

-- ─── Los gastos fijos se pagan del apartado "Gastos fijos" de su dueño ──────
ALTER TABLE "RecurringExpense" DROP CONSTRAINT "RecurringExpense_pocketId_fkey";
ALTER TABLE "RecurringExpense" DROP COLUMN "pocketId";

DROP TABLE "TransactionSplit";
