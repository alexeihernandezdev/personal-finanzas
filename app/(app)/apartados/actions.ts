"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import type { RateSource } from "@/lib/generated/prisma/client";
import { assertOwned, OwnershipError, rateForDate } from "@/lib/guards";
import { SUGGESTED_POCKETS } from "@/lib/budget";
import { ensureFixedReservePocket } from "@/lib/fixed-reserve";
import { OwnerPayError, payOwnerSalary, undoOwnerSalary } from "@/lib/owner-pay";
import { dec, Decimal, formatMoney, type DecimalLike } from "@/lib/money";
import { allocateToPocket, ensureMainPocket, withdrawFromPocket } from "@/lib/pockets";
import { getMoneySummary, getPockets } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { parseISODate, todayISO } from "@/lib/utils";
import { fixedBufferSchema, ownerPaymentSchema, ownerPaySchema, pocketMovementSchema, pocketSchema, pocketTransferSchema } from "@/lib/validators";

/** Lo apartado sale del dinero libre de todas las cuentas; avisa si no alcanza. */
async function checkAvailable(user: { id: string; preferredRateSource: RateSource }, amount: DecimalLike, currency: string) {
  const rate = pickRate(await getCurrentRates(), user.preferredRateSource);
  const { available } = await getMoneySummary(user.id, currency, rate);
  if (dec(amount).gt(available)) return fail(`Solo tienes ${formatMoney(available, currency)} disponibles para apartar`);
  return null;
}

/** Lo que entra a la Caja de un dueño se reparte entre sus apartados con %: entre todos no pueden pasar del 100%. */
async function exceedsTotal(userId: string, businessId: string | null, percent: string | null, exceptPocketId?: string) {
  if (!percent) return null;
  const others = await prisma.pocket.aggregate({
    where: {
      userId,
      businessId,
      archived: false,
      isMain: false,
      isFixedReserve: false,
      ...(exceptPocketId ? { id: { not: exceptPocketId } } : {}),
    },
    _sum: { percent: true },
  });
  const used = dec(others._sum.percent);
  if (used.add(percent).lte(100)) return null;
  return fail(`Los apartados de este dueño ya suman ${used.toString()}%: te queda ${Decimal.max(0, new Decimal(100).sub(used)).toString()}%`);
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
  const over = await exceedsTotal(user.id, p.businessId ?? null, p.percent);
  if (over) return over;
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
      percent: p.percent,
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
  // La Caja (lo que sobra) y Gastos fijos (según los gastos fijos) no tienen % propio
  const businessId = pocket.isMain || pocket.isFixedReserve ? pocket.businessId : (p.businessId ?? null);
  const percent = pocket.isMain || pocket.isFixedReserve ? null : p.percent;
  const over = await exceedsTotal(user.id, businessId, percent, id);
  if (over) return over;
  await prisma.pocket.update({
    where: { id },
    data: {
      currencyCode: p.currencyCode,
      name: p.name,
      kind: p.kind,
      // La Caja y Gastos fijos siempre son del mismo dueño
      businessId,
      percent,
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

/** Borra un movimiento de apartado; si es parte de una operación (traspaso, reparto), la borra entera. */
export async function deletePocketMovement(id: string) {
  const user = await requireUser();
  const movement = await prisma.pocketMovement.findFirst({ where: { id, pocket: { userId: user.id } } });
  if (!movement) return;
  if (movement.groupId) {
    await prisma.pocketMovement.deleteMany({ where: { groupId: movement.groupId, pocket: { userId: user.id } } });
  } else {
    await prisma.pocketMovement.delete({ where: { id } });
  }
  revalidatePath("/", "layout");
}

/**
 * Pasa dinero de un apartado a otro: un monto fijo o un % del saldo o de una entrada concreta del
 * apartado (p. ej. el 20% del ingreso de 300 de un negocio a la Caja Personal). Si el destino es una
 * Caja y se pide, se reparte entre sus apartados.
 */
export async function transferPocketMoney(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = pocketTransferSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const t = parsed.data;
  const [[from], to] = await Promise.all([
    getPockets(user.id, { id: t.fromPocketId }),
    prisma.pocket.findFirst({ where: { id: t.toPocketId, userId: user.id, archived: false } }),
  ]);
  if (!from) return fail("Apartado no encontrado");
  if (!to) return fail("Elige a qué apartado pasa");

  let amount = dec(t.value);
  if (t.mode === "percent") {
    let base = from.balance;
    if (t.base !== "balance") {
      const entry = await prisma.pocketMovement.findFirst({ where: { id: t.base, pocketId: from.id } });
      if (!entry || !entry.amount.gt(0)) return fail("Elige una entrada del apartado");
      base = dec(entry.amount);
    }
    amount = base.mul(amount).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  }
  if (!amount.gt(0)) return fail("No hay nada que pasar");
  if (amount.gt(from.balance)) return fail(`${from.name} solo tiene ${formatMoney(from.balance, from.currencyCode)}`);

  const { rateVesPerUsd } = await rateForDate(user.preferredRateSource, t.date);
  const ctx = {
    userId: user.id,
    date: parseISODate(t.date),
    groupId: randomUUID(),
    sourceTransactionId: null,
    rate: rateVesPerUsd,
    distribute: t.distribute,
  };
  const note = t.description ? ` · ${t.description}` : "";
  try {
    await prisma.$transaction(async (tx) => {
      await withdrawFromPocket(tx, from, amount, from.currencyCode, `A ${to.name}${note}`, ctx);
      await allocateToPocket(tx, to, amount, from.currencyCode, `De ${from.name}${note}`, ctx);
    });
  } catch (e) {
    if (e instanceof Error && /tasa|Conversión/.test(e.message)) {
      return fail("No hay tasa disponible para convertir a la divisa del destino");
    }
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Pasaste ${formatMoney(amount, from.currencyCode)} a ${to.name}` };
}

/** Crea la Caja de un dueño (Personal si `businessId` es null) si todavía no la tiene. */
export async function createMainPocket(businessId: string | null) {
  const user = await requireUser();
  try {
    await assertOwned(user.id, { businessIds: [businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return;
    throw e;
  }
  await prisma.$transaction((tx) => ensureMainPocket(tx, user.id, businessId, user.displayCurrency));
  revalidatePath("/", "layout");
}

export async function toggleArchivePocket(id: string) {
  const user = await requireUser();
  const [pocket] = await getPockets(user.id, { id });
  // Un apartado archivado no puede seguir reteniendo dinero; la Caja no se archiva
  if (!pocket || pocket.isMain || (!pocket.archived && !pocket.balance.isZero())) return;
  await prisma.pocket.update({ where: { id }, data: { archived: !pocket.archived } });
  revalidatePath("/", "layout");
}

/** Fija o quita el apartado del inicio. */
export async function togglePinPocket(id: string) {
  const user = await requireUser();
  const pocket = await prisma.pocket.findFirst({ where: { id, userId: user.id }, select: { pinned: true } });
  if (!pocket) return;
  await prisma.pocket.update({ where: { id }, data: { pinned: !pocket.pinned } });
  revalidatePath("/", "layout");
}

/** Borra el apartado; su dinero vuelve a estar disponible. */
export async function deletePocket(id: string) {
  const user = await requireUser();
  const [pocket] = await getPockets(user.id, { id });
  // La Caja solo se borra vacía (se vuelve a crear con el próximo ingreso)
  if (!pocket || (pocket.isMain && !pocket.balance.isZero())) return;
  await prisma.pocket.delete({ where: { id } });
  revalidatePath("/", "layout");
}

/** Valida que el dueño que llega del cliente sea Personal (null) o un negocio del usuario. */
async function ownedBusiness(userId: string, businessId: string | null) {
  try {
    await assertOwned(userId, { businessIds: [businessId] });
    return true;
  } catch (e) {
    if (e instanceof OwnershipError) return false;
    throw e;
  }
}

/** Crea los apartados sugeridos (Ahorro, Inversión, Ocio) de un dueño si aún no tiene ninguno con %. */
export async function createSuggestedPockets(businessId: string | null) {
  const user = await requireUser();
  if (!(await ownedBusiness(user.id, businessId))) return;
  const existing = await prisma.pocket.count({ where: { userId: user.id, businessId, archived: false, percent: { gt: 0 } } });
  if (existing) return;
  await prisma.pocket.createMany({
    data: SUGGESTED_POCKETS.map((p) => ({
      userId: user.id,
      businessId,
      currencyCode: user.displayCurrency,
      name: p.name,
      percent: p.percent,
      color: p.color,
    })),
  });
  revalidatePath("/", "layout");
}

/**
 * Sueldo del dueño de un negocio: un monto fijo al mes (se reserva como un gasto fijo del negocio y
 * cuenta como ingreso fijo Personal) o un % de la ganancia de cada mes.
 */
export async function updateOwnerPay(businessId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = ownerPaySchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const business = await prisma.business.findFirst({ where: { id: businessId, userId: user.id } });
  if (!business) return fail("Negocio no encontrado");
  const d = parsed.data;
  await prisma.business.update({
    where: { id: businessId },
    data: {
      ownerPayMode: d.mode,
      ownerPayPercent: d.mode === "PROFIT_PERCENT" ? d.percent : null,
      ownerPayAmount: d.mode === "FIXED" ? d.amount : null,
      ownerPayCurrency: d.mode === "FIXED" ? (d.currencyCode ?? user.displayCurrency) : null,
    },
  });
  // El sueldo fijo se va reservando en el apartado "Gastos fijos" del negocio
  if (d.mode === "FIXED") await ensureFixedReservePocket(prisma, user.id, businessId, user.displayCurrency);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Te pagas el sueldo de un mes: pasa de los apartados del negocio a tu Caja Personal (ver `payOwnerSalary`). */
export async function payOwner(businessId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = ownerPaymentSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const { month, amount } = parsed.data;
  const business = await prisma.business.findFirst({ where: { id: businessId, userId: user.id } });
  if (!business) return fail("Negocio no encontrado");
  try {
    await payOwnerSalary(user, business, month, amount);
  } catch (e) {
    if (e instanceof OwnerPayError) return fail(e.message);
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Te pagaste ${formatMoney(amount, user.displayCurrency)} de ${business.name}` };
}

/** Deshace el pago de un sueldo: el dinero vuelve a los apartados del negocio. */
export async function undoOwnerPay(id: string) {
  const user = await requireUser();
  await undoOwnerSalary(user.id, id);
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
