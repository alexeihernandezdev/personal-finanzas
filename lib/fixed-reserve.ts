import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { nextDueDate, planFixedReserve } from "@/lib/budget";
import { convert, dec, Decimal, type DecimalLike } from "@/lib/money";
import { currentMonth, monthRange } from "@/lib/utils";

type Db = Prisma.TransactionClient | typeof prisma;

/** Clave de los gastos sin apartado ni Caja: no hay dónde reservarlos. */
export const NO_POCKET = "none";

const pocketSelect = { id: true, name: true, currencyCode: true, isMain: true, businessId: true } as const;

/** Apartado "Gastos fijos" de un dueño (Personal si `businessId` es null); lo crea si todavía no existe. */
export async function ensureFixedReservePocket(db: Db, userId: string, businessId: string | null, currency: string) {
  const found = await db.pocket.findFirst({
    where: { userId, businessId, isFixedReserve: true, archived: false },
    select: pocketSelect,
  });
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
 * Ingreso fijo y gastos fijos (sin colchón) de un dueño al mes, en `currency`. Los montos sin tasa
 * para convertir se omiten.
 */
export async function getMonthlyPlan(db: Db, userId: string, businessId: string | null, currency: string, rate: DecimalLike | null | undefined) {
  const [incomes, expenses, user] = await Promise.all([
    db.recurringIncome.findMany({ where: { userId, businessId, active: true }, select: { amount: true, currencyCode: true } }),
    db.recurringExpense.findMany({ where: { userId, businessId, active: true }, select: { amount: true, currencyCode: true } }),
    db.user.findUnique({ where: { id: userId }, select: { fixedBufferPercent: true } }),
  ]);
  const sum = (list: { amount: Prisma.Decimal; currencyCode: string }[]) =>
    list.reduce((acc, i) => {
      try {
        return acc.add(convert(i.amount, i.currencyCode, currency, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));
  return { income: sum(incomes), fixed: sum(expenses), bufferPercent: dec(user?.fixedBufferPercent) };
}

/**
 * Reserva de gastos fijos de un dueño: el próximo pago pendiente de cada gasto activo, de qué apartado
 * sale (el suyo o la Caja del dueño), cuánto cubre ya el saldo de ese apartado y cuánto falta
 * (con el colchón). `exclude` descuenta de un apartado un monto que acaba de entrar y aún no cuenta.
 */
export async function getFixedReserve(
  db: Db,
  userId: string,
  businessId: string | null,
  rate: DecimalLike | null | undefined,
  exclude?: { pocketId: string; amount: DecimalLike },
) {
  const month = currentMonth();
  const { start, end } = monthRange(month);
  const [expenses, caja, user] = await Promise.all([
    db.recurringExpense.findMany({
      where: { userId, businessId, active: true },
      include: {
        pocket: { select: { ...pocketSelect, archived: true } },
        _count: { select: { transactions: { where: { date: { gte: start, lt: end } } }, paidMarks: { where: { month } } } },
      },
    }),
    db.pocket.findFirst({ where: { userId, businessId, isMain: true, archived: false }, select: pocketSelect }),
    db.user.findUnique({ where: { id: userId }, select: { fixedBufferPercent: true } }),
  ]);

  const pockets = new Map<string, { id: string; name: string; currencyCode: string; isMain: boolean }>();
  if (caja) pockets.set(caja.id, caja);
  const rows = expenses.map((r) => {
    const pocket = r.pocket && !r.pocket.archived ? r.pocket : caja;
    if (pocket) pockets.set(pocket.id, pocket);
    let amount: Decimal | null = null;
    try {
      amount = convert(r.amount, r.currencyCode, pocket?.currencyCode ?? r.currencyCode, rate);
    } catch {
      // Sin tasa para convertir: no se puede reservar
    }
    return {
      id: r.id,
      name: r.name,
      pocketKey: pocket?.id ?? NO_POCKET,
      amount,
      dueDate: nextDueDate(r.dayOfMonth, month, r._count.transactions + r._count.paidMarks > 0),
    };
  });

  const ids = [...pockets.keys()];
  const sums = ids.length
    ? await db.pocketMovement.groupBy({ by: ["pocketId"], where: { pocketId: { in: ids } }, _sum: { amount: true } })
    : [];
  const balances = new Map<string, Decimal>(sums.map((s) => [s.pocketId, dec(s._sum.amount)]));
  if (exclude && balances.has(exclude.pocketId)) {
    balances.set(exclude.pocketId, balances.get(exclude.pocketId)!.sub(dec(exclude.amount)));
  }

  const valid = rows.filter((r): r is typeof r & { amount: Decimal } => r.amount !== null);
  const plan = planFixedReserve(valid, balances, user?.fixedBufferPercent ?? 0);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    caja,
    items: plan.items.map((i) => ({ ...i, name: byId.get(i.id)!.name, pocket: pockets.get(i.pocketKey) ?? null })),
    pockets: plan.pockets.map((p) => ({ ...p, pocket: pockets.get(p.key) ?? null })),
  };
}

export type FixedReserve = Awaited<ReturnType<typeof getFixedReserve>>;

/** Suma montos de los apartados de la reserva en `currency` (omite los que no se pueden convertir). */
export function sumInCurrency(
  values: { amount: Decimal; currencyCode: string | undefined }[],
  currency: string,
  rate: DecimalLike | null | undefined,
) {
  return values.reduce((acc, v) => {
    try {
      return acc.add(convert(v.amount, v.currencyCode ?? currency, currency, rate));
    } catch {
      return acc;
    }
  }, new Decimal(0));
}
