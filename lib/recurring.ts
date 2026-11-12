import "server-only";
import { prisma } from "@/lib/db";
import { dueDateInMonth, isDueInMonth } from "@/lib/budget";
import { convert, type DecimalLike } from "@/lib/money";
import { applyTransactionToPockets, AUTO_POCKET } from "@/lib/pockets";
import { getRatesForDates } from "@/lib/rates";
import { currentMonth, monthRange, todayISO, toISODate } from "@/lib/utils";

/** Los pagos de gastos fijos se convierten siempre con la tasa BCV del día del pago. */
const PAYMENT_RATE_SOURCE = "BCV" as const;

const createdDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" });

type RecurringLike = { id: string; userId: string; name: string; categoryId: string | null; businessId: string | null };

/**
 * Registra el pago de un gasto fijo como un gasto en la cuenta, convirtiendo el monto a la divisa
 * de la cuenta con la tasa BCV de la fecha del pago, y lo saca del apartado `pocketId`
 * ("auto" = Caja de su dueño; vacío = ninguno). Lanza un error si hace falta tasa y no hay.
 */
export async function recordRecurringPayment(
  r: RecurringLike,
  wallet: { id: string; currencyCode: string },
  amount: DecimalLike,
  amountCurrency: string,
  date: Date,
  pocketId?: string,
) {
  const rate = (await getRatesForDates([date], PAYMENT_RATE_SOURCE)).get(toISODate(date)) ?? null;
  const walletAmount = convert(amount, amountCurrency, wallet.currencyCode, rate).toDecimalPlaces(2).toString();
  return prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
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
    await applyTransactionToPockets(tx, {
      userId: r.userId,
      transactionId: created.id,
      type: "EXPENSE",
      amount: walletAmount,
      currency: wallet.currencyCode,
      date,
      label: r.name,
      splits: [{ businessId: r.businessId, amount: walletAmount }],
      pocketId,
      distribute: false,
      rate,
      cajaCurrency: wallet.currencyCode,
    });
    return created;
  });
}

/**
 * Registra los gastos fijos automáticos (domiciliados) que vencen el mes actual, ya vencieron y aún no
 * tienen pago. Si se omite `userId` procesa todos los usuarios (para el cron).
 * Devuelve cuántos pagos se registraron.
 */
export async function processAutoPayments(userId?: string) {
  const month = currentMonth();
  const { start, end } = monthRange(month);
  const today = todayISO();

  const items = await prisma.recurringExpense.findMany({
    where: {
      ...(userId ? { userId } : {}),
      active: true,
      autoPay: true,
      walletId: { not: null },
      transactions: { none: { date: { gte: start, lt: end } } },
      paidMarks: { none: { month } },
    },
    include: { wallet: { select: { id: true, currencyCode: true } } },
  });

  let created = 0;
  for (const r of items) {
    if (!r.wallet || !isDueInMonth(r, month)) continue;
    const dueDate = dueDateInMonth(r.dayOfMonth, month);
    const due = toISODate(dueDate);
    // Aún no vence, o venció antes de crear el gasto fijo (ese mes ya se habría pagado aparte)
    if (due > today || due < createdDay.format(r.createdAt)) continue;
    try {
      // Sale de su reserva de gastos fijos (o de la Caja de su dueño)
      await recordRecurringPayment(r, r.wallet, r.amount, r.currencyCode, dueDate, r.pocketId ?? AUTO_POCKET);
      created++;
    } catch {
      // Sin tasa para convertir: se reintenta en la próxima ejecución
    }
  }
  return created;
}
