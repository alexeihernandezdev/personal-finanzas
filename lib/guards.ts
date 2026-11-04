import "server-only";
import { prisma } from "@/lib/db";
import type { RateSource } from "@/lib/generated/prisma/client";
import { getCurrentRates, pickRate } from "@/lib/rates";

export class OwnershipError extends Error {}

/** Verifica que los ids recibidos del cliente pertenezcan al usuario. */
export async function assertOwned(
  userId: string,
  ids: { walletIds?: (string | undefined)[]; categoryId?: string | null; businessIds?: (string | null | undefined)[] },
) {
  const walletIds = [...new Set((ids.walletIds ?? []).filter(Boolean))] as string[];
  const businessIds = [...new Set((ids.businessIds ?? []).filter(Boolean))] as string[];
  const [w, c, b] = await Promise.all([
    walletIds.length ? prisma.wallet.count({ where: { userId, id: { in: walletIds } } }) : 0,
    ids.categoryId ? prisma.category.count({ where: { userId, id: ids.categoryId } }) : 0,
    businessIds.length ? prisma.business.count({ where: { userId, id: { in: businessIds } } }) : 0,
  ]);
  if (w !== walletIds.length || (ids.categoryId && c !== 1) || b !== businessIds.length) {
    throw new OwnershipError("Registro no encontrado");
  }
}

/** Tasa (VES por USD) a guardar como snapshot en un movimiento nuevo. */
export async function snapshotRate(source: RateSource) {
  const rates = await getCurrentRates({ refreshIfStale: true });
  const rate = pickRate(rates, source);
  return { rateVesPerUsd: rate?.toString() ?? null, rateSource: rate ? source : null };
}
