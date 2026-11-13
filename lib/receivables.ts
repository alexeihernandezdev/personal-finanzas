import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dec } from "@/lib/money";
import { collectedAmount, currentFallbackRate } from "@/lib/queries";

type Db = Prisma.TransactionClient | typeof prisma;

/** Recalcula el estado de una cuenta por cobrar según lo cobrado. */
export async function recomputeReceivableStatus(receivableId: string, db: Db = prisma) {
  const r = await db.receivable.findUnique({
    where: { id: receivableId },
    include: { transactions: { include: { wallet: { select: { currencyCode: true } } } } },
  });
  if (!r || r.status === "CANCELLED") return;
  const collected = collectedAmount(r, await currentFallbackRate());
  const status = collected.isZero()
    ? "PENDING"
    : collected.toDecimalPlaces(2).gte(dec(r.amount).toDecimalPlaces(2))
      ? "SETTLED"
      : "PARTIAL";
  if (status !== r.status) await db.receivable.update({ where: { id: r.id }, data: { status } });
}
