"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { assertOwned, OwnershipError } from "@/lib/guards";
import { processAutoPayments, recordRecurringPayment } from "@/lib/recurring";
import { monthRange, parseISODate } from "@/lib/utils";
import { amount, currencyCode, isoDate, recurringSchema } from "@/lib/validators";

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
      autoPay: d.autoPay,
    },
  });
  if (d.autoPay) await processAutoPayments(user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Gasto fijo creado" };
}

export async function updateRecurring(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = recurringSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return fail("Gasto fijo no encontrado");
  try {
    await assertOwned(user.id, { walletIds: [d.walletId], categoryId: d.categoryId, businessIds: [d.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Cuenta, categoría o negocio inválido");
    throw e;
  }
  // Los pagos ya registrados no cambian; solo aplica a los próximos meses (y al actual si aún no se pagó)
  await prisma.recurringExpense.update({
    where: { id },
    data: {
      name: d.name,
      amount: d.amount,
      currencyCode: d.currencyCode,
      dayOfMonth: d.dayOfMonth,
      walletId: d.walletId ?? null,
      categoryId: d.categoryId ?? null,
      businessId: d.businessId ?? null,
      autoPay: d.autoPay,
    },
  });
  if (d.autoPay) await processAutoPayments(user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Cambios guardados" };
}

export async function toggleRecurring(id: string) {
  const user = await requireUser();
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  await prisma.recurringExpense.update({ where: { id }, data: { active: !r.active } });
  revalidatePath("/", "layout");
}

export async function toggleAutoPay(id: string) {
  const user = await requireUser();
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  // Sin cuenta habitual no hay de dónde cobrarlo automáticamente
  if (!r.autoPay && !r.walletId) return;
  await prisma.recurringExpense.update({ where: { id }, data: { autoPay: !r.autoPay } });
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
  amountCurrency: currencyCode,
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

  // El monto puede escribirse en otra divisa; se guarda convertido a la divisa de la cuenta
  // con la tasa BCV del día del pago
  try {
    await recordRecurringPayment(r, wallet, parsed.data.amount, parsed.data.amountCurrency, date);
  } catch {
    return fail("No hay tasa disponible para convertir el monto");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Elimina el pago registrado de un gasto fijo en un mes, para poder registrarlo de nuevo.
 * Si era automático pasa a manual; si no, el pago se volvería a registrar solo.
 */
export async function unpayRecurring(id: string, month: string) {
  const user = await requireUser();
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  const { start, end } = monthRange(month);
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId: user.id, recurringId: id, date: { gte: start, lt: end } } }),
    ...(r.autoPay ? [prisma.recurringExpense.update({ where: { id }, data: { autoPay: false } })] : []),
  ]);
  revalidatePath("/", "layout");
}
