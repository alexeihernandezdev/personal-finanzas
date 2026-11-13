import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { convert, dec, Decimal, type DecimalLike } from "@/lib/money";
import { currentMonth, monthRange } from "@/lib/utils";

type Db = Prisma.TransactionClient | typeof prisma;

const pocketSelect = { id: true, name: true, currencyCode: true, isMain: true, businessId: true } as const;

/** Apartado "Gastos fijos" de un dueño (Personal si `businessId` es null), sin crearlo. */
export function findFixedReservePocket(db: Db, userId: string, businessId: string | null) {
  return db.pocket.findFirst({
    where: { userId, businessId, isFixedReserve: true, archived: false },
    select: pocketSelect,
  });
}

/** Apartado "Gastos fijos" de un dueño (Personal si `businessId` es null); lo crea si todavía no existe. */
export async function ensureFixedReservePocket(db: Db, userId: string, businessId: string | null, currency: string) {
  const found = await findFixedReservePocket(db, userId, businessId);
  if (found) return found;
  const business = businessId ? await db.business.findFirst({ where: { id: businessId, userId } }) : null;
  return db.pocket.create({
    data: {
      userId,
      businessId,
      currencyCode: currency,
      name: business ? `Gastos fijos ${business.name}` : "Gastos fijos",
      kind: "RESERVE",
      isFixedReserve: true,
      color: "#64748b",
    },
    select: pocketSelect,
  });
}

/**
 * Ingreso fijo y gastos fijos de un dueño al mes, en `currency`. Los que no son mensuales cuentan su
 * parte de cada mes (anual / 12…). `fixedWithBuffer` incluye el colchón. Los montos sin tasa para
 * convertir se omiten.
 */
export async function getMonthlyPlan(db: Db, userId: string, businessId: string | null, currency: string, rate: DecimalLike | null | undefined) {
  // En secuencia: `db` puede ser una transacción, que no admite consultas en paralelo
  const select = { amount: true, currencyCode: true, intervalMonths: true } as const;
  const incomes = await db.recurringIncome.findMany({ where: { userId, businessId, active: true }, select });
  const expenses = await db.recurringExpense.findMany({ where: { userId, businessId, active: true }, select });
  const user = await db.user.findUnique({ where: { id: userId }, select: { fixedBufferPercent: true } });
  const sum = (list: { amount: Prisma.Decimal; currencyCode: string; intervalMonths: number }[]) =>
    list.reduce((acc, i) => {
      try {
        return acc.add(convert(i.amount, i.currencyCode, currency, rate).div(Math.max(1, i.intervalMonths)));
      } catch {
        return acc;
      }
    }, new Decimal(0));
  const fixed = sum(expenses);
  const bufferPercent = dec(user?.fixedBufferPercent);
  return {
    income: sum(incomes),
    fixed,
    bufferPercent,
    fixedWithBuffer: fixed.mul(new Decimal(100).add(bufferPercent)).div(100),
  };
}

/** Lo que entró a un apartado en `month` (yyyy-mm), en su divisa. */
export async function receivedInMonth(db: Db, pocketId: string, month = currentMonth()) {
  const { start, end } = monthRange(month);
  const { _sum } = await db.pocketMovement.aggregate({
    where: { pocketId, amount: { gt: 0 }, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  return dec(_sum.amount);
}
