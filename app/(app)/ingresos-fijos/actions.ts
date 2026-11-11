"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { assertOwned, OwnershipError } from "@/lib/guards";
import { recurringIncomeSchema } from "@/lib/validators";

async function parseIncome(userId: string, formData: FormData) {
  const parsed = recurringIncomeSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: zodError(parsed.error) };
  const d = parsed.data;
  try {
    await assertOwned(userId, { walletIds: [d.walletId], categoryId: d.categoryId, businessIds: [d.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return { error: fail("Cuenta, categoría o negocio inválido") };
    throw e;
  }
  return {
    data: {
      name: d.name,
      amount: d.amount,
      currencyCode: d.currencyCode,
      dayOfMonth: d.dayOfMonth,
      walletId: d.walletId ?? null,
      categoryId: d.categoryId ?? null,
      businessId: d.businessId ?? null,
    },
  };
}

export async function createRecurringIncome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await parseIncome(user.id, formData);
  if (!result.data) return result.error;
  await prisma.recurringIncome.create({ data: { userId: user.id, ...result.data } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Ingreso fijo creado" };
}

export async function updateRecurringIncome(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await parseIncome(user.id, formData);
  if (!result.data) return result.error;
  const { count } = await prisma.recurringIncome.updateMany({ where: { id, userId: user.id }, data: result.data });
  if (!count) return fail("Ingreso fijo no encontrado");
  revalidatePath("/", "layout");
  return { ok: true, message: "Cambios guardados" };
}

export async function toggleRecurringIncome(id: string) {
  const user = await requireUser();
  const r = await prisma.recurringIncome.findFirst({ where: { id, userId: user.id } });
  if (!r) return;
  await prisma.recurringIncome.update({ where: { id }, data: { active: !r.active } });
  revalidatePath("/", "layout");
}

export async function deleteRecurringIncome(id: string) {
  const user = await requireUser();
  await prisma.recurringIncome.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/", "layout");
}
