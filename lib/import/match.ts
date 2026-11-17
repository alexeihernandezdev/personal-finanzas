import { dec, Decimal } from "@/lib/money";
import type { ImportRowType } from "@/lib/import/normalize";

export type MatchRow = {
  key: string;
  walletId: string;
  currency: string;
  type: ImportRowType;
  amount: string;
  date: string;
};

export type TransferPair = {
  outKey: string;
  inKey: string;
  /** Diferencia en la divisa de origen cuando ambas cuentas usan la misma; null si no hay */
  fee: string | null;
  /** true si alguna de las dos filas no estaba marcada como transferencia: es solo una sugerencia */
  suggested: boolean;
};

export const MATCH_DAYS = 3;
/** Tolerancia entre divisas distintas (la tasa del banco no es la del día) */
export const CROSS_TOLERANCE = 0.03;
/** Diferencia máxima que se toma como comisión entre cuentas de la misma divisa */
export const FEE_TOLERANCE = 0.01;

const USD_LIKE = ["USD", "USDT"];
const DAY_MS = 86_400_000;

const isOut = (t: ImportRowType) => t === "EXPENSE" || t === "TRANSFER_OUT";
const isTransfer = (t: ImportRowType) => t === "TRANSFER_OUT" || t === "TRANSFER_IN";
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

/** Monto en USD con la tasa VES por USD del día; null si no se puede convertir. */
function toUsd(amount: Decimal, currency: string, rate: string | null | undefined) {
  if (USD_LIKE.includes(currency)) return amount;
  if (currency === "VES" && rate && dec(rate).gt(0)) return amount.div(dec(rate));
  return null;
}

/**
 * Empareja salidas de una cuenta con entradas de otra: mismo monto (o casi, si la diferencia es
 * una comisión) en la misma divisa, o equivalente con la tasa del día entre divisas distintas,
 * con fechas a no más de `MATCH_DAYS` días. Cada fila se usa una sola vez; primero los pares en
 * que ambas filas ya son transferencias, luego los más cercanos en fecha y en monto.
 */
export function matchTransfers(rows: MatchRow[], rates: Record<string, string | null>): TransferPair[] {
  type Candidate = TransferPair & { score: [number, number, number] };
  const outs = rows.filter((r) => isOut(r.type));
  const ins = rows.filter((r) => !isOut(r.type));
  const candidates: Candidate[] = [];

  for (const o of outs) {
    for (const i of ins) {
      if (o.walletId === i.walletId) continue;
      const days = daysBetween(o.date, i.date);
      if (days > MATCH_DAYS) continue;
      const a = dec(o.amount);
      const b = dec(i.amount);
      if (a.lte(0) || b.lte(0)) continue;

      let diff: number;
      let fee: string | null = null;
      if (o.currency === i.currency || (USD_LIKE.includes(o.currency) && USD_LIKE.includes(i.currency))) {
        // Sale lo mismo o un poco más (la comisión)
        if (b.gt(a)) continue;
        diff = a.minus(b).div(a).toNumber();
        if (diff > FEE_TOLERANCE) continue;
        if (a.gt(b)) fee = a.minus(b).toString();
      } else {
        const rate = rates[o.date] ?? rates[i.date];
        const ua = toUsd(a, o.currency, rate);
        const ub = toUsd(b, i.currency, rate);
        if (!ua || !ub) continue;
        diff = ua.minus(ub).abs().div(ua).toNumber();
        if (diff > CROSS_TOLERANCE) continue;
      }
      const both = isTransfer(o.type) && isTransfer(i.type);
      candidates.push({ outKey: o.key, inKey: i.key, fee, suggested: !both, score: [both ? 0 : 1, days, diff] });
    }
  }

  candidates.sort((x, y) => x.score[0] - y.score[0] || x.score[1] - y.score[1] || x.score[2] - y.score[2]);
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const c of candidates) {
    if (used.has(c.outKey) || used.has(c.inKey)) continue;
    used.add(c.outKey);
    used.add(c.inKey);
    pairs.push({ outKey: c.outKey, inKey: c.inKey, fee: c.fee, suggested: c.suggested });
  }
  return pairs;
}
