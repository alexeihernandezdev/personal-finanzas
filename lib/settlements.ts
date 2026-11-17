import "server-only";
import { recomputeDebtStatus } from "@/lib/debts";
import type { Prisma } from "@/lib/generated/prisma/client";
import { convert, dec, formatMoney, type DecimalLike } from "@/lib/money";
import { applyTransactionToPockets } from "@/lib/pockets";
import { recomputeReceivableStatus } from "@/lib/receivables";
import { parseISODate } from "@/lib/utils";

type Tx = Prisma.TransactionClient;
type Rate = { rateVesPerUsd: string | null; rateSource: "BCV" | "BINANCE" | null };
type User = { id: string; displayCurrency: string };

type Ledger = {
  id: string;
  counterparty: string;
  description: string;
  currencyCode: string;
  businessId: string | null;
};

export type SettlementInput = {
  walletId: string;
  walletCurrency: string;
  amount: string;
  date: string;
  /** Apartado: "auto" = Caja del dueño, vacío = ninguno */
  pocketId: string | undefined;
  rate: Rate;
  /** Categoría del sistema (Cobros / Pagos de deudas); null en préstamos */
  categoryId: string | null;
};

/**
 * Pagos que caben en lo que falta de un registro (con 1 céntimo de margen). Devuelve el mensaje de
 * error si se pasan; `payments` en la divisa de la cuenta de cada uno.
 */
export function exceedsRemaining(
  remaining: DecimalLike,
  currency: string,
  payments: { amount: string; walletCurrency: string; rate: string | null }[],
  verb: "cobrar" | "pagar",
): string | null {
  let total = dec(0);
  try {
    for (const p of payments) total = total.add(convert(p.amount, p.walletCurrency, currency, p.rate));
  } catch {
    return `No hay tasa disponible para comparar ${verb === "cobrar" ? "el cobro" : "el pago"} con lo pendiente`;
  }
  const left = dec(remaining).toDecimalPlaces(2);
  if (total.toDecimalPlaces(2).gt(left.add("0.01"))) return `Solo faltan ${formatMoney(left, currency)} por ${verb}`;
  return null;
}

/** Cobro de una cuenta por cobrar o devolución de un préstamo dado. Debe correr dentro de una `prisma.$transaction`. */
export async function insertReceivablePayment(
  tx: Tx,
  user: User,
  r: Ledger & { kind: "RECEIVABLE" | "LOAN_GIVEN" },
  p: SettlementInput & { distribute: boolean },
) {
  const isLoan = r.kind === "LOAN_GIVEN";
  const date = parseISODate(p.date);
  const description = isLoan ? `Devolución de ${r.counterparty}` : `Cobro: ${r.counterparty}${r.description ? ` · ${r.description}` : ""}`;
  const created = await tx.transaction.create({
    data: {
      userId: user.id,
      walletId: p.walletId,
      type: isLoan ? "LOAN_REPAYMENT" : "INCOME",
      amount: p.amount,
      date,
      description,
      receivableId: r.id,
      categoryId: isLoan ? null : p.categoryId,
      ...p.rate,
      businessId: r.businessId,
    },
  });
  // Lo cobrado entra al apartado elegido; solo un cobro (no una devolución) se reparte entre los apartados
  await applyTransactionToPockets(tx, {
    userId: user.id,
    transactionId: created.id,
    type: "INCOME",
    amount: p.amount,
    currency: p.walletCurrency,
    date,
    label: r.counterparty,
    description,
    businessId: r.businessId,
    pocketId: p.pocketId,
    distribute: !isLoan && p.distribute,
    rate: p.rate.rateVesPerUsd,
    cajaCurrency: user.displayCurrency,
  });
  await recomputeReceivableStatus(r.id, tx);
}

/** Pago de una deuda o de un préstamo recibido. Debe correr dentro de una `prisma.$transaction`. */
export async function insertDebtPayment(tx: Tx, user: User, d: Ledger & { kind: "PAYABLE" | "LOAN_RECEIVED" }, p: SettlementInput) {
  const isLoan = d.kind === "LOAN_RECEIVED";
  const date = parseISODate(p.date);
  const description = isLoan ? `Pago de préstamo a ${d.counterparty}` : `Pago: ${d.counterparty}${d.description ? ` · ${d.description}` : ""}`;
  const created = await tx.transaction.create({
    data: {
      userId: user.id,
      walletId: p.walletId,
      // Pagar una deuda por compra es un gasto; devolver un préstamo no (el dinero ya entró como préstamo)
      type: isLoan ? "DEBT_PAYMENT" : "EXPENSE",
      amount: p.amount,
      date,
      description,
      debtId: d.id,
      categoryId: isLoan ? null : p.categoryId,
      ...p.rate,
      businessId: d.businessId,
    },
  });
  // El pago sale del apartado elegido
  await applyTransactionToPockets(tx, {
    userId: user.id,
    transactionId: created.id,
    type: "EXPENSE",
    amount: p.amount,
    currency: p.walletCurrency,
    date,
    label: d.counterparty,
    description,
    businessId: d.businessId,
    pocketId: p.pocketId,
    distribute: false,
    rate: p.rate.rateVesPerUsd,
    cajaCurrency: user.displayCurrency,
  });
  await recomputeDebtStatus(d.id, tx);
}
