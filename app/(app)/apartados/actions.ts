"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import type { RateSource } from "@/lib/generated/prisma/client";
import { assertOwned, OwnershipError } from "@/lib/guards";
import { dec, formatMoney, type DecimalLike } from "@/lib/money";
import { getMoneySummary, getPockets } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { parseISODate, todayISO } from "@/lib/utils";
import { pocketMovementSchema, pocketSchema } from "@/lib/validators";

/** Lo apartado sale del dinero libre de todas las cuentas; avisa si no alcanza. */
async function checkAvailable(user: { id: string; preferredRateSource: RateSource }, amount: DecimalLike, currency: string) {
  const rate = pickRate(await getCurrentRates(), user.preferredRateSource);
  const { available } = await getMoneySummary(user.id, currency, rate);
  if (dec(amount).gt(available)) return fail(`Solo tienes ${formatMoney(available, currency)} disponibles para apartar`);
  return null;
}

export async function createPocket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = pocketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const { initialAmount, ...p } = parsed.data;
  try {
    await assertOwned(user.id, { businessIds: [p.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Negocio inválido");
    throw e;
  }
  if (initialAmount) {
    const error = await checkAvailable(user, initialAmount, p.currencyCode);
    if (error) return error;
  }
  await prisma.pocket.create({
    data: {
      userId: user.id,
      currencyCode: p.currencyCode,
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
    await assertOwned(user.id, { businessIds: [p.businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return fail("Negocio inválido");
    throw e;
  }
  if (p.currencyCode !== pocket.currencyCode && !pocket.balance.isZero()) {
    return fail("Libera el dinero del apartado antes de cambiarle la moneda");
  }
  await prisma.pocket.update({
    where: { id },
    data: {
      currencyCode: p.currencyCode,
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

/** Aparta dinero disponible (IN) o lo libera de vuelta a disponible (OUT). */
export async function movePocketMoney(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = pocketMovementSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const m = parsed.data;
  const [pocket] = await getPockets(user.id, { id: m.pocketId });
  if (!pocket) return fail("Apartado no encontrado");
  const amount = dec(m.amount);
  const currency = pocket.currencyCode;

  if (m.direction === "IN") {
    const error = await checkAvailable(user, amount, currency);
    if (error) return error;
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
  // Un apartado archivado no puede seguir reteniendo dinero
  if (!pocket || (!pocket.archived && !pocket.balance.isZero())) return;
  await prisma.pocket.update({ where: { id }, data: { archived: !pocket.archived } });
  revalidatePath("/", "layout");
}

/** Borra el apartado; su dinero vuelve a estar disponible. */
export async function deletePocket(id: string) {
  const user = await requireUser();
  const pocket = await prisma.pocket.findFirst({ where: { id, userId: user.id } });
  if (!pocket) return;
  await prisma.pocket.delete({ where: { id } });
  revalidatePath("/", "layout");
}
