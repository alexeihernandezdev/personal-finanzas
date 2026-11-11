import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { convert, dec, Decimal, type DecimalLike } from "@/lib/money";

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

/** Saca `amount` (en `fromCurrency`) del apartado. */
export async function withdrawFromPocket(
  tx: Tx,
  pocket: PocketRef,
  amount: DecimalLike,
  fromCurrency: string,
  description: string,
  ctx: Ctx,
) {
  const taken = convert(amount, fromCurrency, pocket.currencyCode, ctx.rate).toDecimalPlaces(2);
  if (taken.isZero()) return taken;
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
 * Reparte lo que entró a una Caja entre los apartados de las partidas de su dueño (cada una su %).
 * Lo que no cubren las partidas (gastos fijos, colchón, libre) se queda en la Caja.
 */
async function distributeByBudget(tx: Tx, caja: PocketRef, amount: Decimal, ctx: Ctx) {
  const depth = ctx.depth ?? 0;
  const visited = new Set(ctx.visited);
  if (depth >= MAX_DEPTH || visited.has(caja.id)) return;
  visited.add(caja.id);

  const buckets = await tx.budgetBucket.findMany({
    where: { userId: ctx.userId, businessId: caja.businessId, pocket: { archived: false } },
    include: { pocket: { select: pocketSelect } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  for (const b of buckets) {
    if (!b.pocket || b.pocket.id === caja.id) continue;
    const part = amount.mul(dec(b.percent)).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (part.isZero()) continue;
    await withdrawFromPocket(tx, caja, part, caja.currencyCode, `${b.name} → ${b.pocket.name}`, ctx);
    await allocateToPocket(tx, b.pocket, part, caja.currencyCode, `${b.name} (de ${caja.name})`, {
      ...ctx,
      depth: depth + 1,
      visited,
    });
  }
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
  const description = `${input.type === "INCOME" ? "Ingreso" : "Gasto"}: ${input.label}`;
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

export class PocketError extends Error {}
