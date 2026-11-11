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

const DAY_MS = 24 * 60 * 60 * 1000;
// Fin del día en Venezuela (UTC-4) para una fecha guardada como medianoche UTC
const END_OF_DAY_MS = DAY_MS + 4 * 60 * 60 * 1000;

/**
 * Tasa (VES por USD) vigente al cierre de cada fecha, según la fuente. Si no hay registro
 * anterior a la fecha usa el primero posterior; si no hay ninguno, la tasa actual.
 * Devuelve un mapa fecha ISO (yyyy-mm-dd) → tasa.
 */
export async function getRatesForDates(dates: Date[], source: RateSource): Promise<Map<string, Decimal | null>> {
  const result = new Map<string, Decimal | null>();
  if (!dates.length) return result;
  const times = dates.map((d) => d.getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const kinds: RateKind[] = source === "BCV" ? ["BCV"] : ["BINANCE_BUY", "BINANCE_SELL"];
  const [rows, before, current] = await Promise.all([
    prisma.exchangeRate.findMany({
      where: { kind: { in: kinds }, fetchedAt: { gte: new Date(min), lt: new Date(max + END_OF_DAY_MS) } },
      orderBy: { fetchedAt: "asc" },
    }),
    // Último registro antes del rango, para fechas sin tasa propia
    Promise.all(
      kinds.map((kind) =>
        prisma.exchangeRate.findFirst({ where: { kind, fetchedAt: { lt: new Date(min) } }, orderBy: { fetchedAt: "desc" } }),
      ),
    ),
    getCurrentRates(),
  ]);
  const series = [...before.filter((r) => r !== null), ...rows];
  const fallback = pickRate(current, source);

  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    if (result.has(key)) continue;
    const limit = d.getTime() + END_OF_DAY_MS;
    const last = new Map<RateKind, Decimal>();
    for (const r of series) {
      if (r.fetchedAt.getTime() >= limit) break;
      last.set(r.kind, dec(r.rate));
    }
    if (!last.size) {
      // Sin datos hasta esa fecha: el primer registro posterior
      for (const r of series) if (!last.has(r.kind)) last.set(r.kind, dec(r.rate));
    }
    const values = [...last.values()];
    result.set(
      key,
      values.length ? values.reduce((a, b) => a.add(b), new Decimal(0)).div(values.length) : fallback,
    );
  }
  return result;
}

/** Tasas como strings para pasarlas a componentes cliente. */
export function serializeRates(rates: CurrentRates) {
  return {
    bcv: rates.bcv?.toString() ?? null,
    binance: rates.binance?.toString() ?? null,
    binanceBuy: rates.binanceBuy?.toString() ?? null,
    binanceSell: rates.binanceSell?.toString() ?? null,
  };
}
