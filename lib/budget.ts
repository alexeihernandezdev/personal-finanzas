import { dec, Decimal, type DecimalLike } from "@/lib/money";

export type BudgetBucketInput = { id: string; name: string; percent: DecimalLike; color: string };

/** Partidas sugeridas para empezar (porcentaje de los ingresos fijos). */
export const SUGGESTED_BUCKETS = [
  { name: "Ahorro", percent: "20", color: "#0f766e" },
  { name: "Inversión", percent: "10", color: "#6366f1" },
  { name: "Diversión", percent: "10", color: "#f59e0b" },
];

/**
 * Reparte los ingresos fijos del mes: los gastos fijos se llevan su porcentaje real más un colchón
 * (`bufferPercent` % de los gastos fijos) para extras, cada partida su porcentaje configurado, y lo
 * que sobra queda libre. Todos los montos en la misma divisa.
 */
export function computeBudget(
  income: DecimalLike,
  fixedExpenses: DecimalLike,
  buckets: BudgetBucketInput[],
  bufferPercent: DecimalLike = 0,
) {
  const inc = dec(income);
  const fixed = dec(fixedExpenses);
  const pct = (part: Decimal) => (inc.isZero() ? new Decimal(0) : part.div(inc).mul(100));

  const buffer = fixed.mul(dec(bufferPercent)).div(100);
  const items = buckets.map((b) => {
    const percent = dec(b.percent);
    return { ...b, percent, amount: inc.mul(percent).div(100) };
  });
  const assignedPercent = items.reduce((acc, b) => acc.add(b.percent), new Decimal(0));
  const assigned = items.reduce((acc, b) => acc.add(b.amount), new Decimal(0));
  const free = inc.sub(fixed).sub(buffer).sub(assigned);

  return {
    income: inc,
    fixed,
    fixedPercent: pct(fixed),
    /** Colchón: % configurado sobre los gastos fijos, su monto y lo que representa de los ingresos */
    bufferPercent: dec(bufferPercent),
    buffer,
    bufferIncomePercent: pct(buffer),
    buckets: items,
    assigned,
    assignedPercent,
    free,
    freePercent: pct(free),
    /** Gastos fijos + colchón + partidas superan los ingresos */
    overBudget: free.isNegative(),
  };
}

export type BudgetOverview = ReturnType<typeof computeBudget>;

const percentFormat = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 });

export function formatPercent(value: DecimalLike) {
  return `${percentFormat.format(dec(value).toNumber())}%`;
}
