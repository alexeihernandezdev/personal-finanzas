import "server-only";
import { prisma } from "@/lib/db";
import type { RateKind, RateSource } from "@/lib/generated/prisma/client";
import { dec, Decimal } from "@/lib/money";
import { fetchBcvRate, fetchBinanceRate } from "./fetchers";

const STALE_MS = 60 * 60 * 1000; // 1 hora

export type CurrentRates = {
  bcv: Decimal | null;
  binanceBuy: Decimal | null;
  binanceSell: Decimal | null;
  /** Promedio compra/venta de Binance */
  binance: Decimal | null;
  updatedAt: Date | null;
};

/** Consulta las fuentes y guarda las tasas. Devuelve los errores por fuente. */
export async function refreshRates() {
  const jobs: [RateKind, () => Promise<number>][] = [
    ["BCV", fetchBcvRate],
    ["BINANCE_BUY", () => fetchBinanceRate("BUY")],
    ["BINANCE_SELL", () => fetchBinanceRate("SELL")],
  ];
  const results = await Promise.allSettled(jobs.map(([, fn]) => fn()));
  const saved: { kind: RateKind; rate: number }[] = [];
  const errors: { kind: RateKind; error: string }[] = [];
  results.forEach((r, i) => {
    const kind = jobs[i][0];
    if (r.status === "fulfilled") saved.push({ kind, rate: r.value });
    else errors.push({ kind, error: String(r.reason?.message ?? r.reason) });
  });
  if (saved.length) {
    await prisma.exchangeRate.createMany({
      data: saved.map((s) => ({ kind: s.kind, rate: s.rate })),
    });
  }
  return { saved, errors };
}

async function latest(kind: RateKind) {
  return prisma.exchangeRate.findFirst({ where: { kind }, orderBy: { fetchedAt: "desc" } });
}

export async function getCurrentRates(opts: { refreshIfStale?: boolean } = {}): Promise<CurrentRates> {
  let [bcv, buy, sell] = await Promise.all([latest("BCV"), latest("BINANCE_BUY"), latest("BINANCE_SELL")]);
  const oldest = Math.min(...[bcv, buy, sell].map((r) => r?.fetchedAt.getTime() ?? 0));
  if (opts.refreshIfStale && Date.now() - oldest > STALE_MS) {
    await refreshRates().catch(() => null);
    [bcv, buy, sell] = await Promise.all([latest("BCV"), latest("BINANCE_BUY"), latest("BINANCE_SELL")]);
  }
  const binanceBuy = buy ? dec(buy.rate) : null;
  const binanceSell = sell ? dec(sell.rate) : null;
  const binance =
    binanceBuy && binanceSell ? binanceBuy.add(binanceSell).div(2) : (binanceBuy ?? binanceSell);
  const dates = [bcv, buy, sell].filter(Boolean).map((r) => r!.fetchedAt.getTime());
  return {
    bcv: bcv ? dec(bcv.rate) : null,
    binanceBuy,
    binanceSell,
    binance,
    updatedAt: dates.length ? new Date(Math.max(...dates)) : null,
  };
}

export function pickRate(rates: CurrentRates, source: RateSource): Decimal | null {
  return source === "BCV" ? (rates.bcv ?? rates.binance) : (rates.binance ?? rates.bcv);
}

export function getRateHistory(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.exchangeRate.findMany({ where: { fetchedAt: { gte: since } }, orderBy: { fetchedAt: "asc" } });
}
