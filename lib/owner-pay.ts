import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { RateSource } from "@/lib/generated/prisma/client";
import { rateForDate } from "@/lib/guards";
import { convert, dec, Decimal, formatMoney, type DecimalLike } from "@/lib/money";
import { allocateToPocket, ensureMainPocket, withdrawFromPocket } from "@/lib/pockets";
import { getPockets } from "@/lib/queries";
import { formatMonth, parseISODate, todayISO } from "@/lib/utils";

export class OwnerPayError extends Error {}

/**
 * Te pagas el sueldo de un mes de un negocio: `amount` (en la divisa del usuario) sale del apartado
 * "Gastos fijos" del negocio (si el sueldo es fijo) y de su Caja, y entra a tu Caja Personal, donde se
 * reparte entre tus apartados. El dinero no cambia de cuenta: solo pasa de los apartados del negocio a
 * los tuyos. Lanza `OwnerPayError` si ya se pagó ese mes o no alcanza.
 */
export async function payOwnerSalary(
  user: { id: string; displayCurrency: string; preferredRateSource: RateSource },
  business: { id: string; name: string; ownerPayMode: string },
  month: string,
  amount: DecimalLike,
) {
  if (await prisma.ownerPay.count({ where: { businessId: business.id, month } })) {
    throw new OwnerPayError("Ya te pagaste el sueldo de ese mes");
  }
  const cur = user.displayCurrency;
  const { rateVesPerUsd: rate } = await rateForDate(user.preferredRateSource, todayISO());
  const pockets = (await getPockets(user.id)).filter((p) => !p.archived && p.businessId === business.id);
  const caja = pockets.find((p) => p.isMain);
  const reserve = pockets.find((p) => p.isFixedReserve);
  const sources = [...(business.ownerPayMode === "FIXED" && reserve ? [reserve] : []), ...(caja ? [caja] : [])];
  let available = new Decimal(0);
  try {
    for (const p of sources) available = available.add(convert(Decimal.max(0, p.balance), p.currencyCode, cur, rate));
  } catch {
    throw new OwnerPayError("No hay tasa disponible para convertir los apartados del negocio");
  }
  if (dec(amount).gt(available.toDecimalPlaces(2))) {
    throw new OwnerPayError(`En los apartados de ${business.name} solo hay ${formatMoney(available, cur)} para pagarte`);
  }

  const ctx = {
    userId: user.id,
    date: parseISODate(todayISO()),
    groupId: randomUUID(),
    sourceTransactionId: null,
    rate,
    distribute: true,
  };
  const label = `Sueldo ${formatMonth(month)}`;
  await prisma.$transaction(async (tx) => {
    let left = dec(amount);
    for (const p of sources) {
      if (left.lte(0)) break;
      const taken = await withdrawFromPocket(tx, p, left, cur, `${label} → Personal`, ctx);
      left = left.sub(convert(taken, p.currencyCode, cur, rate));
    }
    const personal = await ensureMainPocket(tx, user.id, null, cur);
    await allocateToPocket(tx, personal, amount, cur, `${label} (de ${business.name})`, ctx);
    await tx.ownerPay.create({
      data: { userId: user.id, businessId: business.id, month, amount: dec(amount).toString(), currencyCode: cur, groupId: ctx.groupId },
    });
  });
}

/** Deshace el pago de un sueldo: el dinero vuelve a los apartados del negocio. */
export async function undoOwnerSalary(userId: string, id: string) {
  const pay = await prisma.ownerPay.findFirst({ where: { id, userId } });
  if (!pay) return;
  await prisma.$transaction([
    prisma.pocketMovement.deleteMany({ where: { groupId: pay.groupId, pocket: { userId } } }),
    prisma.ownerPay.delete({ where: { id } }),
  ]);
}
