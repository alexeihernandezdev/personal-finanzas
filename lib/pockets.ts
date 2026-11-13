import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fail } from "@/lib/action";
import { bucketAmounts } from "@/lib/budget";
import { getFixedReserve, getMonthlyPlan } from "@/lib/fixed-reserve";
import { convert, dec, Decimal, type DecimalLike } from "@/lib/money";
import { monthRange, toISODate } from "@/lib/utils";

type Tx = Prisma.TransactionClient;
type PocketRef = { id: string; name: string; currencyCode: string; isMain: boolean; businessId: string | null };

/** Tope de saltos al encadenar repartos (Caja de un negocio → Caja Personal → …). */
const MAX_DEPTH = 5;

/** Valor del selector de apartado: la Caja del dueño de cada parte del movimiento. */
export const AUTO_POCKET = "auto";

type Ctx = {
  userId: string;
  date: Date;
  groupId: string;
  sourceTransactionId: string | null;
  /** VES por USD para cambiar de divisa */
  rate: DecimalLike | null | undefined;
  /** Repartir según el presupuesto lo que entra a una Caja */
  distribute: boolean;
  depth?: number;
  visited?: Set<string>;
};

const pocketSelect = { id: true, name: true, currencyCode: true, isMain: true, businessId: true } as const;

/** Caja de un dueño (Personal si `businessId` es null); la crea si todavía no existe. */
export async function ensureMainPocket(tx: Tx, userId: string, businessId: string | null, currency: string) {
  const found = await tx.pocket.findFirst({ where: { userId, businessId, isMain: true }, select: pocketSelect });
  if (found) return found;
  const business = businessId ? await tx.business.findFirst({ where: { id: businessId, userId } }) : null;
  return tx.pocket.create({
    data: {
      userId,
      businessId,
      currencyCode: currency,
      name: business ? `Caja ${business.name}` : "Caja Personal",
      kind: "RESERVE",
      isMain: true,
      color: business?.color ?? "#0f766e",
    },
    select: pocketSelect,
  });
}

/** Caja existente de un dueño, sin crearla. */
export function findMainPocket(tx: Tx, userId: string, businessId: string | null) {
  return tx.pocket.findFirst({ where: { userId, businessId, isMain: true, archived: false }, select: pocketSelect });
}

/**
 * Mete `amount` (en `fromCurrency`) en el apartado. Si es una Caja y `ctx.distribute`, lo reparte
 * después según el presupuesto de su dueño. Devuelve lo que entró, en la divisa del apartado.
 */
export async function allocateToPocket(
  tx: Tx,
  pocket: PocketRef,
  amount: DecimalLike,
  fromCurrency: string,
  description: string,
  ctx: Ctx,
) {
  const received = convert(amount, fromCurrency, pocket.currencyCode, ctx.rate).toDecimalPlaces(2);
  if (received.isZero()) return received;
  await tx.pocketMovement.create({
    data: {
      pocketId: pocket.id,
      amount: received.toString(),
      date: ctx.date,
      description,
      groupId: ctx.groupId,
      sourceTransactionId: ctx.sourceTransactionId,
    },
  });
  if (ctx.distribute && pocket.isMain) await distributeByBudget(tx, pocket, received, ctx);
  return received;
}

/** Saldo actual de un apartado (en su divisa). */
async function pocketBalance(tx: Tx, pocketId: string) {
  const { _sum } = await tx.pocketMovement.aggregate({ where: { pocketId }, _sum: { amount: true } });
  return dec(_sum.amount);
}

/**
 * Saca `amount` (en `fromCurrency`) del apartado, hasta su saldo: un apartado nunca queda en negativo
 * (lo que no alcanza sale del dinero sin asignar). Devuelve lo que salió, en la divisa del apartado.
 */
export async function withdrawFromPocket(
  tx: Tx,
  pocket: PocketRef,
  amount: DecimalLike,
  fromCurrency: string,
  description: string,
  ctx: Ctx,
) {
  const wanted = convert(amount, fromCurrency, pocket.currencyCode, ctx.rate).toDecimalPlaces(2);
  const taken = Decimal.min(wanted, Decimal.max(0, await pocketBalance(tx, pocket.id)));
  if (taken.lte(0)) return new Decimal(0);
  await tx.pocketMovement.create({
    data: {
      pocketId: pocket.id,
      amount: taken.neg().toString(),
      date: ctx.date,
      description,
      groupId: ctx.groupId,
      sourceTransactionId: ctx.sourceTransactionId,
    },
  });
  return taken;
}

/**
 * Reparte lo que entró a una Caja. Primero cubre los próximos gastos fijos de su dueño (y el colchón),
 * empezando por el que vence antes: lo que les falta pasa a su apartado (o se queda en la Caja si se
 * pagan de ahí). Lo que sobra se reparte entre los apartados de las partidas, con el % ajustado para que
 * a fin de mes cada una haya recibido su % del ingreso fijo. El resto (libre) se queda en la Caja.
 */
async function distributeByBudget(tx: Tx, caja: PocketRef, amount: Decimal, ctx: Ctx) {
  const depth = ctx.depth ?? 0;
  const visited = new Set(ctx.visited);
  if (depth >= MAX_DEPTH || visited.has(caja.id)) return;
  visited.add(caja.id);
  const next = { ...ctx, depth: depth + 1, visited, distribute: false };

  let rest = amount;
  const reserve = await getFixedReserve(tx, ctx.userId, caja.businessId, ctx.rate, { pocketId: caja.id, amount });
  const missing = [
    ...reserve.items.filter((i) => i.missing.gt(0)).map((i) => ({ label: i.name, key: i.pocketKey, missing: i.missing })),
    ...reserve.pockets.filter((p) => p.bufferMissing.gt(0)).map((p) => ({ label: "Colchón", key: p.key, missing: p.bufferMissing })),
  ];
  for (const m of missing) {
    if (rest.lte(0)) break;
    const pocket = reserve.pockets.find((p) => p.key === m.key)?.pocket;
    if (!pocket) continue;
    let part: Decimal;
    try {
      part = Decimal.min(rest, convert(m.missing, pocket.currencyCode, caja.currencyCode, ctx.rate).toDecimalPlaces(2, Decimal.ROUND_UP));
    } catch {
      continue;
    }
    // Si se paga desde la Caja, basta con no repartir esa parte
    if (pocket.id === caja.id) {
      rest = rest.sub(part);
      continue;
    }
    const target = { ...pocket, businessId: caja.businessId };
    const taken = await withdrawFromPocket(tx, caja, part, caja.currencyCode, `Gastos fijos: ${m.label} → ${pocket.name}`, ctx);
    rest = rest.sub(taken);
    await allocateToPocket(tx, target, taken, caja.currencyCode, `Gastos fijos: ${m.label} (de ${caja.name})`, next);
  }
  if (rest.lte(0)) return;

  const buckets = await tx.budgetBucket.findMany({
    where: { userId: ctx.userId, businessId: caja.businessId, pocket: { archived: false } },
    include: { pocket: { select: pocketSelect } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const plan = await getMonthlyPlan(tx, ctx.userId, caja.businessId, caja.currencyCode, ctx.rate);
  const planFixed = plan.fixed.mul(new Decimal(100).add(plan.bufferPercent)).div(100);
  // Lo que entra por encima del ingreso fijo del mes se reparte con el % configurado
  const before = await incomeReceivedInMonth(tx, ctx, caja);
  const extra = plan.income.gt(0) ? before.add(amount).sub(plan.income) : new Decimal(0);
  const parts = bucketAmounts(rest, extra, plan.income, planFixed, buckets);
  for (const [i, b] of buckets.entries()) {
    if (!b.pocket || b.pocket.id === caja.id) continue;
    const part = parts[i];
    if (part.isZero()) continue;
    const taken = await withdrawFromPocket(tx, caja, part, caja.currencyCode, `${b.name} → ${b.pocket.name}`, ctx);
    if (taken.isZero()) continue;
    await allocateToPocket(tx, b.pocket, taken, caja.currencyCode, `${b.name} (de ${caja.name})`, {
      ...ctx,
      depth: depth + 1,
      visited,
    });
  }
}

/**
 * Ingresos del dueño de la Caja ya recibidos en el mes de `ctx.date` (sin el que se está repartiendo),
 * en la divisa de la Caja. Los que no se pueden convertir se omiten.
 */
async function incomeReceivedInMonth(tx: Tx, ctx: Ctx, caja: PocketRef) {
  const { start, end } = monthRange(toISODate(ctx.date).slice(0, 7));
  const splits = await tx.transactionSplit.findMany({
    where: {
      businessId: caja.businessId,
      transaction: {
        userId: ctx.userId,
        type: "INCOME",
        date: { gte: start, lt: end },
        ...(ctx.sourceTransactionId ? { id: { not: ctx.sourceTransactionId } } : {}),
      },
    },
    select: { amount: true, transaction: { select: { rateVesPerUsd: true, wallet: { select: { currencyCode: true } } } } },
  });
  return splits.reduce((acc, s) => {
    try {
      const rate = s.transaction.rateVesPerUsd ?? ctx.rate;
      return acc.add(convert(s.amount, s.transaction.wallet.currencyCode, caja.currencyCode, rate));
    } catch {
      return acc;
    }
  }, new Decimal(0));
}

/**
 * Lleva un ingreso o un gasto a los apartados:
 * - `pocketId` = AUTO_POCKET: cada parte (split) entra a / sale de la Caja de su dueño.
 * - `pocketId` = id de un apartado: todo el monto entra a / sale de ese apartado.
 * - vacío: no toca los apartados (queda como dinero sin asignar).
 * Los gastos en modo automático solo salen de Cajas que ya existan.
 */
export async function applyTransactionToPockets(
  tx: Tx,
  input: {
    userId: string;
    transactionId: string;
    type: "INCOME" | "EXPENSE";
    amount: DecimalLike;
    currency: string;
    date: Date;
    label: string;
    /** Descripción completa del movimiento de apartado; por defecto "Ingreso/Gasto: label" */
    description?: string;
    splits: { businessId: string | null; amount: DecimalLike }[];
    pocketId: string | undefined;
    distribute: boolean;
    rate: DecimalLike | null | undefined;
    /** Divisa con la que se crea una Caja nueva */
    cajaCurrency: string;
  },
) {
  if (!input.pocketId) return;
  const ctx: Ctx = {
    userId: input.userId,
    date: input.date,
    groupId: randomUUID(),
    sourceTransactionId: input.transactionId,
    rate: input.rate,
    distribute: input.type === "INCOME" && input.distribute,
  };
  const description = input.description ?? `${input.type === "INCOME" ? "Ingreso" : "Gasto"}: ${input.label}`;
  const move = (pocket: PocketRef, amount: DecimalLike) =>
    input.type === "INCOME"
      ? allocateToPocket(tx, pocket, amount, input.currency, description, ctx)
      : withdrawFromPocket(tx, pocket, amount, input.currency, description, ctx);

  if (input.pocketId !== AUTO_POCKET) {
    const pocket = await tx.pocket.findFirst({
      where: { id: input.pocketId, userId: input.userId, archived: false },
      select: pocketSelect,
    });
    if (!pocket) throw new PocketError("Apartado no encontrado");
    await move(pocket, input.amount);
    return;
  }

  // Agrupa por dueño (las partes de un mismo negocio van juntas)
  const byOwner = new Map<string | null, Decimal>();
  for (const s of input.splits) byOwner.set(s.businessId, (byOwner.get(s.businessId) ?? new Decimal(0)).add(dec(s.amount)));
  for (const [businessId, amount] of byOwner) {
    const pocket =
      input.type === "INCOME"
        ? await ensureMainPocket(tx, input.userId, businessId, input.cajaCurrency)
        : await findMainPocket(tx, input.userId, businessId);
    if (pocket) await move(pocket, amount);
  }
}

/** Deshace lo que un ingreso o gasto hizo en los apartados (no toca los repartos manuales del presupuesto). */
export function revertTransactionPockets(tx: Tx, transactionId: string) {
  return tx.pocketMovement.deleteMany({ where: { sourceTransactionId: transactionId, groupId: { not: null } } });
}

/**
 * Lo que un ingreso ya dejó apartado (neto, en `currency`): sus entradas a apartados menos lo que salió
 * de ellas al repartir. `manualOnly`: solo los repartos manuales del presupuesto (sin `groupId`).
 */
export async function allocatedFromTransaction(
  tx: Pick<Tx, "pocketMovement">,
  transactionId: string,
  currency: string,
  rate: DecimalLike | null | undefined,
  opts: { manualOnly?: boolean } = {},
) {
  const rows = await tx.pocketMovement.findMany({
    where: { sourceTransactionId: transactionId, ...(opts.manualOnly ? { groupId: null } : {}) },
    select: { amount: true, pocket: { select: { currencyCode: true } } },
  });
  return rows.reduce((acc, m) => acc.add(convert(m.amount, m.pocket.currencyCode, currency, rate)), new Decimal(0));
}

/** Apartado al que fue a parar (o del que salió) un movimiento sin reparto; null si no tocó ninguno. */
export async function pocketOfTransaction(tx: Tx, transactionId: string) {
  const first = await tx.pocketMovement.findFirst({
    where: { sourceTransactionId: transactionId, groupId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { pocketId: true },
  });
  return first?.pocketId ?? null;
}

export class PocketError extends Error {}

/** Errores de conversión o de apartado se devuelven al formulario en vez de romper la página. */
export function pocketFailure(e: unknown) {
  if (e instanceof PocketError) return fail(e.message);
  if (e instanceof Error && /tasa|Conversión/.test(e.message)) {
    return fail("No hay tasa disponible para convertir a la divisa del apartado");
  }
  throw e;
}
