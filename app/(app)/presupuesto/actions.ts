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
  const last = await prisma.budgetBucket.aggregate({ where: { userId: user.id }, _max: { position: true } });
  const position = (last._max.position ?? -1) + 1;
  await prisma.budgetBucket.create({ data: { userId: user.id, ...parsed.data, position } });
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

/** Sube o baja una partida un lugar; renumera todas para que las posiciones queden consecutivas. */
export async function moveBudgetBucket(id: string, direction: "up" | "down") {
  const user = await requireUser();
  const buckets = await prisma.budgetBucket.findMany({
    where: { userId: user.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const from = buckets.findIndex((b) => b.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= buckets.length) return;
  [buckets[from], buckets[to]] = [buckets[to], buckets[from]];
  await prisma.$transaction(
    buckets.map((b, position) => prisma.budgetBucket.update({ where: { id: b.id }, data: { position } })),
  );
  revalidatePath("/", "layout");
}

/** Crea las partidas sugeridas (solo si aún no hay ninguna). */
export async function createSuggestedBuckets() {
  const user = await requireUser();
  if (await prisma.budgetBucket.count({ where: { userId: user.id } })) return;
  await prisma.budgetBucket.createMany({ data: SUGGESTED_BUCKETS.map((b, position) => ({ userId: user.id, ...b, position })) });
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
