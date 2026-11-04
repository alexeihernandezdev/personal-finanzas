import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { TransactionList } from "@/components/transaction-list";
import { Amount, Badge, buttonClass, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import {
  getDebts,
  getMonthSummary,
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
  const [wallets, summary, recurring, receivables, debts, recent] = await Promise.all([
    getWalletsWithBalance(user.id),
    getMonthSummary(user.id, month, rate),
    getRecurringForMonth(user.id, month),
    getReceivables(user.id, { onlyOpen: true }),
    getDebts(user.id, { onlyOpen: true }),
    listTransactions(user.id, {}, 8),
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
  const pendingRecurring = recurring.filter((r) => r.active && !r.paid);
  const today = todayISO();

  return (
    <>
      <PageHeader
        title={`Hola${user.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description={`Resumen de ${formatMonth(month)}`}
        actions={
          <>
            <Link href="/transferencias" className={buttonClass("secondary")}>
              Transferir
            </Link>
            <Link href="/movimientos/nuevo" className={buttonClass()}>
              Nuevo movimiento
            </Link>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="sm:col-span-2 lg:col-span-1">
          <p className="text-sm text-muted">Patrimonio neto</p>
          <p className="mt-1 text-3xl font-semibold">
            <Amount value={formatMoney(netWorth, cur)} />
          </p>
          <div className="mt-2 space-y-0.5 text-xs tabular text-muted">
            <p className="flex justify-between">
              <span>En cuentas</span>
              <span>{formatMoney(walletTotal, cur)}</span>
            </p>
            <p className="flex justify-between">
              <span>Por cobrar</span>
              <span>+ {formatMoney(receivableTotal, cur)}</span>
            </p>
            <p className="flex justify-between">
              <span>Deudas</span>
              <span className={debtTotal.gt(0) ? "text-negative" : undefined}>− {formatMoney(debtTotal, cur)}</span>
            </p>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">Ingresos del mes</p>
          <p className="mt-1 text-2xl font-semibold tabular text-positive">{formatMoney(usdToDisplay(summary.income), cur)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Gastos del mes</p>
          <p className="mt-1 text-2xl font-semibold tabular text-negative">{formatMoney(usdToDisplay(summary.expense), cur)}</p>
        </Card>
        <Card className="sm:col-span-2 lg:col-span-1">
          <p className="text-sm text-muted">Tasas (Bs. por $)</p>
          <div className="mt-1 space-y-0.5 text-sm tabular">
            <p className="flex justify-between">
              <span className="text-muted">BCV</span>
              <span className="font-medium">{rates.bcv ? rates.bcv.toFixed(2) : "—"}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted">Binance</span>
              <span className="font-medium">{rates.binance ? rates.binance.toFixed(2) : "—"}</span>
            </p>
          </div>
          <Link href="/tasas" className="mt-1 inline-block text-xs text-accent hover:underline">
            Ver histórico
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <section>
            <div className="flex items-center justify-between">
              <SectionTitle>Cuentas</SectionTitle>
              <Link href="/cuentas" className="mb-3 text-xs text-accent hover:underline">
                Administrar
              </Link>
            </div>
            {wallets.length === 0 ? (
              <EmptyState>
                Empieza creando tus cuentas (banco, PayPal, Binance, efectivo…).{" "}
                <Link href="/cuentas" className="text-accent hover:underline">
                  Crear cuenta
                </Link>
              </EmptyState>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-border">
                  {wallets.map((w) => (
                    <li key={w.id}>
                      <Link href={`/cuentas/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-background">
                        <span className="size-2.5 rounded-full" style={{ background: w.color }} />
                        <span className="flex-1 text-sm font-medium">{w.name}</span>
                        <Badge>{w.currencyCode}</Badge>
                        <Amount className="w-36 text-right text-sm font-medium" value={formatMoney(w.balance, w.currencyCode)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
          <section>
            <div className="flex items-center justify-between">
              <SectionTitle>Últimos movimientos</SectionTitle>
              <Link href="/movimientos" className="mb-3 text-xs text-accent hover:underline">
                Ver todos
              </Link>
            </div>
            <TransactionList transactions={recent} />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>Gastos fijos pendientes</SectionTitle>
            <Card className="p-0">
              {pendingRecurring.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  {recurring.length ? "Todo pagado este mes 🎉" : "No tienes gastos fijos."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {pendingRecurring.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">{r.name}</p>
                        <p className={toISODate(r.dueDate) < today ? "text-xs text-negative" : "text-xs text-muted"}>
                          {toISODate(r.dueDate) < today ? "Venció" : "Vence"} el {formatDate(r.dueDate, { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      <span className="tabular">{formatMoney(r.amount, r.currencyCode)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/gastos-fijos" className="block border-t border-border px-4 py-2 text-xs text-accent hover:underline">
                Ir a gastos fijos
              </Link>
            </Card>
          </section>
          <section>
            <SectionTitle>Por cobrar</SectionTitle>
            <Card className="p-0">
              {receivables.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nadie te debe nada.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {receivables.slice(0, 6).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">
                          {r.counterparty}
                          {r.kind === "LOAN_GIVEN" && <Badge className="ml-2">Préstamo</Badge>}
                        </p>
                        <p className="text-xs text-muted">{r.expectedDate ? formatDate(r.expectedDate) : "Sin fecha"}</p>
                      </div>
                      <span className="tabular">{formatMoney(r.remaining, r.currencyCode)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/por-cobrar" className="block border-t border-border px-4 py-2 text-xs text-accent hover:underline">
                Ir a por cobrar
              </Link>
            </Card>
          </section>
          <section>
            <SectionTitle>Deudas</SectionTitle>
            <Card className="p-0">
              {debts.length === 0 ? (
                <p className="p-4 text-sm text-muted">No debes nada.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {debts.slice(0, 6).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">
                          {d.counterparty}
                          {d.kind === "LOAN_RECEIVED" && <Badge className="ml-2">Préstamo</Badge>}
                        </p>
                        <p className={d.dueDate && toISODate(d.dueDate) < today ? "text-xs text-negative" : "text-xs text-muted"}>
                          {d.dueDate ? `Vence el ${formatDate(d.dueDate)}` : "Sin fecha"}
                        </p>
                      </div>
                      <span className="tabular">{formatMoney(d.remaining, d.currencyCode)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/deudas" className="block border-t border-border px-4 py-2 text-xs text-accent hover:underline">
                Ir a deudas
              </Link>
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
