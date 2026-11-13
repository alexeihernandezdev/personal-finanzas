import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, ChevronRight, Plus, TrendingUp } from "lucide-react";
import { TransactionList } from "@/components/transaction-list";
import {
  Amount,
  Badge,
  buttonClass,
  Card,
  CardFooterLink,
  EmptyState,
  PageHeader,
  SectionHeader,
  SectionTitle,
} from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { formatPercent } from "@/lib/budget";
import {
  getBudgetOverview,
  getDebts,
  getMoneySummary,
  getMonthSummary,
  getPockets,
  getReceivables,
  getRecurringForMonth,
  getWalletsWithBalance,
  listTransactions,
} from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { currentMonth, formatDate, formatMonth, toISODate, todayISO } from "@/lib/utils";

async function DashboardPageContent() {
  const user = await requireUser();
  const month = currentMonth();
  const rates = await getCurrentRates({ refreshIfStale: true });
  const rate = pickRate(rates, user.preferredRateSource);
  const [wallets, summary, recurring, receivables, debts, recent, budget, money, pinnedPockets] = await Promise.all([
    getWalletsWithBalance(user.id),
    getMonthSummary(user.id, month, rate),
    getRecurringForMonth(user.id, month),
    getReceivables(user.id, { onlyOpen: true }),
    getDebts(user.id, { onlyOpen: true }),
    listTransactions(user.id, {}, 8),
    getBudgetOverview(user.id, user.displayCurrency, rate),
    getMoneySummary(user.id, user.displayCurrency, rate),
    getPockets(user.id, { pinned: true }),
  ]);

  const cur = user.displayCurrency;
  const toDisplay = (amount: Decimal | { toString(): string }, from: string) => {
    try {
      return convert(amount, from, cur, rate);
    } catch {
      return new Decimal(0);
    }
  };
  const walletTotal = wallets.reduce((acc, w) => acc.add(toDisplay(w.balance, w.currencyCode)), new Decimal(0));
  const receivableTotal = receivables.reduce((acc, r) => acc.add(toDisplay(r.remaining, r.currencyCode)), new Decimal(0));
  const debtTotal = debts.reduce((acc, d) => acc.add(toDisplay(d.remaining, d.currencyCode)), new Decimal(0));
  // Patrimonio neto: lo que tienes + lo que te deben − lo que debes
  const netWorth = walletTotal.add(receivableTotal).sub(debtTotal);
  const usdToDisplay = (usd: Decimal) => toDisplay(usd, "USD");
  const pendingRecurring = recurring.filter((r) => r.active && r.due && !r.paid);
  const today = todayISO();

  return (
    <>
      <PageHeader
        title={`Hola${user.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description={`Resumen de ${formatMonth(month)}`}
        actions={
          <>
            <Link href="/transferencias" className={buttonClass("secondary")}>
              <ArrowLeftRight className="size-4" />
              Transferir
            </Link>
            <Link href="/movimientos/nuevo" className={buttonClass()}>
              <Plus className="size-4" />
              Nuevo movimiento
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="relative col-span-2 overflow-hidden border-transparent bg-gradient-to-br from-teal-700 to-teal-900 text-white lg:col-span-1 dark:from-teal-800 dark:to-[#0b2b29]">
          <div className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <p className="text-sm text-white/75">Patrimonio neto</p>
          <p className="mt-1 truncate text-3xl font-semibold tracking-tight tabular">{formatMoney(netWorth, cur)}</p>
          <div className="mt-3 space-y-1 text-xs tabular text-white/75">
            <p className="flex justify-between gap-2">
              <span>En cuentas</span>
              <span className="text-white">{formatMoney(walletTotal, cur)}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span>Por cobrar</span>
              <span className="text-white">+ {formatMoney(receivableTotal, cur)}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span>Deudas</span>
              <span className={debtTotal.gt(0) ? "text-rose-200" : "text-white"}>− {formatMoney(debtTotal, cur)}</span>
            </p>
            {money.reserved.gt(0) && (
              <p className="flex justify-between gap-2 border-t border-white/15 pt-1.5 text-sm font-medium text-white">
                <Link href="/apartados" className="underline-offset-2 hover:underline">
                  Disponible para usar
                </Link>
                <span>{formatMoney(money.available, cur)}</span>
              </p>
            )}
          </div>
        </Card>
        <Card className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <span className="flex size-6 items-center justify-center rounded-full bg-positive/10 text-positive">
              <ArrowDownLeft className="size-3.5" />
            </span>
            Ingresos
          </p>
          <p className="mt-2 truncate text-xl font-semibold tabular text-positive sm:text-2xl">
            {formatMoney(usdToDisplay(summary.income), cur)}
          </p>
        </Card>
        <Card className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <span className="flex size-6 items-center justify-center rounded-full bg-negative/10 text-negative">
              <ArrowUpRight className="size-3.5" />
            </span>
            Gastos
          </p>
          <p className="mt-2 truncate text-xl font-semibold tabular text-negative sm:text-2xl">
            {formatMoney(usdToDisplay(summary.expense), cur)}
          </p>
        </Card>
        <Link
          href="/tasas"
          className="col-span-2 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:bg-background lg:col-span-1 lg:flex-col lg:items-stretch lg:p-5"
        >
          <span className="flex items-center gap-2 text-sm text-muted">
            <TrendingUp className="size-4" />
            <span className="lg:hidden">Bs/$</span>
            <span className="hidden lg:inline">Tasas (Bs. por $)</span>
          </span>
          <span className="flex flex-1 justify-end gap-4 text-sm tabular lg:flex-col lg:gap-0.5">
            <span className="flex gap-1.5 lg:justify-between">
              <span className="text-muted">BCV</span>
              <span className="font-semibold">{rates.bcv ? rates.bcv.toFixed(2) : "—"}</span>
            </span>
            <span className="flex gap-1.5 lg:justify-between">
              <span className="text-muted">Binance</span>
              <span className="font-semibold">{rates.binance ? rates.binance.toFixed(2) : "—"}</span>
            </span>
          </span>
          <ChevronRight className="size-4 text-muted lg:hidden" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <SectionHeader title="Cuentas" href="/cuentas" linkLabel="Administrar" />
            {wallets.length === 0 ? (
              <EmptyState>
                Empieza creando tus cuentas (banco, PayPal, Binance, efectivo…).{" "}
                <Link href="/cuentas" className="font-medium text-accent hover:underline">
                  Crear cuenta
                </Link>
              </EmptyState>
            ) : (
              <Card className="p-0 sm:p-0">
                <ul className="divide-y divide-border">
                  {wallets.map((w) => (
                    <li key={w.id}>
                      <Link
                        href={`/cuentas/${w.id}`}
                        className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-background"
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                          style={{ background: w.color }}
                          aria-hidden
                        >
                          {w.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{w.name}</span>
                          <span className="block text-xs text-muted">{w.currencyCode}</span>
                        </span>
                        <Amount className="text-sm font-semibold" value={formatMoney(w.balance, w.currencyCode)} />
                        <ChevronRight className="size-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
          <section>
            <SectionHeader title="Últimos movimientos" href="/movimientos" linkLabel="Ver todos" />
            <TransactionList transactions={recent} />
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <SectionTitle>Plan del mes</SectionTitle>
            <Card className="p-0 sm:p-0">
              {budget.income.isZero() ? (
                <p className="p-4 text-sm text-muted">Registra tus ingresos fijos para ver cómo se reparten.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  <li className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="font-medium">Ingresos fijos</span>
                    <span className="tabular text-positive">{formatMoney(budget.income, cur)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span>Gastos fijos{budget.buffer.gt(0) && " + colchón"}</span>
                    <span className="tabular">{formatPercent(budget.fixedPercent.add(budget.bufferIncomePercent))}</span>
                  </li>
                  {budget.pockets.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 px-4 py-2.5">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      <span className="tabular">{formatPercent(b.percent)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span>Libre</span>
                    <span className={budget.overBudget ? "tabular text-negative" : "tabular"}>
                      {formatPercent(budget.freePercent)} · {formatMoney(budget.free, cur)}
                    </span>
                  </li>
                </ul>
              )}
              <CardFooterLink href="/apartados">Ver apartados</CardFooterLink>
            </Card>
          </section>
          {pinnedPockets.length > 0 && (
            <section>
              <SectionTitle>Apartados</SectionTitle>
              <Card className="p-0 sm:p-0">
                <ul className="divide-y divide-border text-sm">
                  {pinnedPockets.map((p) => {
                    const target = p.targetAmount ? new Decimal(p.targetAmount.toString()) : null;
                    const pct = target && target.gt(0) ? Math.min(100, p.balance.div(target).mul(100).toNumber()) : null;
                    return (
                      <li key={p.id} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                          <span className="min-w-0 flex-1 truncate">
                            {p.name}
                            {p.business && <span className="text-xs text-muted"> · {p.business.name}</span>}
                          </span>
                          <Amount className="tabular font-medium" value={formatMoney(p.balance, p.currencyCode)} />
                        </div>
                        {pct !== null && (
                          <div className="mt-2 flex items-center gap-2 pl-[18px]">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: p.color }} />
                            </div>
                            <span className="text-xs tabular text-muted">
                              {pct.toFixed(0)}% de {formatMoney(target!, p.currencyCode)}
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <CardFooterLink href="/apartados">Ir a apartados</CardFooterLink>
              </Card>
            </section>
          )}
          <section>
            <SectionTitle>Gastos fijos pendientes</SectionTitle>
            <Card className="p-0 sm:p-0">
              {pendingRecurring.length === 0 ? (
                <p className="flex items-center gap-2 p-4 text-sm text-muted">
                  {recurring.length ? (
                    <>
                      <CheckCircle2 className="size-4 text-positive" /> Todo pagado este mes
                    </>
                  ) : (
                    "No tienes gastos fijos."
                  )}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {pendingRecurring.map((r) => {
                    const overdue = toISODate(r.dueDate) < today;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.name}</p>
                          <p className={overdue ? "text-xs text-negative" : "text-xs text-muted"}>
                            {overdue ? "Venció" : "Vence"} el {formatDate(r.dueDate, { day: "2-digit", month: "short" })}
                          </p>
                        </div>
                        <span className="tabular font-medium">{formatMoney(r.amount, r.currencyCode)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <CardFooterLink href="/gastos-fijos">Ir a gastos fijos</CardFooterLink>
            </Card>
          </section>
          <section>
            <SectionTitle>Por cobrar</SectionTitle>
            <Card className="p-0 sm:p-0">
              {receivables.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nadie te debe nada.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {receivables.slice(0, 6).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{r.counterparty}</span>
                          {r.kind === "LOAN_GIVEN" && <Badge>Préstamo</Badge>}
                        </p>
                        <p className="text-xs text-muted">{r.expectedDate ? formatDate(r.expectedDate) : "Sin fecha"}</p>
                      </div>
                      <span className="tabular font-medium">{formatMoney(r.remaining, r.currencyCode)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <CardFooterLink href="/por-cobrar">Ir a por cobrar</CardFooterLink>
            </Card>
          </section>
          <section>
            <SectionTitle>Deudas</SectionTitle>
            <Card className="p-0 sm:p-0">
              {debts.length === 0 ? (
                <p className="p-4 text-sm text-muted">No debes nada.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {debts.slice(0, 6).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{d.counterparty}</span>
                          {d.kind === "LOAN_RECEIVED" && <Badge>Préstamo</Badge>}
                        </p>
                        <p className={d.dueDate && toISODate(d.dueDate) < today ? "text-xs text-negative" : "text-xs text-muted"}>
                          {d.dueDate ? `Vence el ${formatDate(d.dueDate)}` : "Sin fecha"}
                        </p>
                      </div>
                      <span className="tabular font-medium">{formatMoney(d.remaining, d.currencyCode)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <CardFooterLink href="/deudas">Ir a deudas</CardFooterLink>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardPageContent />
    </Suspense>
  );
}
