-- AlterTable
ALTER TABLE "BudgetBucket" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Conserva el orden que se mostraba hasta ahora (mayor porcentaje primero)
UPDATE "BudgetBucket" b SET "position" = o.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "percent" DESC, "createdAt" ASC) - 1 AS rn
  FROM "BudgetBucket"
) o
WHERE b."id" = o."id";
