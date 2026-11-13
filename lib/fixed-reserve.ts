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
 * parte de cada mes (anual / 12…). Los sueldos fijos de los negocios son un gasto fijo del negocio
 * (`ownerSalary`, sin colchón) y un ingreso fijo de Personal (`salaries`). `fixedWithBuffer`: gastos
 * fijos con colchón más el sueldo. Los montos sin tasa para convertir se omiten.
 */
export async function getMonthlyPlan(db: Db, userId: string, businessId: string | null, currency: string, rate: DecimalLike | null | undefined) {
  // En secuencia: `db` puede ser una transacción, que no admite consultas en paralelo
  const select = { amount: true, currencyCode: true, intervalMonths: true } as const;
  const incomes = await db.recurringIncome.findMany({ where: { userId, businessId, active: true }, select });
  const expenses = await db.recurringExpense.findMany({ where: { userId, businessId, active: true }, select });
  const user = await db.user.findUnique({ where: { id: userId }, select: { fixedBufferPercent: true } });
  const salaried = await db.business.findMany({
    where: { userId, ownerPayMode: "FIXED", ...(businessId ? { id: businessId } : { archived: false }) },
    select: { name: true, ownerPayAmount: true, ownerPayCurrency: true },
  });
  const toCurrency = (amount: DecimalLike, from: string) => {
    try {
      return convert(amount, from, currency, rate);
    } catch {
      return new Decimal(0);
    }
  };
  const sum = (list: { amount: Prisma.Decimal; currencyCode: string; intervalMonths: number }[]) =>
    list.reduce((acc, i) => acc.add(toCurrency(i.amount, i.currencyCode).div(Math.max(1, i.intervalMonths))), new Decimal(0));
  const salaries = salaried
    .filter((b) => b.ownerPayAmount?.gt(0))
    .map((b) => ({ name: b.name, amount: toCurrency(b.ownerPayAmount!, b.ownerPayCurrency ?? currency) }));
  const salaryTotal = salaries.reduce((acc, s) => acc.add(s.amount), new Decimal(0));
  const fixed = sum(expenses);
  const bufferPercent = dec(user?.fixedBufferPercent);
  const ownerSalary = businessId ? salaryTotal : new Decimal(0);
  return {
    income: sum(incomes).add(businessId ? 0 : salaryTotal),
    fixed,
    bufferPercent,
    /** Sueldo fijo que el negocio le paga a su dueño */
    ownerSalary,
    /** Sueldos fijos de los negocios que cuentan como ingreso fijo de Personal */
    salaries: businessId ? [] : salaries,
    fixedWithBuffer: fixed.mul(new Decimal(100).add(bufferPercent)).div(100).add(ownerSalary),
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
