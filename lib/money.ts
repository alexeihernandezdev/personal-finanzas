import Decimal from "decimal.js";

export { Decimal };

/** Divisas que valen 1:1 contra el dólar a efectos de conversión. */
const USD_LIKE = new Set(["USD", "USDT"]);

export type DecimalLike = Decimal.Value | { toString(): string };

export function dec(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(typeof value === "object" ? value.toString() : value);
}

/**
 * Convierte un monto entre divisas usando una tasa VES por USD.
 * USD y USDT se consideran equivalentes.
 */
export function convert(
  amount: DecimalLike,
  from: string,
  to: string,
  vesPerUsd: DecimalLike | null | undefined,
): Decimal {
  const value = dec(amount);
  if (from === to) return value;
  const fromUsd = USD_LIKE.has(from);
  const toUsd = USD_LIKE.has(to);
  if (fromUsd && toUsd) return value;
  const rate = dec(vesPerUsd);
  if (rate.isZero()) throw new Error("No hay tasa disponible para convertir");
  if (from === "VES" && toUsd) return value.div(rate);
  if (fromUsd && to === "VES") return value.mul(rate);
  throw new Error(`Conversión no soportada: ${from} → ${to}`);
}

const SYMBOLS: Record<string, string> = { USD: "$", VES: "Bs.", USDT: "₮" };

export function formatMoney(amount: DecimalLike, currency: string, opts?: { sign?: boolean }) {
  const value = dec(amount);
  const formatted = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value.toNumber()));
  const sign = value.isNegative() ? "-" : opts?.sign && value.gt(0) ? "+" : "";
  return `${sign}${SYMBOLS[currency] ?? currency} ${formatted}`;
}

export const INFLOW_TYPES = ["INCOME", "TRANSFER_IN", "LOAN_REPAYMENT", "LOAN_IN", "ADJUSTMENT_IN"] as const;
export const OUTFLOW_TYPES = ["EXPENSE", "TRANSFER_OUT", "LOAN_OUT", "DEBT_PAYMENT", "ADJUSTMENT_OUT"] as const;

export function signedAmount(type: string, amount: DecimalLike): Decimal {
  return (INFLOW_TYPES as readonly string[]).includes(type) ? dec(amount) : dec(amount).neg();
}
