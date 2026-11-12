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

/**
 * Próximo vencimiento sin pagar de un gasto fijo: el de `month` si aún no se pagó (aunque ya esté
 * vencido), si no el del mes siguiente. El día se ajusta al último del mes.
 */
export function nextDueDate(dayOfMonth: number, month: string, paidThisMonth: boolean) {
  const [y, m] = month.split("-").map(Number);
  const index = m - 1 + (paidThisMonth ? 1 : 0);
  const daysInMonth = new Date(Date.UTC(y, index + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, index, Math.min(dayOfMonth, daysInMonth)));
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
