"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { getFeeCategoryId } from "@/lib/defaults";
import { rateForDate } from "@/lib/guards";
import { dec } from "@/lib/money";
import { parseISODate } from "@/lib/utils";
import { normalizeAmount, transferSchema } from "@/lib/validators";

export async function createTransfer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = transferSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const data = parsed.data;
  if (data.fromWalletId === data.toWalletId) return fail("Elige dos cuentas distintas");

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id, id: { in: [data.fromWalletId, data.toWalletId] } },
  });
  const from = wallets.find((w) => w.id === data.fromWalletId);
  const to = wallets.find((w) => w.id === data.toWalletId);
  if (!from || !to) return fail("Cuenta no encontrada");

  // Si las divisas coinciden el monto recibido es el mismo; si no, es obligatorio.
  let amountIn = data.amountOut;
  if (from.currencyCode !== to.currencyCode || data.amountIn) {
    const n = data.amountIn ? normalizeAmount(data.amountIn) : null;
    if (!n || Number(n) <= 0) return fail(`Indica cuánto llegó en ${to.currencyCode}`);
    amountIn = n;
  }

  const fee = dec(data.fee);
  if (fee.isNegative()) return fail("La comisión no puede ser negativa");

  const groupId = randomUUID();
  const date = parseISODate(data.date);
  // Entre bolívares y dólares la tasa es la que se aplicó de verdad; si no, la del día de la transferencia
  const rate = impliedRate(from.currencyCode, data.amountOut, to.currencyCode, amountIn) ?? (await rateForDate(user.preferredRateSource, data.date));
  const description = data.description ?? `${from.name} → ${to.name}`;
  const feeCategoryId = fee.gt(0) ? await getFeeCategoryId(user.id) : null;

  await prisma.$transaction(async (tx) => {
    await tx.transaction.createMany({
      data: [
        { userId: user.id, walletId: from.id, type: "TRANSFER_OUT", amount: data.amountOut, date, description, transferGroupId: groupId, ...rate },
        { userId: user.id, walletId: to.id, type: "TRANSFER_IN", amount: amountIn, date, description, transferGroupId: groupId, ...rate },
      ],
    });
    if (fee.gt(0)) {
      await tx.transaction.create({
        data: {
          userId: user.id,
          walletId: from.id,
          type: "EXPENSE",
          amount: fee.toString(),
          date,
          description: `Comisión: ${description}`,
          categoryId: feeCategoryId,
          // Parte de la transferencia: se borra con ella
          transferGroupId: groupId,
          ...rate,
        },
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Transferencia registrada" };
}

const USD_LIKE = ["USD", "USDT"];

/** Tasa VES por USD implícita en una transferencia entre bolívares y dólares; null si no aplica. */
function impliedRate(fromCurrency: string, amountOut: string, toCurrency: string, amountIn: string) {
  const ves = fromCurrency === "VES" ? amountOut : toCurrency === "VES" ? amountIn : null;
  const usd = USD_LIKE.includes(fromCurrency) ? amountOut : USD_LIKE.includes(toCurrency) ? amountIn : null;
  if (!ves || !usd || dec(usd).isZero()) return null;
  return { rateVesPerUsd: dec(ves).div(dec(usd)).toDecimalPlaces(8).toString(), rateSource: null };
}
