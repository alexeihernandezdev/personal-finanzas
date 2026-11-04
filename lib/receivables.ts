import "server-only";
import { prisma } from "@/lib/db";
import { dec } from "@/lib/money";
import { collectedAmount } from "@/lib/queries";

/** Recalcula el estado de una cuenta por cobrar según lo cobrado. */
export async function recomputeReceivableStatus(receivableId: string) {
  const r = await prisma.receivable.findUnique({
    where: { id: receivableId },
    include: { transactions: { include: { wallet: { select: { currencyCode: true } } } } },
  });
  if (!r || r.status === "CANCELLED") return;
  const collected = collectedAmount(r);
  const status = collected.isZero()
    ? "PENDING"
    : collected.toDecimalPlaces(2).gte(dec(r.amount).toDecimalPlaces(2))
      ? "SETTLED"
      : "PARTIAL";
  if (status !== r.status) await prisma.receivable.update({ where: { id: r.id }, data: { status } });
}
