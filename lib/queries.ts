import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma, TransactionType } from "@/lib/generated/prisma/client";
import { convert, dec, Decimal, INFLOW_TYPES, type DecimalLike } from "@/lib/money";
import { monthRange } from "@/lib/utils";
import { computeBudget } from "@/lib/budget";
import { getMonthlyPlan } from "@/lib/fixed-reserve";

// Todas las funciones reciben el userId ya verificado por requireUser().

export async function getWalletsWithBalance(userId: string, opts: { includeArchived?: boolean } = {}) {
  const [wallets, sums] = await Promise.all([
    prisma.wallet.findMany({
      where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
      orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
    }),
    prisma.transaction.groupBy({
      by: ["walletId", "type"],
      where: { userId },
      _sum: { amount: true },
    }),
  ]);
  return wallets.map((w) => {
    let balance = dec(w.initialBalance);
    for (const s of sums) {
      if (s.walletId !== w.id) continue;
      const v = dec(s._sum.amount);
      balance = (INFLOW_TYPES as readonly string[]).includes(s.type) ? balance.add(v) : balance.sub(v);
    }
    return { ...w, balance };
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
  const reserved = sum(pockets.map((p) => ({ amount: p.balance, currency: p.currencyCode })));
  return { total, reserved, available: total.sub(reserved) };
}

export type PocketWithBalance = Awaited<ReturnType<typeof getPockets>>[number];

/**
 * Apartados activos para elegir al registrar un movimiento o un traspaso, con el nombre de su dueño
 * y, si son Cajas, las partidas con las que se reparte lo que les entra.
 */
export async function getPocketChoices(userId: string) {
  const [pockets, buckets] = await Promise.all([
    prisma.pocket.findMany({
      where: { userId, archived: false },
      include: { business: { select: { name: true } } },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    }),
    prisma.budgetBucket.findMany({
      where: { userId, pocket: { archived: false } },
      include: { pocket: { select: { name: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return pockets
    .map((p) => ({
      id: p.id,
      name: p.name,
      currencyCode: p.currencyCode,
      isMain: p.isMain,
      isFixedReserve: p.isFixedReserve,
      businessId: p.businessId,
      ownerName: p.business?.name ?? "Personal",
      rules: p.isMain
        ? buckets
            .filter((b) => b.businessId === p.businessId && b.pocket && b.pocketId !== p.id)
            .map((b) => ({ name: b.name, percent: b.percent.toString(), target: b.pocket!.name }))
        : [],
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
  splits: { include: { business: { select: { id: true, name: true, color: true } } } },
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
    where.splits =
      filters.businessId === "personal"
        ? { some: { businessId: null } }
        : { some: { businessId: filters.businessId } };
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
      splits: { include: { business: { select: { id: true, name: true, color: true } } } },
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

    // Si no hay splits, todo va a Personal
    const splits = t.splits.length ? t.splits : [{ businessId: null, amount: t.amount, business: null }];
    const ratio = dec(t.amount).isZero() ? new Decimal(0) : usd.div(dec(t.amount));
    for (const s of splits) {
      const key = s.businessId ?? "personal";
      const b = byBusiness.get(key) ?? {
        name: s.business?.name ?? "Personal",
        color: s.business?.color ?? "#94a3b8",
        income: new Decimal(0),
        expense: new Decimal(0),
      };
      const part = dec(s.amount).mul(ratio);
      if (t.type === "INCOME") b.income = b.income.add(part);
      else b.expense = b.expense.add(part);
      byBusiness.set(key, b);
    }
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

/** Gastos fijos activos con su estado (pagado o no) en un mes. */
export async function getRecurringForMonth(userId: string, month: string) {
  const { start, end } = monthRange(month);
  const items = await prisma.recurringExpense.findMany({
    where: { userId },
    include: {
      wallet: { select: { id: true, name: true, currencyCode: true } },
      category: { select: { id: true, name: true } },
      business: { select: { id: true, name: true } },
      pocket: { select: { id: true, name: true, archived: true } },
      transactions: {
        where: { date: { gte: start, lt: end } },
        select: { id: true, date: true, amount: true, wallet: { select: { name: true, currencyCode: true } } },
      },
      paidMarks: { where: { month }, select: { date: true } },
    },
    orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }],
  });
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return items.map((r) => {
    const day = Math.min(r.dayOfMonth, daysInMonth);
    return {
      ...r,
      dueDate: new Date(Date.UTC(y, m - 1, day)),
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

/** Partidas del presupuesto de un dueño (`businessId` null = Personal). */
export function getBudgetBuckets(userId: string, businessId: string | null = null) {
  return prisma.budgetBucket.findMany({ where: { userId, businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
}

/** Últimos ingresos, para repartirlos entre los apartados del presupuesto. `distributed`: ya se repartió algo. */
export async function getRecentIncomes(userId: string, opts: { businessId?: string | null; take?: number } = {}) {
  const items = await prisma.transaction.findMany({
    where: {
      userId,
      type: "INCOME",
      ...(opts.businessId !== undefined ? { splits: { some: { businessId: opts.businessId } } } : {}),
    },
    include: { wallet: { select: { name: true, currencyCode: true } }, _count: { select: { pocketMovements: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 30,
  });
  return items.map(({ _count, ...t }) => ({ ...t, distributed: _count.pocketMovements > 0 }));
}

/**
 * Presupuesto mensual de un dueño (Personal o un negocio) en la divisa del usuario: sus ingresos fijos
 * activos, sus gastos fijos activos (más el colchón) y sus partidas. Convierte con la tasa actual; los montos sin tasa disponible se omiten.
 */
export async function getBudgetOverview(
  userId: string,
  displayCurrency: string,
  rate: Decimal | null,
  businessId: string | null = null,
) {
  const [plan, buckets] = await Promise.all([
    getMonthlyPlan(prisma, userId, businessId, displayCurrency, rate),
    getBudgetBuckets(userId, businessId),
  ]);
  return computeBudget(plan.income, plan.fixed, buckets, plan.bufferPercent);
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
  return items.map((r) => {
    const collected = collectedAmount(r);
    return { ...r, collected, remaining: dec(r.amount).sub(collected) };
  });
}

type ReceivableForCollected = {
  currencyCode: string;
  transactions: { type: string; amount: Prisma.Decimal; rateVesPerUsd: Prisma.Decimal | null; wallet: { currencyCode: string } }[];
};

export function collectedAmount(r: ReceivableForCollected) {
  return r.transactions
    .filter((t) => t.type === "INCOME" || t.type === "LOAN_REPAYMENT")
    .reduce((acc, t) => {
      try {
        return acc.add(convert(t.amount, t.wallet.currencyCode, r.currencyCode, t.rateVesPerUsd));
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
  return items.map((d) => {
    const paid = paidAmount(d);
    return { ...d, paid, remaining: dec(d.amount).sub(paid) };
  });
}

export function paidAmount(d: ReceivableForCollected) {
  return d.transactions
    .filter((t) => t.type === "EXPENSE" || t.type === "DEBT_PAYMENT")
    .reduce((acc, t) => {
      try {
        return acc.add(convert(t.amount, t.wallet.currencyCode, d.currencyCode, t.rateVesPerUsd));
      } catch {
        return acc;
      }
    }, new Decimal(0));
}
