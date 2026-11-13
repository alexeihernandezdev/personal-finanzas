import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dec } from "@/lib/money";
import { currentFallbackRate, paidAmount } from "@/lib/queries";

type Db = Prisma.TransactionClient | typeof prisma;

/** Recalcula el estado de una deuda según lo pagado. */
export async function recomputeDebtStatus(debtId: string, db: Db = prisma) {
  const d = await db.debt.findUnique({
    where: { id: debtId },
    include: { transactions: { include: { wallet: { select: { currencyCode: true } } } } },
  });
  if (!d || d.status === "CANCELLED") return;
  const paid = paidAmount(d, await currentFallbackRate());
  const status = paid.isZero()
    ? "PENDING"
    : paid.toDecimalPlaces(2).gte(dec(d.amount).toDecimalPlaces(2))
      ? "SETTLED"
      : "PARTIAL";
  if (status !== d.status) await db.debt.update({ where: { id: d.id }, data: { status } });
}
