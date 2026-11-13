"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { getCollectionCategoryId } from "@/lib/defaults";
import { assertOwned, OwnershipError, rateForDate } from "@/lib/guards";
import { convert, dec, formatMoney } from "@/lib/money";
import { applyTransactionToPockets, pocketFailure } from "@/lib/pockets";
import { collectedAmount, currentFallbackRate } from "@/lib/queries";
import { recomputeReceivableStatus } from "@/lib/receivables";
import { parseISODate, todayISO } from "@/lib/utils";
import { paymentSchema, receivableSchema } from "@/lib/validators";

export async function createReceivable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = receivableSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  try {
    await assertOwned(user.id, { walletIds: [d.walletId], businessIds: [d.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Cuenta o negocio inválido");
    throw e;
  }

  // Tasa del día del préstamo (o de hoy si es una cuenta por cobrar)
  const rate = await rateForDate(user.preferredRateSource, d.date ?? todayISO());
  /** Lo registrado en bolívares se guarda en dólares, a la tasa del día. */
  const inUsd = (currency: string) =>
    currency === "VES"
      ? rate.rateVesPerUsd
        ? { amount: convert(d.amount, "VES", "USD", rate.rateVesPerUsd).toDecimalPlaces(2).toString(), currencyCode: "USD" }
        : null
      : { amount: d.amount, currencyCode: currency };

  if (d.kind === "LOAN_GIVEN") {
    // Un préstamo saca el dinero de una cuenta (en su divisa); lo que te deben queda en dólares.
    if (!d.walletId) return fail("Elige la cuenta de la que sale el dinero prestado");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: d.walletId } });
    const owed = inUsd(wallet.currencyCode);
    if (!owed) return fail("No hay tasa del día para pasar el préstamo a dólares");
    const date = parseISODate(d.date ?? todayISO());
    const description = `Préstamo a ${d.counterparty}`;
    try {
      await prisma.$transaction(async (tx) => {
        const receivable = await tx.receivable.create({
          data: {
            userId: user.id,
            kind: "LOAN_GIVEN",
            counterparty: d.counterparty,
            description: d.description ?? "",
            ...owed,
            expectedDate: d.expectedDate ? parseISODate(d.expectedDate) : null,
            businessId: d.businessId ?? null,
            transactions: {
              create: { userId: user.id, walletId: wallet.id, type: "LOAN_OUT", amount: d.amount, date, description, businessId: d.businessId ?? null, ...rate },
            },
          },
          include: { transactions: { select: { id: true } } },
        });
        // El dinero prestado sale del apartado elegido
        await applyTransactionToPockets(tx, {
          userId: user.id,
          transactionId: receivable.transactions[0].id,
          type: "EXPENSE",
          amount: d.amount,
          currency: wallet.currencyCode,
          date,
          label: d.counterparty,
          description,
          businessId: d.businessId ?? null,
          pocketId: d.pocketId,
          distribute: false,
          rate: rate.rateVesPerUsd,
          cajaCurrency: user.displayCurrency,
        });
      });
    } catch (e) {
      return pocketFailure(e);
    }
  } else {
    const owed = inUsd(d.currencyCode);
    if (!owed) return fail("No hay tasa del día para pasar el monto a dólares");
    await prisma.receivable.create({
      data: {
        userId: user.id,
        kind: "RECEIVABLE",
        counterparty: d.counterparty,
        description: d.description ?? "",
        ...owed,
        expectedDate: d.expectedDate ? parseISODate(d.expectedDate) : null,
        businessId: d.businessId ?? null,
      },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: d.kind === "LOAN_GIVEN" ? "Préstamo registrado" : "Cuenta por cobrar registrada" };
}

export async function registerPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = paymentSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const [r, wallet] = await Promise.all([
    prisma.receivable.findFirst({
      where: { id: d.receivableId, userId: user.id },
      include: { transactions: { include: { wallet: { select: { currencyCode: true } } } } },
    }),
    prisma.wallet.findFirst({ where: { id: d.walletId, userId: user.id } }),
  ]);
  if (!r || !wallet) return fail("Registro no encontrado");
  if (r.status === "CANCELLED" || r.status === "SETTLED") return fail("Este registro ya está cerrado");

  const isLoan = r.kind === "LOAN_GIVEN";
  const rate = await rateForDate(user.preferredRateSource, d.date);
  const date = parseISODate(d.date);

  // No se puede cobrar más de lo que falta
  const collected = collectedAmount(
    { currencyCode: r.currencyCode, transactions: r.transactions },
    await currentFallbackRate(),
  );
  const remaining = dec(r.amount).sub(collected);
  let inRecord;
  try {
    inRecord = convert(d.amount, wallet.currencyCode, r.currencyCode, rate.rateVesPerUsd);
  } catch {
    return fail("No hay tasa disponible para comparar el cobro con lo pendiente");
  }
  if (inRecord.toDecimalPlaces(2).gt(remaining.toDecimalPlaces(2).add("0.01"))) {
    return fail(`Solo faltan ${formatMoney(remaining, r.currencyCode)} por cobrar`);
  }
  const categoryId = isLoan ? null : await getCollectionCategoryId(user.id);
  const description = isLoan
    ? `Devolución de ${r.counterparty}`
    : `Cobro: ${r.counterparty}${r.description ? ` · ${r.description}` : ""}`;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          type: isLoan ? "LOAN_REPAYMENT" : "INCOME",
          amount: d.amount,
          date,
          description,
          receivableId: r.id,
          categoryId,
          ...rate,
          businessId: r.businessId,
        },
      });
      // Lo cobrado entra al apartado elegido; solo un cobro (no una devolución) se reparte entre los apartados
      await applyTransactionToPockets(tx, {
        userId: user.id,
        transactionId: created.id,
        type: "INCOME",
        amount: d.amount,
        currency: wallet.currencyCode,
        date,
        label: r.counterparty,
        description,
        businessId: r.businessId,
        pocketId: d.pocketId,
        distribute: !isLoan && d.distribute,
        rate: rate.rateVesPerUsd,
        cajaCurrency: user.displayCurrency,
      });
      await recomputeReceivableStatus(r.id, tx);
    });
  } catch (e) {
    return pocketFailure(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Cobro registrado" };
}

export async function cancelReceivable(id: string) {
  const user = await requireUser();
  const r = await prisma.receivable.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  if (r.status === "CANCELLED") {
    await prisma.receivable.update({ where: { id }, data: { status: "PENDING" } });
    await recomputeReceivableStatus(id);
  } else {
    await prisma.receivable.update({ where: { id }, data: { status: "CANCELLED" } });
  }
  revalidatePath("/", "layout");
}

export async function deleteReceivable(id: string) {
  const user = await requireUser();
  const r = await prisma.receivable.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  // Borra también la salida del préstamo y los cobros asociados, para no descuadrar saldos
  await prisma.$transaction([
    prisma.pocketMovement.deleteMany({ where: { sourceTransaction: { receivableId: id } } }),
    prisma.transaction.deleteMany({ where: { receivableId: id, userId: user.id } }),
    prisma.receivable.delete({ where: { id } }),
  ]);
  revalidatePath("/", "layout");
}
