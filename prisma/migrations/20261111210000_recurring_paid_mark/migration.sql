-- CreateTable
CREATE TABLE "RecurringPaidMark" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringPaidMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPaidMark_recurringId_month_key" ON "RecurringPaidMark"("recurringId", "month");

-- AddForeignKey
ALTER TABLE "RecurringPaidMark" ADD CONSTRAINT "RecurringPaidMark_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
