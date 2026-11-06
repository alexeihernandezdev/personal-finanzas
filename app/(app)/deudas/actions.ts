"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { recomputeDebtStatus } from "@/lib/debts";
import { assertOwned, OwnershipError, snapshotRate } from "@/lib/guards";
import { parseISODate, todayISO } from "@/lib/utils";
import { debtPaymentSchema, debtSchema, debtTransactionEditSchema } from "@/lib/validators";

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
    await prisma.debt.create({
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
          create: {
            userId: user.id,
            walletId: wallet.id,
            type: "LOAN_IN",
            amount: d.amount,
            date: parseISODate(d.date ?? todayISO()),
            description: `Préstamo de ${d.counterparty}`,
            ...(await snapshotRate(user.preferredRateSource)),
          },
        },
      },
    });
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
  await prisma.transaction.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      // Pagar una deuda por compra es un gasto; devolver un préstamo no (el dinero ya entró como préstamo)
      type: isLoan ? "DEBT_PAYMENT" : "EXPENSE",
      amount: p.amount,
      date: parseISODate(p.date),
      description: isLoan ? `Pago de préstamo a ${d.counterparty}` : `Pago: ${d.counterparty}${d.description ? ` · ${d.description}` : ""}`,
      debtId: d.id,
      ...(await snapshotRate(user.preferredRateSource)),
      ...(isLoan ? {} : { splits: { create: [{ businessId: d.businessId, amount: p.amount }] } }),
    },
  });
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

  if (tx.type === "LOAN_IN") {
    // La deuda del préstamo vive en la divisa de la cuenta que recibió el dinero
    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: tx.id },
        data: { walletId: wallet.id, amount: p.amount, date: parseISODate(p.date) },
      }),
      prisma.debt.update({ where: { id: tx.debt.id }, data: { amount: p.amount, currencyCode: wallet.currencyCode } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transactionId: tx.id } }),
      prisma.transaction.update({
        where: { id: tx.id },
        data: {
          walletId: wallet.id,
          amount: p.amount,
          date: parseISODate(p.date),
          ...(tx.type === "EXPENSE" ? { splits: { create: [{ businessId: tx.debt.businessId, amount: p.amount }] } } : {}),
        },
      }),
    ]);
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
  await prisma.transaction.delete({ where: { id: tx.id } });
  await recomputeDebtStatus(tx.debtId!);
  revalidatePath("/", "layout");
}
