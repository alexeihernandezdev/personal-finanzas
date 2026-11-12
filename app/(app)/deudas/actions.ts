"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { recomputeDebtStatus } from "@/lib/debts";
import { assertOwned, OwnershipError, snapshotRate } from "@/lib/guards";
import { applyTransactionToPockets, pocketFailure, pocketOfTransaction, revertTransactionPockets } from "@/lib/pockets";
import { parseISODate, todayISO } from "@/lib/utils";
import { debtPaymentSchema, debtSchema, debtTransactionEditSchema } from "@/lib/validators";

/** Deshace lo que los movimientos de una deuda metieron o sacaron de los apartados. */
const deleteDebtPocketMovements = (debtId: string) =>
  prisma.pocketMovement.deleteMany({ where: { sourceTransaction: { debtId } } });

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
    // Un préstamo recibido mete el dinero en una cuenta: la deuda queda en la divisa de esa cuenta.
    if (!d.walletId) return fail("Elige la cuenta a la que entra el dinero prestado");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: d.walletId } });
    const rate = await snapshotRate(user.preferredRateSource);
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
            amount: d.amount,
            currencyCode: wallet.currencyCode,
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
    await prisma.debt.create({
      data: {
        userId: user.id,
        kind: "PAYABLE",
        counterparty: d.counterparty,
        description: d.description ?? "",
        amount: d.amount,
        currencyCode: d.currencyCode,
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
    prisma.debt.findFirst({ where: { id: p.debtId, userId: user.id } }),
    prisma.wallet.findFirst({ where: { id: p.walletId, userId: user.id } }),
  ]);
  if (!d || !wallet) return fail("Registro no encontrado");
  if (d.status === "CANCELLED" || d.status === "SETTLED") return fail("Esta deuda ya está cerrada");

  const isLoan = d.kind === "LOAN_RECEIVED";
  const rate = await snapshotRate(user.preferredRateSource);
  const date = parseISODate(p.date);
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
    });
  } catch (e) {
    return pocketFailure(e);
  }
  await recomputeDebtStatus(d.id);
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

  try {
    await prisma.$transaction(async (db) => {
      if (tx.type === "LOAN_IN") {
        // La deuda del préstamo vive en la divisa de la cuenta que recibió el dinero
        await db.transaction.update({ where: { id: tx.id }, data: { walletId: wallet.id, amount: p.amount, date } });
        await db.debt.update({ where: { id: debt.id }, data: { amount: p.amount, currencyCode: wallet.currencyCode } });
      } else {
        await db.transactionSplit.deleteMany({ where: { transactionId: tx.id } });
        await db.transaction.update({
          where: { id: tx.id },
          data: {
            walletId: wallet.id,
            amount: p.amount,
            date,
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
        rate: tx.rateVesPerUsd?.toString() ?? null,
        cajaCurrency: user.displayCurrency,
      });
    });
  } catch (e) {
    return pocketFailure(e);
  }
  await recomputeDebtStatus(tx.debt.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Movimiento actualizado" };
}

/** Elimina un pago de una deuda y la reabre si corresponde. */
export async function deleteDebtPayment(txId: string) {
  const user = await requireUser();
  const tx = await prisma.transaction.findFirst({ where: { id: txId, userId: user.id, debtId: { not: null } } });
  if (!tx || tx.type === "LOAN_IN") return;
  await prisma.$transaction([
    prisma.pocketMovement.deleteMany({ where: { sourceTransactionId: tx.id } }),
    prisma.transaction.delete({ where: { id: tx.id } }),
  ]);
  await recomputeDebtStatus(tx.debtId!);
  revalidatePath("/", "layout");
}
