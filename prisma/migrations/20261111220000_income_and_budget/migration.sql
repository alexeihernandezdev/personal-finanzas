-- CreateTable
CREATE TABLE "RecurringIncome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "walletId" TEXT,
    "categoryId" TEXT,
    "businessId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetBucket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringIncome_userId_idx" ON "RecurringIncome"("userId");

-- CreateIndex
CREATE INDEX "BudgetBucket_userId_idx" ON "BudgetBucket"("userId");

-- AddForeignKey
ALTER TABLE "RecurringIncome" ADD CONSTRAINT "RecurringIncome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringIncome" ADD CONSTRAINT "RecurringIncome_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringIncome" ADD CONSTRAINT "RecurringIncome_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringIncome" ADD CONSTRAINT "RecurringIncome_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetBucket" ADD CONSTRAINT "BudgetBucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
