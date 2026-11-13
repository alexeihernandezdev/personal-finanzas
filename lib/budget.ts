import { dec, Decimal, type DecimalLike } from "@/lib/money";

export type BudgetPocketInput = { id: string; name: string; percent: DecimalLike; color: string };

/** Apartados sugeridos para empezar (porcentaje de cada ingreso). */
export const SUGGESTED_POCKETS = [
  { name: "Ahorro", percent: "20", color: "#0f766e" },
  { name: "Inversión", percent: "10", color: "#6366f1" },
  { name: "Ocio", percent: "10", color: "#f59e0b" },
];

/**
 * Plan del mes de un dueño: los gastos fijos (y el sueldo fijo si es un negocio) se llevan su
 * porcentaje real del ingreso fijo más un colchón (`bufferPercent` % de los gastos fijos), cada
 * apartado su porcentaje y lo que sobra queda libre en la Caja. Todos los montos en la misma divisa.
 */
export function computeBudget(
  income: DecimalLike,
  fixedExpenses: DecimalLike,
  pockets: BudgetPocketInput[],
  bufferPercent: DecimalLike = 0,
  /** Sueldo fijo del dueño de un negocio: cuenta como gasto fijo, sin colchón */
  ownerSalary: DecimalLike = 0,
) {
  const inc = dec(income);
  const salary = dec(ownerSalary);
  const expenses = dec(fixedExpenses);
  const fixed = expenses.add(salary);
  const pct = (part: Decimal) => (inc.isZero() ? new Decimal(0) : part.div(inc).mul(100));

  const buffer = expenses.mul(dec(bufferPercent)).div(100);
  const items = pockets.map((b) => {
    const percent = dec(b.percent);
    return { ...b, percent, amount: inc.mul(percent).div(100) };
  });
  const assignedPercent = items.reduce((acc, b) => acc.add(b.percent), new Decimal(0));
  const assigned = items.reduce((acc, b) => acc.add(b.amount), new Decimal(0));
  const free = inc.sub(fixed).sub(buffer).sub(assigned);

  return {
    income: inc,
    /** Gastos fijos más el sueldo fijo del dueño */
    fixed,
    fixedPercent: pct(fixed),
    ownerSalary: salary,
    /** Colchón: % configurado sobre los gastos fijos, su monto y lo que representa de los ingresos */
    bufferPercent: dec(bufferPercent),
    buffer,
    bufferIncomePercent: pct(buffer),
    pockets: items,
    assigned,
    assignedPercent,
    free,
    freePercent: pct(free),
    /** Gastos fijos + colchón + apartados superan los ingresos */
    overBudget: free.isNegative(),
  };
}

export type BudgetOverview = ReturnType<typeof computeBudget>;

/** Frecuencias de un gasto fijo, en meses. */
export const FREQUENCIES = [
  { months: 1, label: "Mensual", short: "cada mes" },
  { months: 3, label: "Trimestral", short: "cada 3 meses" },
  { months: 6, label: "Semestral", short: "cada 6 meses" },
  { months: 12, label: "Anual", short: "cada año" },
] as const;

/** Calendario de un gasto fijo: cada `intervalMonths` meses a partir de `startMonth` (null = todos los meses). */
export type Schedule = { intervalMonths: number; startMonth: string | null };

const monthIndex = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m - 1;
};

/** Meses entre `from` y `to` (negativo si `to` es anterior). */
export function monthsBetween(from: string, to: string) {
  return monthIndex(to) - monthIndex(from);
}

/** Si el gasto fijo vence en `month`. Antes de su mes de inicio no vence. */
export function isDueInMonth(s: Schedule, month: string) {
  if (!s.startMonth) return true;
  const diff = monthsBetween(s.startMonth, month);
  return diff >= 0 && diff % Math.max(1, s.intervalMonths) === 0;
}

/** Primer mes (yyyy-mm) desde `month` (incluido) en el que vence el gasto fijo. */
export function nextDueMonth(s: Schedule, month: string) {
  if (!s.startMonth) return month;
  const interval = Math.max(1, s.intervalMonths);
  const diff = monthsBetween(s.startMonth, month);
  const ahead = diff <= 0 ? -diff : (interval - (diff % interval)) % interval;
  const index = monthIndex(month) + ahead;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Fecha de vencimiento en un mes: el día se ajusta al último del mes. */
export function dueDateInMonth(dayOfMonth: number, month: string) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(dayOfMonth, daysInMonth)));
}

/**
 * Cómo se reparte un ingreso de `amount` que entra a la Caja de un dueño:
 * - Gastos fijos: si el dueño tiene ingreso fijo, el % que sus gastos fijos (con colchón) son de él;
 *   si no lo tiene (p. ej. un negocio con ingresos variables), lo que falta para cubrir el mes
 *   (`fixedMissing`).
 * - Cada apartado: su % del ingreso. Si no caben en lo que queda tras los fijos, se reducen en proporción.
 * - Lo que sobra (`free`) se queda en la Caja.
 * Montos redondeados hacia abajo a 2 decimales.
 */
export function planDistribution(
  amount: DecimalLike,
  opts: { planIncome: DecimalLike; planFixed: DecimalLike; fixedMissing?: DecimalLike; percents: DecimalLike[] },
) {
  const total = Decimal.max(0, dec(amount));
  const income = dec(opts.planIncome);
  const planFixed = Decimal.max(0, dec(opts.planFixed));
  const fixedRaw = income.gt(0)
    ? total.mul(Decimal.min(1, planFixed.div(income)))
    : Decimal.min(total, Decimal.max(0, dec(opts.fixedMissing)));
  const fixed = fixedRaw.toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const rest = total.sub(fixed);

  const raw = opts.percents.map((p) => total.mul(Decimal.max(0, dec(p))).div(100));
  const sum = raw.reduce((acc, v) => acc.add(v), new Decimal(0));
  const scale = sum.gt(rest) && sum.gt(0) ? rest.div(sum) : new Decimal(1);
  const parts = raw.map((v) => v.mul(scale).toDecimalPlaces(2, Decimal.ROUND_DOWN));
  const free = rest.sub(parts.reduce((acc, v) => acc.add(v), new Decimal(0)));
  return { fixed, parts, free };
}

const percentFormat = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 });

export function formatPercent(value: DecimalLike) {
  return `${percentFormat.format(dec(value).toNumber())}%`;
}
