import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { DebtForm } from "@/components/debt-form";
import { PocketPicker } from "@/components/pocket-picker";
import { Amount, Badge, Card, EmptyState, Input, PageHeader, PENDING_SECTIONS, SectionSwitch, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getDebts, getPocketChoices, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, formatDate, toISODate, todayISO } from "@/lib/utils";
import { cancelDebt, createDebt, deleteDebt, deleteDebtPayment, registerDebtPayment, updateDebtTransaction } from "./actions";

const STATUS: Record<string, { label: string; color: "gray" | "warning" | "success"; className?: string }> = {
  PENDING: { label: "Pendiente", color: "gray" },
  PARTIAL: { label: "Parcial", color: "warning" },
  SETTLED: { label: "Pagado", color: "success" },
  CANCELLED: { label: "Cancelado", color: "gray", className: "line-through" },
};

async function DeudasPageContent({ searchParams }: PageProps<"/deudas">) {
  const { tab, ver } = await searchParams;
  const kind = tab === "prestamos" ? "LOAN_RECEIVED" : "PAYABLE";
  const showAll = ver === "todos";
  const user = await requireUser();
  const [all, wallets, businesses, rates, pockets] = await Promise.all([
    getDebts(user.id),
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
  const tabHref = (t: string, v?: string) => `/deudas?tab=${t}${v ? `&ver=${v}` : ""}`;
  const currentTab = kind === "LOAN_RECEIVED" ? "prestamos" : "deudas";

  return (
    <>
      <SectionSwitch items={PENDING_SECTIONS} current="/deudas" />
      <PageHeader title="Deudas" description="Lo que debes pagar y préstamos que te hicieron" />
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-sm text-muted">Por pagar</p>
          <p className="mt-1 truncate text-xl font-semibold tabular sm:text-2xl">{formatMoney(totalOpen("PAYABLE"), user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Préstamos</p>
          <p className="mt-1 truncate text-xl font-semibold tabular sm:text-2xl">{formatMoney(totalOpen("LOAN_RECEIVED"), user.displayCurrency)}</p>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {[
              ["deudas", "Por pagar"],
              ["prestamos", "Préstamos recibidos"],
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
                const overdue = open && r.dueDate && toISODate(r.dueDate) < today;
                const pct = Math.min(100, r.paid.div(r.amount.toString()).mul(100).toNumber());
                return (
                  <Card key={r.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{r.counterparty}</p>
                        <p className="text-xs text-muted">
                          {r.description && `${r.description} · `}
                          {r.dueDate ? `Vence el ${formatDate(r.dueDate)}` : "Sin fecha"}
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
                        Pagado {formatMoney(r.paid, r.currencyCode)} de {formatMoney(r.amount, r.currencyCode)}
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
                            <details className="group">
                              <summary className="cursor-pointer list-none hover:text-foreground">
                                {formatDate(t.date)} · {t.type === "LOAN_IN" ? "Recibido en" : "Pagado desde"} {t.wallet.name}:{" "}
                                {formatMoney(t.amount, t.wallet.currencyCode)}{" "}
                                <span className="underline group-open:hidden">Editar</span>
                              </summary>
                              <div className="mt-2 mb-3 flex flex-wrap items-center gap-2">
                                <ActionForm
                                  action={updateDebtTransaction.bind(null, t.id)}
                                  resetOnSuccess={false}
                                  className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
                                >
                                  <Select name="walletId" className="col-span-2 sm:h-8 sm:w-40 sm:text-xs" defaultValue={t.walletId}>
                                    {!wallets.some((w) => w.id === t.walletId) && (
                                      <option value={t.walletId}>
                                        {t.wallet.name} ({t.wallet.currencyCode})
                                      </option>
                                    )}
                                    {wallets.map((w) => (
                                      <option key={w.id} value={w.id}>
                                        {w.name} ({w.currencyCode})
                                      </option>
                                    ))}
                                  </Select>
                                  <Input name="amount" inputMode="decimal" defaultValue={t.amount.toFixed(2)} className="sm:h-8 sm:w-28 sm:text-xs" />
                                  <Input name="date" type="date" defaultValue={toISODate(t.date)} className="sm:h-8 sm:w-36 sm:text-xs" />
                                  <SubmitButton className="col-span-2 sm:h-8 sm:text-xs">
                                    Guardar
                                  </SubmitButton>
                                </ActionForm>
                                {t.type !== "LOAN_IN" && (
                                  <ConfirmButton
                                    action={deleteDebtPayment.bind(null, t.id)}
                                    confirm="¿Eliminar este pago? La deuda se reabrirá si queda saldo pendiente."
                                    variant="ghost"
                                    className="h-10 px-3 text-sm sm:h-8 sm:text-xs"
                                  >
                                    Eliminar pago
                                  </ConfirmButton>
                                )}
                              </div>
                            </details>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-center">
                      {open && wallets.length > 0 && (
                        <ActionForm action={registerDebtPayment} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                          <input type="hidden" name="debtId" value={r.id} />
                          <Select name="walletId" className="col-span-2 sm:h-8 sm:w-40 sm:text-xs" defaultValue={wallets.find((w) => w.currencyCode === r.currencyCode)?.id}>
                            {wallets.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name} ({w.currencyCode})
                              </option>
                            ))}
                          </Select>
                          <Input name="amount" inputMode="decimal" defaultValue={r.remaining.toFixed(2)} className="sm:h-8 sm:w-28 sm:text-xs" />
                          <Input name="date" type="date" defaultValue={today} className="sm:h-8 sm:w-36 sm:text-xs" />
                          <PocketPicker pockets={pockets} direction="out" className="col-span-2 sm:h-8 sm:w-44 sm:text-xs" />
                          <SubmitButton className="col-span-2 sm:h-8 sm:text-xs">
                            Registrar pago
                          </SubmitButton>
                        </ActionForm>
                      )}
                      <div className="-mx-2 flex flex-wrap sm:mx-0 sm:ml-auto">
                        {r.status !== "SETTLED" && (
                          <ConfirmButton action={cancelDebt.bind(null, r.id)} variant="ghost" className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs">
                            {r.status === "CANCELLED" ? "Reabrir" : "Cancelar"}
                          </ConfirmButton>
                        )}
                        <ConfirmButton
                          action={deleteDebt.bind(null, r.id)}
                          confirm="¿Eliminar? También se borran los movimientos asociados (préstamo y pagos)."
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
          <DebtForm
            action={createDebt}
            wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
            businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
            pockets={pockets}
            today={today}
          />
        </Card>
      </div>
    </>
  );
}

export default function DeudasPage(props: PageProps<"/deudas">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DeudasPageContent {...props} />
    </Suspense>
  );
}
