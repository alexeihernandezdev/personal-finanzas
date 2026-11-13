import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fail } from "@/lib/action";
import { planDistribution } from "@/lib/budget";
import { ensureFixedReservePocket, getMonthlyPlan, receivedInMonth } from "@/lib/fixed-reserve";
import { convert, dec, Decimal, type DecimalLike } from "@/lib/money";
import { toISODate } from "@/lib/utils";

type Tx = Prisma.TransactionClient;
type PocketRef = { id: string; name: string; currencyCode: string; isMain: boolean; businessId: string | null };

/** Tope de saltos al encadenar repartos (Caja de un negocio → sueldo a la Caja Personal → …). */
const MAX_DEPTH = 5;

/** Valor del selector de apartado: la Caja del dueño del movimiento. */
export const AUTO_POCKET = "auto";

type Ctx = {
  userId: string;
  date: Date;
  groupId: string;
  sourceTransactionId: string | null;
  /** VES por USD para cambiar de divisa */
  rate: DecimalLike | null | undefined;
  /** Repartir en sus apartados lo que entra a una Caja */
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
 * después entre los apartados de su dueño. Devuelve lo que entró, en la divisa del apartado.
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
 * Reparte lo que entró a una Caja según el plan de su dueño (ver `planDistribution`): su parte de
 * gastos fijos va al apartado "Gastos fijos", cada apartado con porcentaje se lleva el suyo y, si es
 * un negocio con sueldo, ese % pasa a la Caja Personal (que lo vuelve a repartir). Lo libre se queda en la Caja.
 */
async function distributeByBudget(tx: Tx, caja: PocketRef, amount: Decimal, ctx: Ctx) {
  const depth = ctx.depth ?? 0;
  const visited = new Set(ctx.visited);
  if (depth >= MAX_DEPTH || visited.has(caja.id)) return;
  visited.add(caja.id);

  const plan = await getMonthlyPlan(tx, ctx.userId, caja.businessId, caja.currencyCode, ctx.rate);
  const pockets = await tx.pocket.findMany({
    where: { userId: ctx.userId, businessId: caja.businessId, archived: false, isMain: false, isFixedReserve: false, percent: { gt: 0 } },
    select: { ...pocketSelect, percent: true },
    orderBy: { createdAt: "asc" },
  });
  const business = caja.businessId
    ? await tx.business.findUnique({ where: { id: caja.businessId }, select: { ownerPayPercent: true } })
    : null;
  const fixedPocket = plan.fixed.gt(0)
    ? await ensureFixedReservePocket(tx, ctx.userId, caja.businessId, caja.currencyCode)
    : null;
  // Sin ingreso fijo, los gastos fijos se llevan lo que les falta para el mes
  let fixedMissing = new Decimal(0);
  if (fixedPocket && plan.income.isZero()) {
    try {
      const received = convert(await receivedInMonth(tx, fixedPocket.id, toISODate(ctx.date).slice(0, 7)), fixedPocket.currencyCode, caja.currencyCode, ctx.rate);
      fixedMissing = plan.fixedWithBuffer.sub(received);
    } catch {
      // Sin tasa: no se reservan los gastos fijos
    }
  }
  const ownerPay = dec(business?.ownerPayPercent);
  const targets: { label: string; pocket: PocketRef; distribute: boolean }[] = pockets.map((p) => ({ label: p.name, pocket: p, distribute: false }));
  const percents: DecimalLike[] = pockets.map((p) => p.percent ?? 0);
  if (caja.businessId && ownerPay.gt(0)) {
    const personal = await ensureMainPocket(tx, ctx.userId, null, caja.currencyCode);
    targets.push({ label: "Sueldo", pocket: personal, distribute: true });
    percents.push(ownerPay);
  }

  const parts = planDistribution(amount, { planIncome: plan.income, planFixed: plan.fixedWithBuffer, fixedMissing, percents });
  const moves = [
    ...(fixedPocket ? [{ label: "Gastos fijos", pocket: fixedPocket, distribute: false, amount: parts.fixed }] : []),
    ...targets.map((t, i) => ({ ...t, amount: parts.parts[i] })),
  ];
  for (const m of moves) {
    if (!m.amount.gt(0) || m.pocket.id === caja.id) continue;
    const taken = await withdrawFromPocket(tx, caja, m.amount, caja.currencyCode, `${m.label} → ${m.pocket.name}`, ctx);
    if (taken.isZero()) continue;
    await allocateToPocket(tx, m.pocket, taken, caja.currencyCode, `${m.label} (de ${caja.name})`, {
      ...ctx,
      distribute: m.distribute,
      depth: depth + 1,
      visited,
    });
  }
}

/**
 * Lleva un ingreso o un gasto a los apartados:
 * - `pocketId` = AUTO_POCKET: entra a / sale de la Caja de su dueño.
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
    /** Dueño del movimiento: null = Personal */
    businessId: string | null;
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

  const pocket =
    input.type === "INCOME"
      ? await ensureMainPocket(tx, input.userId, input.businessId, input.cajaCurrency)
      : await findMainPocket(tx, input.userId, input.businessId);
  if (pocket) await move(pocket, input.amount);
}

/** Deshace lo que un ingreso o gasto hizo en los apartados. */
export function revertTransactionPockets(tx: Tx, transactionId: string) {
  return tx.pocketMovement.deleteMany({ where: { sourceTransactionId: transactionId } });
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
