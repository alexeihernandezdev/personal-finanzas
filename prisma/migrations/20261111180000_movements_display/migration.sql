-- AlterTable
ALTER TABLE "User" ADD COLUMN     "movementsCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "movementsRateSource" "RateSource" NOT NULL DEFAULT 'BCV';
