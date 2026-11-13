"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { isDueInMonth } from "@/lib/budget";
import { ensureFixedReservePocket } from "@/lib/fixed-reserve";
import { assertOwned, OwnershipError } from "@/lib/guards";
import { PocketError } from "@/lib/pockets";
import { processAutoPayments, recordRecurringPayment } from "@/lib/recurring";
import { formatMonth, monthRange, parseISODate } from "@/lib/utils";
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
  // Se paga del apartado "Gastos fijos" de su dueño, que se llena al repartir sus ingresos
  await ensureFixedReservePocket(prisma, user.id, d.businessId ?? null, user.displayCurrency);
  await prisma.recurringExpense.create({
    data: {
      userId: user.id,
      name: d.name,
      amount: d.amount,
      currencyCode: d.currencyCode,
      dayOfMonth: d.dayOfMonth,
      // Los mensuales vencen todos los meses
      intervalMonths: d.intervalMonths,
      startMonth: d.intervalMonths === 1 ? null : d.startMonth,
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
  await ensureFixedReservePocket(prisma, user.id, d.businessId ?? null, user.displayCurrency);
  // Los pagos ya registrados no cambian; solo aplica a los próximos meses (y al actual si aún no se pagó)
  await prisma.recurringExpense.update({
    where: { id },
    data: {
      name: d.name,
      amount: d.amount,
      currencyCode: d.currencyCode,
      dayOfMonth: d.dayOfMonth,
      // Los mensuales vencen todos los meses
      intervalMonths: d.intervalMonths,
      startMonth: d.intervalMonths === 1 ? null : d.startMonth,
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
  // Apartado del que sale (id; "auto" = Caja del dueño; vacío = ninguno)
  pocketId: z.string().optional(),
});

export async function payRecurring(id: string, month: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const form = formObject(formData);
  const r = await prisma.recurringExpense.findFirst({ where: { id, userId: user.id } });
  if (!r) return fail("Gasto fijo no encontrado");

  const { start, end } = monthRange(month);
  const [txCount, markCount] = await Promise.all([
    prisma.transaction.count({ where: { recurringId: id, date: { gte: start, lt: end } } }),
    prisma.recurringPaidMark.count({ where: { recurringId: id, month } }),
  ]);
  if (txCount || markCount) return fail("Este gasto ya está marcado como pagado este mes");

  if (!isDueInMonth(r, month)) return fail(`Este gasto no vence en ${formatMonth(month)}`);

  // La fecha del pago debe caer en el mes, para que el estado se calcule bien
  const parsedDate = isoDate.safeParse(form.date);
  if (!parsedDate.success) return zodError(parsedDate.error);
  const date = parseISODate(parsedDate.data);
  if (date < start || date >= end) return fail(`La fecha del pago debe ser de ${formatMonth(month)}`);

  // Solo marcarlo como pagado, sin tocar ninguna cuenta (el movimiento ya existe o no se quiere registrar)
  if (form.noMovement === "on") {
    await prisma.recurringPaidMark.create({ data: { recurringId: id, month, date } });
    revalidatePath("/", "layout");
    return { ok: true };
  }

  const parsed = paySchema.safeParse(form);
  if (!parsed.success) return zodError(parsed.error);
  const wallet = await prisma.wallet.findFirst({ where: { id: parsed.data.walletId, userId: user.id } });
  if (!wallet) return fail("Cuenta inválida");

  // El monto puede escribirse en otra divisa; se guarda convertido a la divisa de la cuenta
  // con la tasa BCV del día del pago
  try {
    await recordRecurringPayment(r, wallet, parsed.data.amount, parsed.data.amountCurrency, date, parsed.data.pocketId);
  } catch (e) {
    if (e instanceof PocketError) return fail(e.message);
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
  const paidInMonth = { userId: user.id, recurringId: id, date: { gte: start, lt: end } };
  await prisma.$transaction([
    // Lo que el pago sacó de los apartados vuelve a ellos
    prisma.pocketMovement.deleteMany({ where: { sourceTransaction: paidInMonth } }),
    prisma.transaction.deleteMany({ where: paidInMonth }),
    prisma.recurringPaidMark.deleteMany({ where: { recurringId: id, month } }),
    ...(r.autoPay ? [prisma.recurringExpense.update({ where: { id }, data: { autoPay: false } })] : []),
  ]);
  revalidatePath("/", "layout");
}
