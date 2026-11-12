"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, zodError, type ActionState } from "@/lib/action";
import { assertOwned, OwnershipError, snapshotRate } from "@/lib/guards";
import { splitsMatchTotal } from "@/lib/money";
import { recomputeDebtStatus } from "@/lib/debts";
import { applyTransactionToPockets, pocketFailure, revertTransactionPockets } from "@/lib/pockets";
import { recomputeReceivableStatus } from "@/lib/receivables";
import { parseISODate } from "@/lib/utils";
import { transactionSchema } from "@/lib/validators";

function parseTransactionForm(formData: FormData) {
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  // Los splits llegan como JSON desde el formulario (cliente)
  let splits: unknown = [];
  try {
    splits = JSON.parse(str("splits") ?? "[]");
  } catch {
    splits = [];
  }
  return transactionSchema.safeParse({
    type: str("type"),
    walletId: str("walletId"),
    amount: str("amount"),
    date: str("date"),
    categoryId: str("categoryId"),
    description: str("description"),
    splits,
    pocketId: str("pocketId"),
    distribute: str("distribute"),
  });
}

async function validateAndBuild(userId: string, formData: FormData) {
  const parsed = parseTransactionForm(formData);
  if (!parsed.success) return { error: zodError(parsed.error) };
  const data = parsed.data;

  // Sin splits => 100% Personal. Con splits => deben sumar el total.
  const splits = data.splits.length ? data.splits : [{ businessId: null, amount: data.amount }];
  if (!splitsMatchTotal(data.amount, splits.map((s) => s.amount))) {
    return { error: fail("La división entre negocios debe sumar exactamente el monto total") };
  }
  try {
    await assertOwned(userId, {
      walletIds: [data.walletId],
      categoryId: data.categoryId,
      businessIds: splits.map((s) => s.businessId),
    });
  } catch (e) {
    if (e instanceof OwnershipError) return { error: fail("Cuenta, categoría o negocio inválido") };
    throw e;
  }
  if (data.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (cat && cat.kind !== data.type) return { error: fail("La categoría no corresponde al tipo de movimiento") };
  }
  return { data, splits };
}

type Built = NonNullable<Awaited<ReturnType<typeof validateAndBuild>>["data"]>;

/** Lleva el movimiento a los apartados elegidos; devuelve un error legible si no se pudo. */
async function moveToPockets(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  user: { id: string; displayCurrency: string },
  transactionId: string,
  data: Built,
  splits: { businessId: string | null; amount: string }[],
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
    splits,
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
  const { data, splits } = result;
  const rate = await snapshotRate(user.preferredRateSource);

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
          ...rate,
          splits: { create: splits.map((s) => ({ businessId: s.businessId, amount: s.amount })) },
        },
      });
      await moveToPockets(tx, user, created.id, data, splits, rate.rateVesPerUsd);
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
  const { data, splits } = result;

  const rate = existing.rateVesPerUsd?.toString() ?? (await snapshotRate(user.preferredRateSource)).rateVesPerUsd;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transactionSplit.deleteMany({ where: { transactionId: id } });
      await tx.transaction.update({
        where: { id },
        data: {
          walletId: data.walletId,
          type: data.type,
          amount: data.amount,
          date: parseISODate(data.date),
          categoryId: data.categoryId ?? null,
          description: data.description ?? "",
          splits: { create: splits.map((s) => ({ businessId: s.businessId, amount: s.amount })) },
        },
      });
      // Se rehace lo que el movimiento hizo en los apartados con los datos nuevos
      await revertTransactionPockets(tx, id);
      await moveToPockets(tx, user, id, data, splits, rate);
    });
  } catch (e) {
    return pocketFailure(e);
  }
  if (existing.receivableId) await recomputeReceivableStatus(existing.receivableId);
  if (existing.debtId) await recomputeDebtStatus(existing.debtId);
  revalidatePath("/", "layout");
  redirect("/movimientos");
}

export async function deleteTransaction(id: string) {
  const user = await requireUser();
  const tx = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
  if (!tx) return;
  // Lo que el movimiento metió o sacó de los apartados se deshace con él
  await prisma.pocketMovement.deleteMany({ where: { sourceTransactionId: tx.id } });
  if (tx.transferGroupId) {
    await prisma.transaction.deleteMany({ where: { userId: user.id, transferGroupId: tx.transferGroupId } });
  } else {
    await prisma.transaction.delete({ where: { id } });
  }
  if (tx.receivableId) await recomputeReceivableStatus(tx.receivableId);
  if (tx.debtId) await recomputeDebtStatus(tx.debtId);
  revalidatePath("/", "layout");
}
