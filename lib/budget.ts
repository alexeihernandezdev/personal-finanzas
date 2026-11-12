import { dec, Decimal, type DecimalLike } from "@/lib/money";

export type BudgetBucketInput = { id: string; name: string; percent: DecimalLike; color: string; pocketId?: string | null };

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

/** Valor del selector "Se paga de" de un gasto fijo: el apartado "Gastos fijos" de su dueño (se crea si falta). */
export const FIXED_RESERVE = "fixed:auto";

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
 * Próximo vencimiento sin pagar de un gasto fijo: el de `month` si vence ese mes y aún no se pagó
 * (aunque ya esté vencido), si no el siguiente según su frecuencia. El día se ajusta al último del mes.
 */
export function nextDueDate(dayOfMonth: number, month: string, paidThisMonth: boolean, schedule: Schedule = { intervalMonths: 1, startMonth: null }) {
  const [y, m] = month.split("-").map(Number);
  const from = paidThisMonth ? `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, "0")}` : month;
  return dueDateInMonth(dayOfMonth, nextDueMonth(schedule, from));
}

/**
 * Parte del próximo pago que debería estar reservada en `month`: se ahorra un poco cada mes para
 * tenerlo completo el mes anterior al vencimiento (igual que un gasto mensual). Entre 0 y 1.
 */
export function reserveFraction(intervalMonths: number, month: string, dueMonth: string) {
  const interval = Math.max(1, intervalMonths);
  const away = monthsBetween(month, dueMonth);
  return Math.min(1, Math.max(0, (interval - away + 1) / interval));
}

/** Gasto fijo por reservar: monto en la divisa de su apartado (`pocketKey`). */
export type ReserveExpense = { id: string; pocketKey: string; amount: DecimalLike; dueDate: Date };

/**
 * Cuánto de los próximos gastos fijos cubre lo que ya hay en cada apartado de reserva. Cada apartado
 * debe tener sus próximos pagos más el colchón (`bufferPercent` % de ellos); el saldo se reparte entre
 * los gastos por orden de vencimiento y el colchón va al final.
 */
export function planFixedReserve(
  expenses: ReserveExpense[],
  balances: Map<string, DecimalLike>,
  bufferPercent: DecimalLike = 0,
) {
  const sorted = [...expenses].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id));
  const left = new Map<string, Decimal>();
  const available = (key: string) => left.get(key) ?? Decimal.max(0, dec(balances.get(key)));

  const items = sorted.map((e) => {
    const amount = dec(e.amount);
    const covered = Decimal.min(amount, available(e.pocketKey));
    left.set(e.pocketKey, available(e.pocketKey).sub(covered));
    return { ...e, amount, covered, missing: amount.sub(covered) };
  });

  const pockets = new Map<string, { key: string; expenses: Decimal; buffer: Decimal; target: Decimal; balance: Decimal; bufferMissing: Decimal; missing: Decimal }>();
  for (const e of items) {
    const p = pockets.get(e.pocketKey) ?? {
      key: e.pocketKey,
      expenses: new Decimal(0),
      buffer: new Decimal(0),
      target: new Decimal(0),
      balance: dec(balances.get(e.pocketKey)),
      bufferMissing: new Decimal(0),
      missing: new Decimal(0),
    };
    p.expenses = p.expenses.add(e.amount);
    p.missing = p.missing.add(e.missing);
    pockets.set(e.pocketKey, p);
  }
  for (const p of pockets.values()) {
    p.buffer = p.expenses.mul(dec(bufferPercent)).div(100).toDecimalPlaces(2);
    p.target = p.expenses.add(p.buffer);
    p.bufferMissing = p.buffer.sub(Decimal.min(p.buffer, available(p.key)));
    p.missing = p.missing.add(p.bufferMissing);
  }
  return { items, pockets: [...pockets.values()] };
}

/**
 * Porcentaje de lo que sobra (tras reservar los gastos fijos) que se lleva cada partida, para que al
 * cerrar el mes cada una haya recibido su % del ingreso fijo: `p · I / (I − F)`, con `F` = gastos fijos
 * más colchón. Si las partidas no caben en lo que sobra se escalan para sumar 100%; sin ingresos fijos
 * se usa el % configurado.
 */
export function bucketShares(planIncome: DecimalLike, planFixed: DecimalLike, buckets: { percent: DecimalLike }[]) {
  const income = dec(planIncome);
  const rest = income.sub(dec(planFixed));
  const raw = buckets.map((b) =>
    income.lte(0) || rest.lte(0) ? dec(b.percent) : dec(b.percent).mul(income).div(rest),
  );
  const total = raw.reduce((acc, p) => acc.add(p), new Decimal(0));
  return total.gt(100) ? raw.map((p) => p.mul(100).div(total)) : raw;
}

const percentFormat = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 });

export function formatPercent(value: DecimalLike) {
  return `${percentFormat.format(dec(value).toNumber())}%`;
}
