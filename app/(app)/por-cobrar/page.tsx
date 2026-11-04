import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { ReceivableForm } from "@/components/receivable-form";
import { Amount, Badge, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getReceivables, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, formatDate, toISODate, todayISO } from "@/lib/utils";
import { cancelReceivable, createReceivable, deleteReceivable, registerPayment } from "./actions";

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendiente", className: "" },
  PARTIAL: { label: "Parcial", className: "bg-amber-500/10 text-amber-600" },
  SETTLED: { label: "Cobrado", className: "bg-positive/10 text-positive" },
  CANCELLED: { label: "Cancelado", className: "line-through" },
};

async function PorCobrarPageContent({ searchParams }: PageProps<"/por-cobrar">) {
  const { tab, ver } = await searchParams;
  const kind = tab === "prestamos" ? "LOAN_GIVEN" : "RECEIVABLE";
  const showAll = ver === "todos";
  const user = await requireUser();
  const [all, wallets, businesses, rates] = await Promise.all([
    getReceivables(user.id),
    getWalletsWithBalance(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
  ]);
  const rate = pickRate(rates, user.preferredRateSource);
  const items = all.filter((r) => r.kind === kind && (showAll || r.status === "PENDING" || r.status === "PARTIAL"));
  const totalOpen = (k: string) =>
    all
      .filter((r) => r.kind === k && (r.status === "PENDING" || r.status === "PARTIAL"))
      .reduce((acc, r) => {
        try {
          return acc.add(convert(r.remaining, r.currencyCode, user.displayCurrency, rate));
        } catch {
          return acc;
        }
      }, new Decimal(0));
  const today = todayISO();
  const tabHref = (t: string, v?: string) => `/por-cobrar?tab=${t}${v ? `&ver=${v}` : ""}`;
  const currentTab = kind === "LOAN_GIVEN" ? "prestamos" : "cobros";

  return (
    <>
      <PageHeader title="Por cobrar" description="Dinero que te van a pagar y préstamos que hiciste" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-muted">Te deben (por cobrar)</p>
          <p className="text-2xl font-semibold tabular">{formatMoney(totalOpen("RECEIVABLE"), user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Prestado pendiente</p>
          <p className="text-2xl font-semibold tabular">{formatMoney(totalOpen("LOAN_GIVEN"), user.displayCurrency)}</p>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[
              ["cobros", "Por cobrar"],
              ["prestamos", "Préstamos"],
            ].map(([t, label]) => (
              <Link
                key={t}
                href={tabHref(t, showAll ? "todos" : undefined)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm",
                  currentTab === t ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface",
                )}
              >
                {label}
              </Link>
            ))}
            <Link href={tabHref(currentTab, showAll ? undefined : "todos")} className="ml-auto text-xs text-muted hover:underline">
              {showAll ? "Ver solo abiertos" : "Ver también cerrados"}
            </Link>
          </div>
          {items.length === 0 ? (
            <EmptyState>Nada pendiente por aquí.</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((r) => {
                const open = r.status === "PENDING" || r.status === "PARTIAL";
                const overdue = open && r.expectedDate && toISODate(r.expectedDate) < today;
                const pct = Math.min(100, r.collected.div(r.amount.toString()).mul(100).toNumber());
                return (
                  <Card key={r.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{r.counterparty}</p>
                        <p className="text-xs text-muted">
                          {r.description && `${r.description} · `}
                          {r.expectedDate ? `Esperado el ${formatDate(r.expectedDate)}` : "Sin fecha"}
                          {r.business && ` · ${r.business.name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {overdue && <Badge className="bg-negative/10 text-negative">Atrasado</Badge>}
                        <Badge className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex items-end justify-between text-sm">
                      <span className="text-muted">
                        Cobrado {formatMoney(r.collected, r.currencyCode)} de {formatMoney(r.amount, r.currencyCode)}
                      </span>
                      <Amount className="font-semibold" value={formatMoney(r.remaining, r.currencyCode)} />
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background">
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    {r.transactions.length > 0 && (
                      <ul className="mt-3 space-y-0.5 text-xs text-muted">
                        {r.transactions.map((t) => (
                          <li key={t.id}>
                            {formatDate(t.date)} · {t.type === "LOAN_OUT" ? "Prestado desde" : "Cobrado en"} {t.wallet.name}:{" "}
                            {formatMoney(t.amount, t.wallet.currencyCode)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      {open && wallets.length > 0 && (
                        <ActionForm action={registerPayment} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="receivableId" value={r.id} />
                          <Select name="walletId" className="h-8 w-40 text-xs" defaultValue={wallets.find((w) => w.currencyCode === r.currencyCode)?.id}>
                            {wallets.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name} ({w.currencyCode})
                              </option>
                            ))}
                          </Select>
                          <Input name="amount" inputMode="decimal" defaultValue={r.remaining.toFixed(2)} className="h-8 w-28 text-xs" />
                          <Input name="date" type="date" defaultValue={today} className="h-8 w-36 text-xs" />
                          <SubmitButton variant="secondary" className="h-8 text-xs">
                            Registrar cobro
                          </SubmitButton>
                        </ActionForm>
                      )}
                      <div className="ml-auto flex">
                        {r.status !== "SETTLED" && (
                          <ConfirmButton action={cancelReceivable.bind(null, r.id)} variant="ghost" className="h-8 text-xs text-muted">
                            {r.status === "CANCELLED" ? "Reabrir" : "Cancelar"}
                          </ConfirmButton>
                        )}
                        <ConfirmButton
                          action={deleteReceivable.bind(null, r.id)}
                          confirm="¿Eliminar? También se borran los movimientos asociados (préstamo y cobros)."
                          variant="ghost"
                          className="h-8 text-xs"
                        >
                          Eliminar
                        </ConfirmButton>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nuevo registro</h2>
          <ReceivableForm
            action={createReceivable}
            wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
            businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
            today={today}
          />
        </Card>
      </div>
    </>
  );
}

export default function PorCobrarPage(props: PageProps<"/por-cobrar">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PorCobrarPageContent {...props} />
    </Suspense>
  );
}
