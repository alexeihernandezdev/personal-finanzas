"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { assertOwned, OwnershipError } from "@/lib/guards";
import { dec, formatMoney } from "@/lib/money";
import { getPockets, getWallet } from "@/lib/queries";
import { parseISODate, todayISO } from "@/lib/utils";
import { pocketMovementSchema, pocketSchema } from "@/lib/validators";

export async function createPocket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = pocketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const { initialAmount, ...p } = parsed.data;
  try {
    await assertOwned(user.id, { walletIds: [p.walletId], businessIds: [p.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Cuenta o negocio inválido");
    throw e;
  }
  if (initialAmount) {
    const wallet = await getWallet(user.id, p.walletId);
    if (!wallet) return fail("Cuenta no encontrada");
    if (dec(initialAmount).gt(wallet.available)) {
      return fail(`Solo tienes ${formatMoney(wallet.available, wallet.currencyCode)} disponibles en ${wallet.name}`);
    }
  }
  await prisma.pocket.create({
    data: {
      userId: user.id,
      walletId: p.walletId,
      name: p.name,
      kind: p.kind,
      businessId: p.businessId ?? null,
      targetAmount: p.targetAmount ?? null,
      targetDate: p.targetDate ? parseISODate(p.targetDate) : null,
      ...(p.color ? { color: p.color } : {}),
      ...(initialAmount
        ? { movements: { create: { amount: initialAmount, date: parseISODate(todayISO()), description: "Monto inicial" } } }
        : {}),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Apartado creado" };
}

export async function updatePocket(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = pocketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const p = parsed.data;
  const [pocket] = await getPockets(user.id, { id });
  if (!pocket) return fail("Apartado no encontrado");
  try {
    await assertOwned(user.id, { walletIds: [p.walletId], businessIds: [p.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Cuenta o negocio inválido");
    throw e;
  }
  if (p.walletId !== pocket.walletId && !pocket.balance.isZero()) {
    return fail("Libera el dinero del apartado antes de cambiarlo de cuenta");
  }
  await prisma.pocket.update({
    where: { id },
    data: {
      walletId: p.walletId,
      name: p.name,
      kind: p.kind,
      businessId: p.businessId ?? null,
      targetAmount: p.targetAmount ?? null,
      targetDate: p.targetDate ? parseISODate(p.targetDate) : null,
      ...(p.color ? { color: p.color } : {}),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Cambios guardados" };
}

/** Aparta dinero disponible de la cuenta (IN) o lo libera de vuelta a disponible (OUT). */
export async function movePocketMoney(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = pocketMovementSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const m = parsed.data;
  const [pocket] = await getPockets(user.id, { id: m.pocketId });
  if (!pocket) return fail("Apartado no encontrado");
  const amount = dec(m.amount);
  const currency = pocket.wallet.currencyCode;

  if (m.direction === "IN") {
    const wallet = await getWallet(user.id, pocket.walletId);
    if (!wallet) return fail("Cuenta no encontrada");
    if (amount.gt(wallet.available)) {
      return fail(`Solo tienes ${formatMoney(wallet.available, currency)} disponibles en ${wallet.name}`);
    }
  } else if (amount.gt(pocket.balance)) {
    return fail(`El apartado solo tiene ${formatMoney(pocket.balance, currency)}`);
  }

  await prisma.pocketMovement.create({
    data: {
      pocketId: pocket.id,
      amount: m.direction === "IN" ? amount.toString() : amount.neg().toString(),
      date: parseISODate(m.date),
      description: m.description ?? "",
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: m.direction === "IN" ? "Dinero apartado" : "Dinero liberado" };
}

export async function deletePocketMovement(id: string) {
  const user = await requireUser();
  const movement = await prisma.pocketMovement.findFirst({ where: { id, pocket: { userId: user.id } } });
  if (!movement) return;
  await prisma.pocketMovement.delete({ where: { id } });
  revalidatePath("/", "layout");
}

export async function toggleArchivePocket(id: string) {
  const user = await requireUser();
  const [pocket] = await getPockets(user.id, { id });
  // Un apartado archivado no puede seguir reteniendo dinero de la cuenta
  if (!pocket || (!pocket.archived && !pocket.balance.isZero())) return;
  await prisma.pocket.update({ where: { id }, data: { archived: !pocket.archived } });
  revalidatePath("/", "layout");
}

/** Borra el apartado; su dinero vuelve a estar disponible en la cuenta. */
export async function deletePocket(id: string) {
  const user = await requireUser();
  const pocket = await prisma.pocket.findFirst({ where: { id, userId: user.id } });
  if (!pocket) return;
  await prisma.pocket.delete({ where: { id } });
  revalidatePath("/", "layout");
}
