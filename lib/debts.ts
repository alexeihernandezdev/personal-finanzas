import "server-only";
import { prisma } from "@/lib/db";
import { dec } from "@/lib/money";
import { paidAmount } from "@/lib/queries";

/** Recalcula el estado de una deuda según lo pagado. */
export async function recomputeDebtStatus(debtId: string) {
  const d = await prisma.debt.findUnique({
    where: { id: debtId },
    include: { transactions: { include: { wallet: { select: { currencyCode: true } } } } },
  });
  if (!d || d.status === "CANCELLED") return;
  const paid = paidAmount(d);
  const status = paid.isZero()
    ? "PENDING"
    : paid.toDecimalPlaces(2).gte(dec(d.amount).toDecimalPlaces(2))
      ? "SETTLED"
      : "PARTIAL";
  if (status !== d.status) await prisma.debt.update({ where: { id: d.id }, data: { status } });
}
