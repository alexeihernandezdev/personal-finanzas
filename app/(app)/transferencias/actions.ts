"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";
import { getFeeCategoryId } from "@/lib/defaults";
import { snapshotRate } from "@/lib/guards";
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
  const rate = await snapshotRate(user.preferredRateSource);
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
          ...rate,
          splits: { create: [{ businessId: null, amount: fee.toString() }] },
        },
      });
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Transferencia registrada" };
}
