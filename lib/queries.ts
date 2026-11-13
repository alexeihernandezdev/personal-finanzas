import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma, TransactionType } from "@/lib/generated/prisma/client";
import { convert, dec, Decimal, signedAmount, type DecimalLike } from "@/lib/money";
import { monthRange, parseISODate, todayISO } from "@/lib/utils";
import { getCurrentRates } from "@/lib/rates";
import { computeBudget, dueDateInMonth, isDueInMonth, nextDueMonth } from "@/lib/budget";
import { getMonthlyPlan } from "@/lib/fixed-reserve";

// Todas las funciones reciben el userId ya verificado por requireUser().

/**
 * Cuentas con su saldo a hoy (`balance`) y el saldo contando los movimientos con fecha futura
 * (`projected`).
 */
export async function getWalletsWithBalance(userId: string, opts: { includeArchived?: boolean } = {}) {
  const today = parseISODate(todayISO());
  const [wallets, sums, upcoming] = await Promise.all([
    prisma.wallet.findMany({
      where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
      orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
    }),
    prisma.transaction.groupBy({
      by: ["walletId", "type"],
      where: { userId, date: { lte: today } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["walletId", "type"],
      where: { userId, date: { gt: today } },
      _sum: { amount: true },
    }),
  ]);
  const net = (walletId: string, rows: typeof sums) =>
    rows
      .filter((s) => s.walletId === walletId)
      .reduce((acc, s) => acc.add(signedAmount(s.type, s._sum.amount ?? 0)), new Decimal(0));
  return wallets.map((w) => {
    const balance = dec(w.initialBalance).add(net(w.id, sums));
    return { ...w, balance, projected: balance.add(net(w.id, upcoming)) };
  });
}

/** Saldo de cada apartado (suma de sus movimientos). Incluye los archivados: su dinero sigue apartado. */
async function getPocketBalances(userId: string) {
  const [pockets, sums] = await Promise.all([
    prisma.pocket.findMany({ where: { userId }, select: { id: true, currencyCode: true } }),
    prisma.pocketMovement.groupBy({ by: ["pocketId"], where: { pocket: { userId } }, _sum: { amount: true } }),
  ]);
  return pockets.map((p) => ({ ...p, balance: dec(sums.find((s) => s.pocketId === p.id)?._sum.amount) }));
}

/** Apartados con su saldo y sus últimos movimientos. */
export async function getPockets(userId: string, opts: { id?: string; pinned?: boolean } = {}) {
  const [pockets, balances] = await Promise.all([
    prisma.pocket.findMany({
      where: { userId, ...(opts.id ? { id: opts.id } : {}), ...(opts.pinned ? { pinned: true, archived: false } : {}) },
      include: {
        business: { select: { id: true, name: true, color: true } },
        movements: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 10 },
      },
      orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
    }),
    getPocketBalances(userId),
  ]);
  return pockets.map((p) => ({ ...p, balance: balances.find((b) => b.id === p.id)?.balance ?? new Decimal(0) }));
}

/**
 * Dinero en cuentas, lo apartado y lo disponible para usar, en `currency`.
 * Los apartados no están ligados a una cuenta: se restan del total de todas.
 */
export async function getMoneySummary(userId: string, currency: string, vesPerUsd: DecimalLike | null | undefined) {
  const [wallets, pockets] = await Promise.all([getWalletsWithBalance(userId), getPocketBalances(userId)]);
  const sum = (values: { amount: Decimal; currency: string }[]) =>
    values.reduce((acc, v) => {
      try {
        return acc.add(convert(v.amount, v.currency, currency, vesPerUsd));
      } catch {
        return acc;
      }
    }, new Decimal(0));
  const total = sum(wallets.map((w) => ({ amount: w.balance, currency: w.currencyCode })));
  // Un apartado en negativo no libera dinero: cuenta como vacío
  const reserved = sum(pockets.map((p) => ({ amount: Decimal.max(0, p.balance), currency: p.currencyCode })));
  return { total, reserved, available: total.sub(reserved) };
}

export type PocketWithBalance = Awaited<ReturnType<typeof getPockets>>[number];

/**
 * Apartados activos para elegir al registrar un movimiento o un traspaso, con el nombre de su dueño
 * y, si son Cajas, cómo se reparte lo que les entra (con `rate` se calcula el % de los gastos fijos).
 */
export async function getPocketChoices(userId: string, rate?: DecimalLike | null) {
  const pockets = await prisma.pocket.findMany({
    where: { userId, archived: false },
    include: { business: { select: { name: true } } },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });
  const cajas = pockets.filter((p) => p.isMain);
  const plans = new Map(
    await Promise.all(
      cajas.map(async (c) => [c.id, await getMonthlyPlan(prisma, userId, c.businessId, c.currencyCode, rate)] as const),
    ),
  );
  const rulesOf = (caja: (typeof pockets)[number]) => {
    const plan = plans.get(caja.id);
    const rules: { name: string; percent: string | null; target: string }[] = [];
    if (plan?.fixedWithBuffer.gt(0)) {
      rules.push({
        name: "Gastos fijos",
        percent: plan.income.gt(0) ? Decimal.min(100, plan.fixedWithBuffer.div(plan.income).mul(100)).toDecimalPlaces(2).toString() : null,
        target: pockets.find((p) => p.isFixedReserve && p.businessId === caja.businessId)?.name ?? "Gastos fijos",
      });
    }
    for (const p of pockets) {
      if (p.businessId === caja.businessId && !p.isMain && !p.isFixedReserve && p.percent?.gt(0)) {
        rules.push({ name: p.name, percent: p.percent.toString(), target: p.name });
      }
    }
    return rules;
  };
  return pockets
    .map((p) => ({
      id: p.id,
      name: p.name,
      currencyCode: p.currencyCode,
      isMain: p.isMain,
      isFixedReserve: p.isFixedReserve,
      businessId: p.businessId,
      ownerName: p.business?.name ?? "Personal",
      rules: p.isMain ? rulesOf(p) : [],
    }))
    .sort((a, b) => Number(a.businessId !== null) - Number(b.businessId !== null));
}

export type WalletWithBalance = Awaited<ReturnType<typeof getWalletsWithBalance>>[number];

export async function getWallet(userId: string, id: string) {
  const wallets = await getWalletsWithBalance(userId, { includeArchived: true });
  return wallets.find((w) => w.id === id) ?? null;
}

export function getCategories(userId: string, opts: { includeArchived?: boolean } = {}) {
  return prisma.category.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

export function getBusinesses(userId: string, opts: { includeArchived?: boolean } = {}) {
  return prisma.business.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
    orderBy: { name: "asc" },
  });
}

export type TransactionFilters = {
  walletId?: string;
  categoryId?: string;
  businessId?: string; // "personal" = sin negocio
  type?: string;
  from?: string;
  to?: string;
  q?: string;
};

export const transactionInclude = {
  wallet: { select: { id: true, name: true, currencyCode: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  business: { select: { id: true, name: true, color: true } },
  receivable: { select: { id: true, counterparty: true, kind: true } },
  debt: { select: { id: true, counterparty: true, kind: true } },
  recurring: { select: { id: true, name: true } },
} satisfies Prisma.TransactionInclude;

export async function listTransactions(userId: string, filters: TransactionFilters = {}, take = 200) {
  const where: Prisma.TransactionWhereInput = { userId };
  if (filters.walletId) where.walletId = filters.walletId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.type) {
    where.type =
      filters.type === "TRANSFER"
        ? { in: ["TRANSFER_IN", "TRANSFER_OUT"] }
        : filters.type === "LOAN"
          ? { in: ["LOAN_OUT", "LOAN_REPAYMENT", "LOAN_IN", "DEBT_PAYMENT"] }
          : (filters.type as TransactionType);
  }
  if (filters.businessId) {
    where.businessId = filters.businessId === "personal" ? null : filters.businessId;
  }
  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
      ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00Z`) } : {}),
    };
  }
  if (filters.q) where.description = { contains: filters.q, mode: "insensitive" };

  return prisma.transaction.findMany({
    where,
    include: transactionInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
}

export type TransactionRow = Awaited<ReturnType<typeof listTransactions>>[number];

/** Convierte un movimiento a USD usando su tasa guardada, o la tasa actual de respaldo. */
export function toUsd(amount: Decimal.Value | { toString(): string }, currency: string, snapshot: unknown, fallback: Decimal | null) {
  const rate = snapshot ? dec(snapshot as string) : fallback;
  try {
    return convert(amount, currency, "USD", rate);
  } catch {
    return new Decimal(0);
  }
}

/** Ingresos y gastos (sin transferencias ni préstamos) de un mes, en USD, por categoría y por negocio. */
export async function getMonthSummary(userId: string, month: string, fallbackRate: Decimal | null) {
  const { start, end } = monthRange(month);
  const txs = await prisma.transaction.findMany({
    where: { userId, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: start, lt: end } },
    include: {
      wallet: { select: { currencyCode: true } },
      category: { select: { id: true, name: true, color: true } },
      business: { select: { id: true, name: true, color: true } },
    },
  });

  let income = new Decimal(0);
  let expense = new Decimal(0);
  const byCategory = new Map<string, { name: string; color: string; kind: string; total: Decimal }>();
  const byBusiness = new Map<string, { name: string; color: string; income: Decimal; expense: Decimal }>();

  for (const t of txs) {
    const usd = toUsd(t.amount, t.wallet.currencyCode, t.rateVesPerUsd, fallbackRate);
    if (t.type === "INCOME") income = income.add(usd);
    else expense = expense.add(usd);

    const catKey = `${t.type}:${t.category?.id ?? "none"}`;
    const cat = byCategory.get(catKey) ?? {
      name: t.category?.name ?? "Sin categoría",
      color: t.category?.color ?? "#94a3b8",
      kind: t.type,
      total: new Decimal(0),
    };
    cat.total = cat.total.add(usd);
    byCategory.set(catKey, cat);

    const key = t.businessId ?? "personal";
    const b = byBusiness.get(key) ?? {
      name: t.business?.name ?? "Personal",
      color: t.business?.color ?? "#94a3b8",
      income: new Decimal(0),
      expense: new Decimal(0),
    };
    if (t.type === "INCOME") b.income = b.income.add(usd);
    else b.expense = b.expense.add(usd);
    byBusiness.set(key, b);
  }

  return {
    income,
    expense,
    net: income.sub(expense),
    byCategory: [...byCategory.values()].sort((a, b) => b.total.cmp(a.total)),
    byBusiness: [...byBusiness.entries()]
      .map(([id, v]) => ({ id, ...v, net: v.income.sub(v.expense) }))
      .sort((a, b) => b.income.add(b.expense).cmp(a.income.add(a.expense))),
  };
}

/** Gastos fijos con su estado en un mes: si vencen ese mes, si se pagaron y su próximo vencimiento. */
export async function getRecurringForMonth(userId: string, month: string) {
  const { start, end } = monthRange(month);
  const items = await prisma.recurringExpense.findMany({
    where: { userId },
    include: {
      wallet: { select: { id: true, name: true, currencyCode: true } },
      category: { select: { id: true, name: true } },
      business: { select: { id: true, name: true } },
      transactions: {
        where: { date: { gte: start, lt: end } },
        select: { id: true, date: true, amount: true, wallet: { select: { name: true, currencyCode: true } } },
      },
      paidMarks: { where: { month }, select: { date: true } },
    },
    orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }],
  });
  return items.map((r) => {
    const due = isDueInMonth(r, month);
    return {
      ...r,
      /** Vence en este mes (los trimestrales, semestrales y anuales no vencen todos los meses) */
      due,
      /** Vencimiento de este mes o, si no vence este mes, el próximo */
      dueDate: dueDateInMonth(r.dayOfMonth, due ? month : nextDueMonth(r, month)),
      paid: r.transactions.length > 0 || r.paidMarks.length > 0,
      payment: r.transactions[0] ?? null,
      /** Marcado como pagado sin movimiento */
      paidMark: r.paidMarks[0] ?? null,
    };
  });
}

/** Ingresos fijos (activos primero). */
export function getRecurringIncome(userId: string) {
  return prisma.recurringIncome.findMany({
    where: { userId },
    include: {
      wallet: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      business: { select: { id: true, name: true } },
    },
    orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }],
  });
}

/**
 * Plan mensual de un dueño (Personal o un negocio) en la divisa del usuario: sus ingresos fijos activos
 * (en Personal, con los sueldos fijos de los negocios), sus gastos fijos activos (más el colchón y, si es
 * un negocio, el sueldo fijo) y sus apartados con porcentaje. Convierte con la tasa actual; los montos
 * sin tasa disponible se omiten.
 */
export async function getBudgetOverview(
  userId: string,
  displayCurrency: string,
  rate: Decimal | null,
  businessId: string | null = null,
) {
  const [plan, pockets] = await Promise.all([
    getMonthlyPlan(prisma, userId, businessId, displayCurrency, rate),
    prisma.pocket.findMany({
      where: { userId, businessId, archived: false, isMain: false, isFixedReserve: false, percent: { gt: 0 } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const lines = pockets.map((p) => ({ id: p.id, name: p.name, color: p.color, percent: p.percent ?? 0 }));
  return {
    ...computeBudget(plan.income, plan.fixed, lines, plan.bufferPercent, plan.ownerSalary),
    /** Sueldos fijos de los negocios incluidos en el ingreso fijo (solo Personal) */
    salaries: plan.salaries,
  };
}

/**
 * Ganancia de un negocio en un mes (sus ingresos menos sus gastos, sin transferencias ni préstamos),
 * en `currency`. Cada movimiento se convierte con su tasa guardada o, si no la tiene, con `fallback`.
 */
export async function getBusinessProfit(userId: string, businessId: string, month: string, currency: string, fallback: DecimalLike | null) {
  const { start, end } = monthRange(month);
  const txs = await prisma.transaction.findMany({
    where: { userId, businessId, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: start, lt: end } },
    select: { type: true, amount: true, rateVesPerUsd: true, wallet: { select: { currencyCode: true } } },
  });
  let income = new Decimal(0);
  let expense = new Decimal(0);
  for (const t of txs) {
    let value: Decimal;
    try {
      value = convert(t.amount, t.wallet.currencyCode, currency, t.rateVesPerUsd ?? fallback);
    } catch {
      continue;
    }
    if (t.type === "INCOME") income = income.add(value);
    else expense = expense.add(value);
  }
  return { income, expense, profit: income.sub(expense) };
}

/**
 * Sueldo de un negocio en los meses indicados: lo que te toca (monto fijo o % de la ganancia), la
 * ganancia del mes y lo que ya te pagaste, en `currency`.
 */
export async function getOwnerPayMonths(
  userId: string,
  business: { id: string; ownerPayMode: string; ownerPayPercent: Prisma.Decimal | null; ownerPayAmount: Prisma.Decimal | null; ownerPayCurrency: string | null },
  months: string[],
  currency: string,
  rate: DecimalLike | null,
) {
  const paid = await prisma.ownerPay.findMany({ where: { userId, businessId: business.id, month: { in: months } } });
  return Promise.all(
    months.map(async (month) => {
      const result = await getBusinessProfit(userId, business.id, month, currency, rate);
      let due = new Decimal(0);
      if (business.ownerPayMode === "FIXED" && business.ownerPayAmount) {
        try {
          due = convert(business.ownerPayAmount, business.ownerPayCurrency ?? currency, currency, rate);
        } catch {
          // Sin tasa para convertir
        }
      } else if (business.ownerPayMode === "PROFIT_PERCENT" && business.ownerPayPercent) {
        due = Decimal.max(0, result.profit).mul(business.ownerPayPercent).div(100);
      }
      return { month, ...result, due: due.toDecimalPlaces(2, Decimal.ROUND_DOWN), payment: paid.find((p) => p.month === month) ?? null };
    }),
  );
}

/** Cuentas por cobrar y préstamos con el monto cobrado hasta ahora (en la divisa del registro). */
export async function getReceivables(userId: string, opts: { onlyOpen?: boolean } = {}) {
  const items = await prisma.receivable.findMany({
    where: { userId, ...(opts.onlyOpen ? { status: { in: ["PENDING", "PARTIAL"] } } : {}) },
    include: {
      business: { select: { id: true, name: true } },
      transactions: {
        include: { wallet: { select: { name: true, currencyCode: true } } },
        orderBy: { date: "asc" },
      },
    },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  const fallback = await currentFallbackRate();
  return items.map((r) => {
    const collected = collectedAmount(r, fallback);
    return { ...r, collected, remaining: dec(r.amount).sub(collected) };
  });
}

type ReceivableForCollected = {
  currencyCode: string;
  transactions: { type: string; amount: Prisma.Decimal; rateVesPerUsd: Prisma.Decimal | null; wallet: { currencyCode: string } }[];
};

/** Tasa actual (BCV, o Binance si no hay) para los movimientos que no guardaron la suya. */
export async function currentFallbackRate() {
  const rates = await getCurrentRates();
  return rates.bcv ?? rates.binance;
}

/** Lo cobrado de una cuenta por cobrar, en su divisa. `fallback`: tasa para movimientos sin tasa guardada. */
export function collectedAmount(r: ReceivableForCollected, fallback: DecimalLike | null = null) {
  return r.transactions
    .filter((t) => t.type === "INCOME" || t.type === "LOAN_REPAYMENT")
    .reduce((acc, t) => {
      try {
        return acc.add(convert(t.amount, t.wallet.currencyCode, r.currencyCode, t.rateVesPerUsd ?? fallback));
      } catch {
        return acc;
      }
    }, new Decimal(0));
}

/** Deudas y préstamos recibidos con lo pagado hasta ahora (en la divisa del registro). */
export async function getDebts(userId: string, opts: { onlyOpen?: boolean } = {}) {
  const items = await prisma.debt.findMany({
    where: { userId, ...(opts.onlyOpen ? { status: { in: ["PENDING", "PARTIAL"] } } : {}) },
    include: {
      business: { select: { id: true, name: true } },
      transactions: {
        include: { wallet: { select: { name: true, currencyCode: true } } },
        orderBy: { date: "asc" },
      },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
  const fallback = await currentFallbackRate();
  return items.map((d) => {
    const paid = paidAmount(d, fallback);
    return { ...d, paid, remaining: dec(d.amount).sub(paid) };
  });
}

/** Lo pagado de una deuda, en su divisa. `fallback`: tasa para movimientos sin tasa guardada. */
export function paidAmount(d: ReceivableForCollected, fallback: DecimalLike | null = null) {
  return d.transactions
    .filter((t) => t.type === "EXPENSE" || t.type === "DEBT_PAYMENT")
    .reduce((acc, t) => {
      try {
        return acc.add(convert(t.amount, t.wallet.currencyCode, d.currencyCode, t.rateVesPerUsd ?? fallback));
      } catch {
        return acc;
      }
    }, new Decimal(0));
}
