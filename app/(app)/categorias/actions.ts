"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { businessSchema, categorySchema } from "@/lib/validators";

function isUniqueError(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = categorySchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  try {
    await prisma.category.create({ data: { ...parsed.data, userId: user.id } });
  } catch (e) {
    if (isUniqueError(e)) return fail("Ya tienes una categoría con ese nombre");
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameCategory(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "");
  if (!name) return fail("Escribe un nombre");
  const res = await prisma.category
    .updateMany({ where: { id, userId: user.id }, data: { name, ...(color ? { color } : {}) } })
    .catch((e) => (isUniqueError(e) ? null : Promise.reject(e)));
  if (!res) return fail("Ya tienes una categoría con ese nombre");
  revalidatePath("/", "layout");
  return { ok: true, message: "Guardado" };
}

export async function toggleArchiveCategory(id: string) {
  const user = await requireUser();
  const c = await prisma.category.findFirst({ where: { id, userId: user.id } });
  if (!c) return;
  await prisma.category.update({ where: { id }, data: { archived: !c.archived } });
  revalidatePath("/", "layout");
}

export async function createBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = businessSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  try {
    await prisma.business.create({ data: { ...parsed.data, userId: user.id } });
  } catch (e) {
    if (isUniqueError(e)) return fail("Ya tienes un negocio con ese nombre");
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameBusiness(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "");
  if (!name) return fail("Escribe un nombre");
  const res = await prisma.business
    .updateMany({ where: { id, userId: user.id }, data: { name, ...(color ? { color } : {}) } })
    .catch((e) => (isUniqueError(e) ? null : Promise.reject(e)));
  if (!res) return fail("Ya tienes un negocio con ese nombre");
  revalidatePath("/", "layout");
  return { ok: true, message: "Guardado" };
}

export async function toggleArchiveBusiness(id: string) {
  const user = await requireUser();
  const b = await prisma.business.findFirst({ where: { id, userId: user.id } });
  if (!b) return;
  await prisma.business.update({ where: { id }, data: { archived: !b.archived } });
  revalidatePath("/", "layout");
}
