"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, zodError, type ActionState } from "@/lib/action";
import { assertOwned, OwnershipError, rateForDate } from "@/lib/guards";
import { recomputeDebtStatus } from "@/lib/debts";
import { applyTransactionToPockets, pocketFailure, revertTransactionPockets } from "@/lib/pockets";
import { recomputeReceivableStatus } from "@/lib/receivables";
import { parseISODate, toISODate } from "@/lib/utils";
import { transactionSchema } from "@/lib/validators";

function parseTransactionForm(formData: FormData) {
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  return transactionSchema.safeParse({
    type: str("type"),
    walletId: str("walletId"),
    amount: str("amount"),
    date: str("date"),
    categoryId: str("categoryId"),
    description: str("description"),
    businessId: str("businessId"),
    pocketId: str("pocketId"),
    distribute: str("distribute"),
  });
}

async function validateAndBuild(userId: string, formData: FormData) {
  const parsed = parseTransactionForm(formData);
  if (!parsed.success) return { error: zodError(parsed.error) };
  const data = parsed.data;

  try {
    await assertOwned(userId, {
      walletIds: [data.walletId],
      categoryId: data.categoryId,
      businessIds: [data.businessId],
    });
  } catch (e) {
    if (e instanceof OwnershipError) return { error: fail("Cuenta, categoría o negocio inválido") };
    throw e;
  }
  if (data.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (cat && cat.kind !== data.type) return { error: fail("La categoría no corresponde al tipo de movimiento") };
  }
  return { data };
}

type Built = NonNullable<Awaited<ReturnType<typeof validateAndBuild>>["data"]>;

/** Lleva el movimiento a los apartados elegidos; devuelve un error legible si no se pudo. */
async function moveToPockets(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  user: { id: string; displayCurrency: string },
  transactionId: string,
  data: Built,
  rate: string | null | undefined,
) {
  const [wallet, category] = await Promise.all([
    tx.wallet.findUniqueOrThrow({ where: { id: data.walletId }, select: { currencyCode: true } }),
    data.categoryId ? tx.category.findUnique({ where: { id: data.categoryId }, select: { name: true } }) : null,
  ]);
  await applyTransactionToPockets(tx, {
    userId: user.id,
    transactionId,
    type: data.type,
    amount: data.amount,
    currency: wallet.currencyCode,
    date: parseISODate(data.date),
    label: data.description || category?.name || "sin descripción",
    businessId: data.businessId ?? null,
    pocketId: data.pocketId,
    distribute: data.distribute,
    rate,
    cajaCurrency: user.displayCurrency,
  });
}

export async function createTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await validateAndBuild(user.id, formData);
  if (!result.data) return result.error;
  const { data } = result;
  // Tasa del día del movimiento (no la de hoy si se registra con fecha pasada)
  const rate = await rateForDate(user.preferredRateSource, data.date);

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId: user.id,
          walletId: data.walletId,
          type: data.type,
          amount: data.amount,
          date: parseISODate(data.date),
          categoryId: data.categoryId ?? null,
          description: data.description ?? "",
          businessId: data.businessId ?? null,
          ...rate,
        },
      });
      await moveToPockets(tx, user, created.id, data, rate.rateVesPerUsd);
    });
  } catch (e) {
    return pocketFailure(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Movimiento registrado" };
}

export async function updateTransaction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const existing = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
  if (!existing || (existing.type !== "INCOME" && existing.type !== "EXPENSE")) return fail("Movimiento no encontrado");
  const result = await validateAndBuild(user.id, formData);
  if (!result.data) return result.error;
  const { data } = result;
  // Un cobro o un pago de deuda no puede cambiar de tipo: dejaría de contar en su registro
  if ((existing.receivableId || existing.debtId) && data.type !== existing.type) {
    return fail("Este movimiento es un cobro o pago de una deuda: no puede cambiar de tipo");
  }

  // Si cambia la fecha se usa la tasa del nuevo día; si no, la que ya tenía
  const rate =
    toISODate(existing.date) === data.date && existing.rateVesPerUsd
      ? { rateVesPerUsd: existing.rateVesPerUsd.toString(), rateSource: existing.rateSource }
      : await rateForDate(user.preferredRateSource, data.date);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: {
          walletId: data.walletId,
          type: data.type,
          amount: data.amount,
          date: parseISODate(data.date),
          categoryId: data.categoryId ?? null,
          description: data.description ?? "",
          businessId: data.businessId ?? null,
          ...rate,
        },
      });
      // Se rehace lo que el movimiento hizo en los apartados con los datos nuevos
      await revertTransactionPockets(tx, id);
      await moveToPockets(tx, user, id, data, rate.rateVesPerUsd);
      if (existing.receivableId) await recomputeReceivableStatus(existing.receivableId, tx);
      if (existing.debtId) await recomputeDebtStatus(existing.debtId, tx);
    });
  } catch (e) {
    return pocketFailure(e);
  }
  revalidatePath("/", "layout");
  redirect("/movimientos");
}

/** Movimientos que solo se borran desde su préstamo (borrarlos sueltos dejaría la deuda descuadrada). */
const LOAN_ORIGIN_TYPES = ["LOAN_OUT", "LOAN_IN"];

export async function deleteTransaction(id: string) {
  const user = await requireUser();
  const tx = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
  if (!tx || LOAN_ORIGIN_TYPES.includes(tx.type)) return;
  // Lo que el movimiento metió o sacó de los apartados se borra con él (en cascada)
  await prisma.$transaction(async (db) => {
    if (tx.transferGroupId && tx.type.startsWith("TRANSFER")) {
      // Las dos partes de la transferencia y su comisión (la comisión sola se puede borrar aparte)
      await db.transaction.deleteMany({ where: { userId: user.id, transferGroupId: tx.transferGroupId } });
    } else {
      await db.transaction.delete({ where: { id } });
    }
    if (tx.receivableId) await recomputeReceivableStatus(tx.receivableId, db);
    if (tx.debtId) await recomputeDebtStatus(tx.debtId, db);
  });
  revalidatePath("/", "layout");
}
