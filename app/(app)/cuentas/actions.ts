"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { walletSchema } from "@/lib/validators";

export async function createWallet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = walletSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  await prisma.wallet.create({ data: { ...parsed.data, userId: user.id } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Cuenta creada" };
}

export async function updateWallet(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = walletSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const wallet = await prisma.wallet.findFirst({ where: { id, userId: user.id }, include: { _count: { select: { transactions: true } } } });
  if (!wallet) return fail("Cuenta no encontrada");
  if (wallet._count.transactions > 0 && wallet.currencyCode !== parsed.data.currencyCode) {
    return fail("No puedes cambiar la divisa de una cuenta que ya tiene movimientos");
  }
  await prisma.wallet.update({ where: { id }, data: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Cambios guardados" };
}

export async function toggleArchiveWallet(id: string) {
  const user = await requireUser();
  const wallet = await prisma.wallet.findFirst({ where: { id, userId: user.id } });
  if (!wallet) return;
  await prisma.wallet.update({ where: { id }, data: { archived: !wallet.archived } });
  revalidatePath("/", "layout");
}

export async function deleteWallet(id: string) {
  const user = await requireUser();
  const wallet = await prisma.wallet.findFirst({ where: { id, userId: user.id } });
  if (!wallet) return;
  // Borra la cuenta y sus movimientos. Si alguno era parte de una transferencia,
  // también borramos la otra mitad para no dejar saldos descuadrados.
  const groups = await prisma.transaction.findMany({
    where: { walletId: id, transferGroupId: { not: null } },
    select: { transferGroupId: true },
  });
  await prisma.$transaction([
    prisma.transaction.deleteMany({
      where: { userId: user.id, transferGroupId: { in: groups.map((g) => g.transferGroupId!) } },
    }),
    prisma.wallet.delete({ where: { id } }),
  ]);
  revalidatePath("/", "layout");
  redirect("/cuentas");
}
