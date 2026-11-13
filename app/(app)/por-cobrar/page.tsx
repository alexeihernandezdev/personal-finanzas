import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { PocketPicker } from "@/components/pocket-picker";
import { ReceivableForm } from "@/components/receivable-form";
import { ReceivablePaymentFields } from "@/components/receivable-payment-fields";
import { Amount, Badge, Card, Checkbox, EmptyState, Input, PageHeader, PENDING_SECTIONS, SectionSwitch } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getPocketChoices, getReceivables, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, formatDate, toISODate, todayISO } from "@/lib/utils";
import { cancelReceivable, createReceivable, deleteReceivable, registerPayment } from "./actions";

const STATUS: Record<string, { label: string; color: "gray" | "warning" | "success"; className?: string }> = {
  PENDING: { label: "Pendiente", color: "gray" },
  PARTIAL: { label: "Parcial", color: "warning" },
  SETTLED: { label: "Cobrado", color: "success" },
  CANCELLED: { label: "Cancelado", color: "gray", className: "line-through" },
};

async function PorCobrarPageContent({ searchParams }: PageProps<"/por-cobrar">) {
  const { tab, ver } = await searchParams;
  const kind = tab === "prestamos" ? "LOAN_GIVEN" : "RECEIVABLE";
  const showAll = ver === "todos";
  const user = await requireUser();
  const [all, wallets, businesses, rates, pockets] = await Promise.all([
    getReceivables(user.id),
    getWalletsWithBalance(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
    getPocketChoices(user.id),
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
  const walletChoices = wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }));
  const tabHref = (t: string, v?: string) => `/por-cobrar?tab=${t}${v ? `&ver=${v}` : ""}`;
  const currentTab = kind === "LOAN_GIVEN" ? "prestamos" : "cobros";

  return (
    <>
      <SectionSwitch items={PENDING_SECTIONS} current="/por-cobrar" />
      <PageHeader title="Por cobrar" description="Dinero que te van a pagar y préstamos que hiciste" />
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-muted">Te deben (por cobrar)</p>
          <p className="mt-1 truncate text-xl font-semibold tabular sm:text-2xl">{formatMoney(totalOpen("RECEIVABLE"), user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Prestado pendiente</p>
          <p className="mt-1 truncate text-xl font-semibold tabular sm:text-2xl">{formatMoney(totalOpen("LOAN_GIVEN"), user.displayCurrency)}</p>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {[
              ["cobros", "Por cobrar"],
              ["prestamos", "Préstamos"],
            ].map(([t, label]) => (
              <Link
                key={t}
                href={tabHref(t, showAll ? "todos" : undefined)}
                className={cn(
                  "flex h-10 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
                  currentTab === t ? "border-transparent bg-foreground font-medium text-background" : "border-border bg-surface text-muted hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
            <Link href={tabHref(currentTab, showAll ? undefined : "todos")} className="ml-auto inline-flex min-h-10 items-center px-1 text-sm text-accent hover:underline">
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
                        {overdue && <Badge color="error">Atrasado</Badge>}
                        <Badge color={STATUS[r.status].color} className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge>
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
                    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-center">
                      {open && wallets.length > 0 && (
                        <ActionForm action={registerPayment} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                          <input type="hidden" name="receivableId" value={r.id} />
                          <ReceivablePaymentFields
                            wallets={walletChoices}
                            remaining={r.remaining.toFixed(2)}
                            currencyCode={r.currencyCode}
                            rate={rate?.toString() ?? null}
                          />
                          <Input name="date" type="date" defaultValue={today} className="sm:h-8 sm:w-36 sm:text-xs" />
                          <PocketPicker pockets={pockets} direction="in" className="col-span-2 sm:h-8 sm:w-44 sm:text-xs" />
                          {r.kind === "RECEIVABLE" && (
                            <Checkbox
                              name="distribute"
                              defaultChecked
                              label="Repartir en los apartados"
                              title="Si entra a una Caja, se reparte entre sus apartados con %"
                              className="col-span-2"
                            />
                          )}
                          <SubmitButton className="col-span-2 sm:h-8 sm:text-xs">
                            Registrar cobro
                          </SubmitButton>
                        </ActionForm>
                      )}
                      <div className="-mx-2 flex flex-wrap sm:mx-0 sm:ml-auto">
                        {r.status !== "SETTLED" && (
                          <ConfirmButton action={cancelReceivable.bind(null, r.id)} variant="ghost" className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs">
                            {r.status === "CANCELLED" ? "Reabrir" : "Cancelar"}
                          </ConfirmButton>
                        )}
                        <ConfirmButton
                          action={deleteReceivable.bind(null, r.id)}
                          confirm="¿Eliminar? También se borran los movimientos asociados (préstamo y cobros)."
                          variant="ghost"
                          className="h-10 px-3 text-sm sm:h-8 sm:text-xs"
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
            wallets={walletChoices}
            businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
            pockets={pockets}
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
