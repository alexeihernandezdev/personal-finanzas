"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { SUGGESTED_BUCKETS } from "@/lib/budget";
import { budgetBucketSchema, fixedBufferSchema } from "@/lib/validators";

export async function createBudgetBucket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = budgetBucketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  await prisma.budgetBucket.create({ data: { userId: user.id, ...parsed.data } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Partida creada" };
}

export async function updateBudgetBucket(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = budgetBucketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const { count } = await prisma.budgetBucket.updateMany({ where: { id, userId: user.id }, data: parsed.data });
  if (!count) return fail("Partida no encontrada");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteBudgetBucket(id: string) {
  const user = await requireUser();
  await prisma.budgetBucket.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/", "layout");
}

/** Crea las partidas sugeridas (solo si aún no hay ninguna). */
export async function createSuggestedBuckets() {
  const user = await requireUser();
  if (await prisma.budgetBucket.count({ where: { userId: user.id } })) return;
  await prisma.budgetBucket.createMany({ data: SUGGESTED_BUCKETS.map((b) => ({ userId: user.id, ...b })) });
  revalidatePath("/", "layout");
}

/** Colchón sobre los gastos fijos (% de su total). */
export async function updateFixedBuffer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = fixedBufferSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  await prisma.user.update({ where: { id: user.id }, data: { fixedBufferPercent: parsed.data.percent } });
  revalidatePath("/", "layout");
  return { ok: true };
}
