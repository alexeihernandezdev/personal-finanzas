"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { SUGGESTED_BUCKETS } from "@/lib/budget";
import { assertOwned, OwnershipError, snapshotRate } from "@/lib/guards";
import { convert, dec, Decimal, formatMoney } from "@/lib/money";
import { ensureMainPocket } from "@/lib/pockets";
import { getMoneySummary } from "@/lib/queries";
import { parseISODate, todayISO } from "@/lib/utils";
import { budgetBucketSchema, fixedBufferSchema, normalizeAmount } from "@/lib/validators";

/** Dueño del presupuesto que llega en el formulario: un negocio del usuario o null (Personal). */
async function ownerFrom(userId: string, formData: FormData) {
  const raw = formData.get("businessId");
  const businessId = typeof raw === "string" && raw ? raw : null;
  try {
    await assertOwned(userId, { businessIds: [businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return undefined;
    throw e;
  }
  return businessId;
}

/** Valor del selector de apartado que manda la partida a la Caja de un dueño: `owner:personal` u `owner:<negocioId>`. */
const OWNER_PREFIX = "owner:";

/**
 * Apartado destino de una partida. Si se eligió un dueño (p. ej. Personal), se usa su Caja y se crea
 * si todavía no existe. Devuelve `undefined` si el apartado o el negocio no son del usuario.
 */
async function resolveTarget(user: { id: string; displayCurrency: string }, raw: string | undefined) {
  if (!raw) return null;
  if (raw.startsWith(OWNER_PREFIX)) {
    const key = raw.slice(OWNER_PREFIX.length);
    const businessId = key === "personal" ? null : key;
    try {
      await assertOwned(user.id, { businessIds: [businessId] });
    } catch (e) {
      if (e instanceof OwnershipError) return undefined;
      throw e;
    }
    const caja = await prisma.$transaction((tx) => ensureMainPocket(tx, user.id, businessId, user.displayCurrency));
    return caja.id;
  }
  const owned = await prisma.pocket.count({ where: { id: raw, userId: user.id, archived: false } });
  return owned === 1 ? raw : undefined;
}

/** Lo que entra a la Caja se reparte entre las partidas: entre todas no pueden pasar del 100%. */
async function exceedsTotal(userId: string, businessId: string | null, percent: string, exceptId?: string) {
  const others = await prisma.budgetBucket.aggregate({
    where: { userId, businessId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    _sum: { percent: true },
  });
  const used = dec(others._sum.percent);
  if (used.add(percent).lte(100)) return null;
  return fail(`Las partidas de este presupuesto suman ${used.toString()}%: te queda ${Decimal.max(0, new Decimal(100).sub(used)).toString()}%`);
}

export async function createBudgetBucket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = budgetBucketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const businessId = await ownerFrom(user.id, formData);
  if (businessId === undefined) return fail("Negocio inválido");
  const over = await exceedsTotal(user.id, businessId, parsed.data.percent);
  if (over) return over;
  const pocketId = await resolveTarget(user, parsed.data.pocketId);
  if (pocketId === undefined) return fail("Apartado no encontrado");
  const last = await prisma.budgetBucket.aggregate({ where: { userId: user.id, businessId }, _max: { position: true } });
  const position = (last._max.position ?? -1) + 1;
  await prisma.budgetBucket.create({ data: { userId: user.id, businessId, ...parsed.data, pocketId, position } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Partida creada" };
}

export async function updateBudgetBucket(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = budgetBucketSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const bucket = await prisma.budgetBucket.findFirst({ where: { id, userId: user.id }, select: { businessId: true } });
  if (!bucket) return fail("Partida no encontrada");
  const over = await exceedsTotal(user.id, bucket.businessId, parsed.data.percent, id);
  if (over) return over;
  const pocketId = await resolveTarget(user, parsed.data.pocketId);
  if (pocketId === undefined) return fail("Apartado no encontrado");
  await prisma.budgetBucket.update({ where: { id }, data: { ...parsed.data, pocketId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteBudgetBucket(id: string) {
  const user = await requireUser();
  await prisma.budgetBucket.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/", "layout");
}

/** Sube o baja una partida un lugar dentro de su presupuesto; renumera para que queden consecutivas. */
export async function moveBudgetBucket(id: string, direction: "up" | "down") {
  const user = await requireUser();
  const bucket = await prisma.budgetBucket.findFirst({ where: { id, userId: user.id }, select: { businessId: true } });
  if (!bucket) return;
  const buckets = await prisma.budgetBucket.findMany({
    where: { userId: user.id, businessId: bucket.businessId },
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

/** Crea las partidas sugeridas en el presupuesto de un dueño (solo si aún no tiene ninguna). */
export async function createSuggestedBuckets(businessId: string | null) {
  const user = await requireUser();
  try {
    await assertOwned(user.id, { businessIds: [businessId] });
  } catch (e) {
    if (e instanceof OwnershipError) return;
    throw e;
  }
  if (await prisma.budgetBucket.count({ where: { userId: user.id, businessId } })) return;
  await prisma.budgetBucket.createMany({
    data: SUGGESTED_BUCKETS.map((b, position) => ({ userId: user.id, businessId, ...b, position })),
  });
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

/**
 * Reparte un ingreso entre los apartados de las partidas (campos `amount:<bucketId>`, en la divisa del
 * ingreso). Si el apartado está en otra cuenta registra primero la transferencia y luego aparta el dinero.
 */
export async function distributeIncome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const incomeId = formData.get("incomeId");
  if (typeof incomeId !== "string" || !incomeId) return fail("Elige un ingreso");
  const income = await prisma.transaction.findFirst({
    where: { id: incomeId, userId: user.id, type: "INCOME" },
    include: { wallet: true },
  });
  if (!income) return fail("Ingreso no encontrado");

  const businessId = await ownerFrom(user.id, formData);
  if (businessId === undefined) return fail("Negocio inválido");
  const buckets = await prisma.budgetBucket.findMany({
    where: { userId: user.id, businessId, pocket: { archived: false } },
    include: { pocket: true },
  });
  const lines: { name: string; pocketId: string; currency: string; amount: Decimal }[] = [];
  for (const b of buckets) {
    const raw = formData.get(`amount:${b.id}`);
    if (typeof raw !== "string" || !raw.trim() || !b.pocket) continue;
    const n = normalizeAmount(raw);
    if (n === null) return fail(`Monto inválido en ${b.name}`);
    const amount = dec(n);
    if (amount.isZero()) continue;
    lines.push({ name: b.name, pocketId: b.pocket.id, currency: b.pocket.currencyCode, amount });
  }
  if (!lines.length) return fail("Indica al menos un monto");

  const from = income.wallet;
  const total = lines.reduce((acc, l) => acc.add(l.amount), new Decimal(0));
  const rate = await snapshotRate(user.preferredRateSource);
  // Lo apartado sale del dinero libre de todas las cuentas
  const { available } = await getMoneySummary(user.id, from.currencyCode, rate.rateVesPerUsd);
  if (total.gt(available)) {
    return fail(`Solo tienes ${formatMoney(available, from.currencyCode)} disponibles para apartar`);
  }

  // Para cambiar de divisa se usa la tasa del día del ingreso; si no la tiene, la actual
  const conversionRate = income.rateVesPerUsd ?? rate.rateVesPerUsd;
  const date = parseISODate(todayISO());
  const source = income.description || "ingreso";
  let received: Decimal[];
  try {
    received = lines.map((l) => convert(l.amount, from.currencyCode, l.currency, conversionRate).toDecimalPlaces(2));
  } catch {
    return fail("No hay tasa disponible para convertir a la divisa de los apartados");
  }

  await prisma.$transaction(async (tx) => {
    for (const [i, l] of lines.entries()) {
      const description = `Presupuesto: ${l.name} (${source})`;
      await tx.pocketMovement.create({
        data: { pocketId: l.pocketId, amount: received[i].toString(), date, description, sourceTransactionId: income.id },
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, message: lines.length === 1 ? "Dinero apartado" : `Repartido en ${lines.length} apartados` };
}
