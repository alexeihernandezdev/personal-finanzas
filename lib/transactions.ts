import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { dec } from "@/lib/money";
import { applyTransactionToPockets } from "@/lib/pockets";
import { parseISODate } from "@/lib/utils";

type Tx = Prisma.TransactionClient;
type Rate = { rateVesPerUsd: string | null; rateSource: "BCV" | "BINANCE" | null };
type User = { id: string; displayCurrency: string };

export type MovementInput = {
  type: "INCOME" | "EXPENSE";
  walletId: string;
  amount: string;
  date: string;
  categoryId?: string | null;
  description?: string;
  businessId?: string | null;
  /** Apartado: "auto" = Caja de su dueño, vacío = ninguno */
  pocketId?: string;
  distribute: boolean;
};

/** Crea un ingreso o gasto y lo lleva a los apartados. Debe correr dentro de una `prisma.$transaction`. */
export async function insertTransaction(tx: Tx, user: User, data: MovementInput, rate: Rate) {
  const created = await tx.transaction.create({
    data: {
      userId: user.id,
      walletId: data.walletId,
      type: data.type,
      amount: data.amount,
      date: parseISODate(data.date),
      categoryId: data.categoryId ?? null,
      description: data.description ?? "",
      businessId: data.businessId ?? null,
      ...rate,
    },
  });
  const [wallet, category] = await Promise.all([
    tx.wallet.findUniqueOrThrow({ where: { id: data.walletId }, select: { currencyCode: true } }),
    data.categoryId ? tx.category.findUnique({ where: { id: data.categoryId }, select: { name: true } }) : null,
  ]);
  await applyTransactionToPockets(tx, {
    userId: user.id,
    transactionId: created.id,
    type: data.type,
    amount: data.amount,
    currency: wallet.currencyCode,
    date: parseISODate(data.date),
    label: data.description || category?.name || "sin descripción",
    businessId: data.businessId ?? null,
    pocketId: data.pocketId,
    distribute: data.distribute,
    rate: rate.rateVesPerUsd,
    cajaCurrency: user.displayCurrency,
  });
  return created;
}

export type TransferInput = {
  from: { id: string; name: string; currencyCode: string };
  to: { id: string; name: string; currencyCode: string };
  amountOut: string;
  amountIn: string;
  /** Comisión en la divisa de origen; "0" = sin comisión */
  fee: string;
  date: string;
  description?: string;
  /** Categoría de la comisión (obligatoria si hay comisión) */
  feeCategoryId: string | null;
};

/** Crea las dos patas de una transferencia (y su comisión). Debe correr dentro de una `prisma.$transaction`. */
export async function insertTransfer(tx: Tx, userId: string, data: TransferInput, rate: Rate) {
  const groupId = randomUUID();
  const date = parseISODate(data.date);
  const description = data.description || `${data.from.name} → ${data.to.name}`;
  await tx.transaction.createMany({
    data: [
      { userId, walletId: data.from.id, type: "TRANSFER_OUT", amount: data.amountOut, date, description, transferGroupId: groupId, ...rate },
      { userId, walletId: data.to.id, type: "TRANSFER_IN", amount: data.amountIn, date, description, transferGroupId: groupId, ...rate },
    ],
  });
  if (dec(data.fee).gt(0)) {
    await tx.transaction.create({
      data: {
        userId,
        walletId: data.from.id,
        type: "EXPENSE",
        amount: dec(data.fee).toString(),
        date,
        description: `Comisión: ${description}`,
        categoryId: data.feeCategoryId,
        // Parte de la transferencia: se borra con ella
        transferGroupId: groupId,
        ...rate,
      },
    });
  }
  return groupId;
}

const USD_LIKE = ["USD", "USDT"];

/** Tasa VES por USD implícita en una transferencia entre bolívares y dólares; null si no aplica. */
export function impliedRate(fromCurrency: string, amountOut: string, toCurrency: string, amountIn: string): Rate | null {
  const ves = fromCurrency === "VES" ? amountOut : toCurrency === "VES" ? amountIn : null;
  const usd = USD_LIKE.includes(fromCurrency) ? amountOut : USD_LIKE.includes(toCurrency) ? amountIn : null;
  if (!ves || !usd || dec(usd).isZero()) return null;
  return { rateVesPerUsd: dec(ves).div(dec(usd)).toDecimalPlaces(8).toString(), rateSource: null };
}
