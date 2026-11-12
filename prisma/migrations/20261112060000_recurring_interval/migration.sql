-- AlterTable
ALTER TABLE "RecurringExpense" ADD COLUMN     "intervalMonths" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "startMonth" TEXT;
