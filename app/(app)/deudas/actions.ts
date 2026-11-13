"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { recomputeDebtStatus } from "@/lib/debts";
import { getDebtPaymentCategoryId } from "@/lib/defaults";
import { assertOwned, OwnershipError, rateForDate } from "@/lib/guards";
import { convert, dec, formatMoney, type DecimalLike } from "@/lib/money";
import { currentFallbackRate, paidAmount } from "@/lib/queries";
import { applyTransactionToPockets, pocketFailure, pocketOfTransaction, revertTransactionPockets } from "@/lib/pockets";
import { parseISODate, todayISO, toISODate } from "@/lib/utils";
import { debtPaymentSchema, debtSchema, debtTransactionEditSchema } from "@/lib/validators";

/** Deshace lo que los movimientos de una deuda metieron o sacaron de los apartados. */
const deleteDebtPocketMovements = (debtId: string) =>
  prisma.pocketMovement.deleteMany({ where: { sourceTransaction: { debtId } } });

/** Lo que se debe en bolívares se guarda en dólares (igual que lo que te deben), a la tasa del día. */
function owedInUsd(amount: string, currency: string, rate: DecimalLike | null) {
  if (currency !== "VES") return { amount, currencyCode: currency };
  if (!rate) return null;
  return { amount: convert(amount, "VES", "USD", rate).toDecimalPlaces(2).toString(), currencyCode: "USD" };
}

export async function createDebt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = debtSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  try {
    await assertOwned(user.id, { walletIds: [d.walletId], businessIds: [d.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Cuenta o negocio inválido");
    throw e;
  }

  if (d.kind === "LOAN_RECEIVED") {
    // Un préstamo recibido mete el dinero en una cuenta (en su divisa); lo que debes queda en dólares si es en Bs.
    if (!d.walletId) return fail("Elige la cuenta a la que entra el dinero prestado");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: d.walletId } });
    const rate = await rateForDate(user.preferredRateSource, d.date ?? todayISO());
    const owed = owedInUsd(d.amount, wallet.currencyCode, rate.rateVesPerUsd);
    if (!owed) return fail("No hay tasa del día para pasar el préstamo a dólares");
    const date = parseISODate(d.date ?? todayISO());
    const description = `Préstamo de ${d.counterparty}`;
    try {
      await prisma.$transaction(async (tx) => {
        const debt = await tx.debt.create({
          data: {
            userId: user.id,
            kind: "LOAN_RECEIVED",
            counterparty: d.counterparty,
            description: d.description ?? "",
            ...owed,
            dueDate: d.dueDate ? parseISODate(d.dueDate) : null,
            businessId: d.businessId ?? null,
            transactions: {
              create: { userId: user.id, walletId: wallet.id, type: "LOAN_IN", amount: d.amount, date, description, ...rate },
            },
          },
          include: { transactions: { select: { id: true } } },
        });
        // El dinero prestado entra al apartado elegido, sin repartirlo (no es un ingreso)
        await applyTransactionToPockets(tx, {
          userId: user.id,
          transactionId: debt.transactions[0].id,
          type: "INCOME",
          amount: d.amount,
          currency: wallet.currencyCode,
          date,
          label: d.counterparty,
          description,
          splits: [{ businessId: d.businessId ?? null, amount: d.amount }],
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
    const rate = await rateForDate(user.preferredRateSource, todayISO());
    const owed = owedInUsd(d.amount, d.currencyCode, rate.rateVesPerUsd);
    if (!owed) return fail("No hay tasa del día para pasar el monto a dólares");
    await prisma.debt.create({
      data: {
        userId: user.id,
        kind: "PAYABLE",
        counterparty: d.counterparty,
        description: d.description ?? "",
        ...owed,
        dueDate: d.dueDate ? parseISODate(d.dueDate) : null,
        businessId: d.businessId ?? null,
      },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: d.kind === "LOAN_RECEIVED" ? "Préstamo recibido registrado" : "Deuda registrada" };
}

export async function registerDebtPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = debtPaymentSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const p = parsed.data;
  const [d, wallet] = await Promise.all([
    prisma.debt.findFirst({
      where: { id: p.debtId, userId: user.id },
      include: { transactions: { include: { wallet: { select: { currencyCode: true } } } } },
    }),
    prisma.wallet.findFirst({ where: { id: p.walletId, userId: user.id } }),
  ]);
  if (!d || !wallet) return fail("Registro no encontrado");
  if (d.status === "CANCELLED" || d.status === "SETTLED") return fail("Esta deuda ya está cerrada");

  const isLoan = d.kind === "LOAN_RECEIVED";
  const rate = await rateForDate(user.preferredRateSource, p.date);
  const date = parseISODate(p.date);

  // No se puede pagar más de lo que falta
  const remaining = dec(d.amount).sub(paidAmount(d, await currentFallbackRate()));
  let inRecord;
  try {
    inRecord = convert(p.amount, wallet.currencyCode, d.currencyCode, rate.rateVesPerUsd);
  } catch {
    return fail("No hay tasa disponible para comparar el pago con lo pendiente");
  }
  if (inRecord.toDecimalPlaces(2).gt(remaining.toDecimalPlaces(2).add("0.01"))) {
    return fail(`Solo faltan ${formatMoney(remaining, d.currencyCode)} por pagar`);
  }
  const categoryId = isLoan ? null : await getDebtPaymentCategoryId(user.id);
  const description = isLoan
    ? `Pago de préstamo a ${d.counterparty}`
    : `Pago: ${d.counterparty}${d.description ? ` · ${d.description}` : ""}`;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          // Pagar una deuda por compra es un gasto; devolver un préstamo no (el dinero ya entró como préstamo)
          type: isLoan ? "DEBT_PAYMENT" : "EXPENSE",
          amount: p.amount,
          date,
          description,
          debtId: d.id,
          categoryId,
          ...rate,
          ...(isLoan ? {} : { splits: { create: [{ businessId: d.businessId, amount: p.amount }] } }),
        },
      });
      // El pago sale del apartado elegido
      await applyTransactionToPockets(tx, {
        userId: user.id,
        transactionId: created.id,
        type: "EXPENSE",
        amount: p.amount,
        currency: wallet.currencyCode,
        date,
        label: d.counterparty,
        description,
        splits: [{ businessId: d.businessId, amount: p.amount }],
        pocketId: p.pocketId,
        distribute: false,
        rate: rate.rateVesPerUsd,
        cajaCurrency: user.displayCurrency,
      });
      await recomputeDebtStatus(d.id, tx);
    });
  } catch (e) {
    return pocketFailure(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Pago registrado" };
}

export async function cancelDebt(id: string) {
  const user = await requireUser();
  const d = await prisma.debt.findFirst({ where: { id, userId: user.id } });
  if (!d) return;
  if (d.status === "CANCELLED") {
    await prisma.debt.update({ where: { id }, data: { status: "PENDING" } });
    await recomputeDebtStatus(id);
  } else {
    await prisma.debt.update({ where: { id }, data: { status: "CANCELLED" } });
  }
  revalidatePath("/", "layout");
}

export async function deleteDebt(id: string) {
  const user = await requireUser();
  const d = await prisma.debt.findFirst({ where: { id, userId: user.id } });
  if (!d) return;
  // Borra también la entrada del préstamo y los pagos asociados, para no descuadrar saldos
  await prisma.$transaction([
    deleteDebtPocketMovements(id),
    prisma.transaction.deleteMany({ where: { debtId: id, userId: user.id } }),
    prisma.debt.delete({ where: { id } }),
  ]);
  revalidatePath("/", "layout");
}

/** Corrige un movimiento ligado a una deuda (pago o entrada del préstamo): cuenta, monto y fecha. */
export async function updateDebtTransaction(txId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = debtTransactionEditSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const p = parsed.data;
  const [tx, wallet] = await Promise.all([
    prisma.transaction.findFirst({ where: { id: txId, userId: user.id, debtId: { not: null } }, include: { debt: true } }),
    prisma.wallet.findFirst({ where: { id: p.walletId, userId: user.id } }),
  ]);
  if (!tx?.debt || !wallet) return fail("Registro no encontrado");
  const debt = tx.debt;
  const date = parseISODate(p.date);
  // Si cambia la fecha se usa la tasa del nuevo día; si no, la que ya tenía
  const rate =
    toISODate(tx.date) === p.date && tx.rateVesPerUsd
      ? { rateVesPerUsd: tx.rateVesPerUsd.toString(), rateSource: tx.rateSource }
      : await rateForDate(user.preferredRateSource, p.date);

  try {
    await prisma.$transaction(async (db) => {
      if (tx.type === "LOAN_IN") {
        // Lo que se debe por el préstamo sigue a lo que entró (en dólares si entró en bolívares)
        const owed = owedInUsd(p.amount, wallet.currencyCode, rate.rateVesPerUsd);
        if (!owed) throw new Error("No hay tasa disponible para convertir");
        await db.transaction.update({ where: { id: tx.id }, data: { walletId: wallet.id, amount: p.amount, date, ...rate } });
        await db.debt.update({ where: { id: debt.id }, data: owed });
      } else {
        await db.transactionSplit.deleteMany({ where: { transactionId: tx.id } });
        await db.transaction.update({
          where: { id: tx.id },
          data: {
            walletId: wallet.id,
            amount: p.amount,
            date,
            ...rate,
            ...(tx.type === "EXPENSE" ? { splits: { create: [{ businessId: debt.businessId, amount: p.amount }] } } : {}),
          },
        });
      }
      // Se rehace en el mismo apartado de antes, con el monto y la fecha nuevos
      const pocketId = await pocketOfTransaction(db, tx.id);
      if (!pocketId) return;
      await revertTransactionPockets(db, tx.id);
      await applyTransactionToPockets(db, {
        userId: user.id,
        transactionId: tx.id,
        type: tx.type === "LOAN_IN" ? "INCOME" : "EXPENSE",
        amount: p.amount,
        currency: wallet.currencyCode,
        date,
        label: debt.counterparty,
        description: tx.description,
        splits: [{ businessId: debt.businessId, amount: p.amount }],
        pocketId,
        distribute: false,
        rate: rate.rateVesPerUsd,
        cajaCurrency: user.displayCurrency,
      });
    });
    await recomputeDebtStatus(debt.id);
  } catch (e) {
    return pocketFailure(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Movimiento actualizado" };
}

/** Elimina un pago de una deuda y la reabre si corresponde. */
export async function deleteDebtPayment(txId: string) {
  const user = await requireUser();
  const tx = await prisma.transaction.findFirst({ where: { id: txId, userId: user.id, debtId: { not: null } } });
  if (!tx || tx.type === "LOAN_IN") return;
  // Lo que el pago sacó de los apartados se borra con él (en cascada)
  await prisma.$transaction(async (db) => {
    await db.transaction.delete({ where: { id: tx.id } });
    await recomputeDebtStatus(tx.debtId!, db);
  });
  revalidatePath("/", "layout");
}
