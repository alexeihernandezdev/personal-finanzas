import "server-only";
import { prisma } from "@/lib/db";
import { convert, type DecimalLike } from "@/lib/money";
import { getRatesForDates } from "@/lib/rates";
import { currentMonth, monthRange, todayISO, toISODate } from "@/lib/utils";

/** Los pagos de gastos fijos se convierten siempre con la tasa BCV del día del pago. */
const PAYMENT_RATE_SOURCE = "BCV" as const;

const createdDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" });

type RecurringLike = { id: string; userId: string; name: string; categoryId: string | null; businessId: string | null };

/**
 * Registra el pago de un gasto fijo como un gasto en la cuenta, convirtiendo el monto a la divisa
 * de la cuenta con la tasa BCV de la fecha del pago. Lanza un error si hace falta tasa y no hay.
 */
export async function recordRecurringPayment(
  r: RecurringLike,
  wallet: { id: string; currencyCode: string },
  amount: DecimalLike,
  amountCurrency: string,
  date: Date,
) {
  const rate = (await getRatesForDates([date], PAYMENT_RATE_SOURCE)).get(toISODate(date)) ?? null;
  const walletAmount = convert(amount, amountCurrency, wallet.currencyCode, rate).toDecimalPlaces(2).toString();
  return prisma.transaction.create({
    data: {
      userId: r.userId,
      walletId: wallet.id,
      type: "EXPENSE",
      amount: walletAmount,
      date,
      description: r.name,
      categoryId: r.categoryId,
      recurringId: r.id,
      rateVesPerUsd: rate?.toString() ?? null,
      rateSource: rate ? PAYMENT_RATE_SOURCE : null,
      splits: { create: [{ businessId: r.businessId, amount: walletAmount }] },
    },
  });
}

/**
 * Registra los gastos fijos automáticos (domiciliados) del mes actual que ya vencieron y aún no
 * tienen pago. Si se omite `userId` procesa todos los usuarios (para el cron).
 * Devuelve cuántos pagos se registraron.
 */
export async function processAutoPayments(userId?: string) {
  const month = currentMonth();
  const { start, end } = monthRange(month);
  const today = todayISO();
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const items = await prisma.recurringExpense.findMany({
    where: {
      ...(userId ? { userId } : {}),
      active: true,
      autoPay: true,
      walletId: { not: null },
      transactions: { none: { date: { gte: start, lt: end } } },
    },
    include: { wallet: { select: { id: true, currencyCode: true } } },
  });

  let created = 0;
  for (const r of items) {
    if (!r.wallet) continue;
    const dueDate = new Date(Date.UTC(y, m - 1, Math.min(r.dayOfMonth, daysInMonth)));
    const due = toISODate(dueDate);
    // Aún no vence, o venció antes de crear el gasto fijo (ese mes ya se habría pagado aparte)
    if (due > today || due < createdDay.format(r.createdAt)) continue;
    try {
      await recordRecurringPayment(r, r.wallet, r.amount, r.currencyCode, dueDate);
      created++;
    } catch {
      // Sin tasa para convertir: se reintenta en la próxima ejecución
    }
  }
  return created;
}
