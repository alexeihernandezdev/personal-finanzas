"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { assertOwned, OwnershipError, snapshotRate } from "@/lib/guards";
import { monthRange, parseISODate } from "@/lib/utils";
import { amount, isoDate, recurringSchema } from "@/lib/validators";

export async function createRecurring(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = recurringSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  try {
    await assertOwned(user.id, { walletIds: [d.walletId], categoryId: d.categoryId, businessIds: [d.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Cuenta, categoría o negocio inválido");
    throw e;
  }
  await prisma.recurringExpense.create({
    data: {
      userId: user.id,
      name: d.name,
      amount: d.amount,
      currencyCode: d.currencyCode,
      dayOfMonth: d.dayOfMonth,
      walletId: d.walletId ?? null,
      categoryId: d.categoryId ?? null,
      businessId: d.businessId ?? null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Gasto fijo creado" };
}

export async function toggleRecurring(id: string) {
  const user = await requireUser();
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  await prisma.recurringExpense.update({ where: { id }, data: { active: !r.active } });
  revalidatePath("/", "layout");
}

export async function deleteRecurring(id: string) {
  const user = await requireUser();
  // Los pagos ya registrados se conservan (recurringId pasa a null)
  await prisma.recurringExpense.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/", "layout");
}

const paySchema = z.object({
  walletId: z.string({ error: "Elige la cuenta con la que pagaste" }),
  amount: amount(),
  date: isoDate,
});

export async function payRecurring(id: string, month: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = paySchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return fail("Gasto fijo no encontrado");
  const wallet = await prisma.wallet.findFirst({ where: { id: parsed.data.walletId, userId: user.id } });
  if (!wallet) return fail("Cuenta inválida");

  const { start, end } = monthRange(month);
  const already = await prisma.transaction.count({ where: { recurringId: id, date: { gte: start, lt: end } } });
  if (already) return fail("Este gasto ya está marcado como pagado este mes");

  // La fecha del pago debe caer en el mes, para que el estado se calcule bien
  let date = parseISODate(parsed.data.date);
  if (date < start || date >= end) date = start;

  await prisma.transaction.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      type: "EXPENSE",
      amount: parsed.data.amount,
      date,
      description: r.name,
      categoryId: r.categoryId,
      recurringId: r.id,
      ...(await snapshotRate(user.preferredRateSource)),
      splits: { create: [{ businessId: r.businessId, amount: parsed.data.amount }] },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
