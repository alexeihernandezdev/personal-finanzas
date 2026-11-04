import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CheckCircle2, Circle } from "lucide-react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { MonthNav, parseMonthParam } from "@/components/month-nav";
import { CURRENCIES } from "@/components/wallet-fields";
import { Amount, Badge, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getCategories, getRecurringForMonth, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, currentMonth, formatDate, toISODate, todayISO } from "@/lib/utils";
import { createRecurring, deleteRecurring, payRecurring, toggleRecurring } from "./actions";

async function GastosFijosPageContent({ searchParams }: PageProps<"/gastos-fijos">) {
  const user = await requireUser();
  const { mes } = await searchParams;
  const month = parseMonthParam(mes, currentMonth());
  const [items, wallets, categories, businesses, rates] = await Promise.all([
    getRecurringForMonth(user.id, month),
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
  ]);
  const rate = pickRate(rates, user.preferredRateSource);
  const active = items.filter((i) => i.active);
  const sumIn = (list: typeof items) =>
    list.reduce((acc, i) => {
      try {
        return acc.add(convert(i.amount, i.currencyCode, user.displayCurrency, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));
  const total = sumIn(active);
  const pending = sumIn(active.filter((i) => !i.paid));
  const today = todayISO();

  return (
    <>
      <PageHeader
        title="Gastos fijos"
        description="Pagos que se repiten cada mes"
        actions={<MonthNav month={month} basePath="/gastos-fijos" />}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-muted">Total del mes</p>
          <p className="text-2xl font-semibold tabular">{formatMoney(total, user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Pendiente por pagar</p>
          <p className="text-2xl font-semibold tabular text-negative">{formatMoney(pending, user.displayCurrency)}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {items.length === 0 ? (
            <EmptyState>No tienes gastos fijos. Agrega alquiler, internet, suscripciones…</EmptyState>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-border">
                {items.map((r) => {
                  const overdue = r.active && !r.paid && toISODate(r.dueDate) < today;
                  return (
                    <li key={r.id} className={cn("px-4 py-3", !r.active && "opacity-50")}>
                      <div className="flex flex-wrap items-center gap-3">
                        {r.paid ? (
                          <CheckCircle2 className="size-5 text-positive" />
                        ) : (
                          <Circle className={cn("size-5", overdue ? "text-negative" : "text-muted")} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{r.name}</p>
                          <p className="text-xs text-muted">
                            Día {r.dayOfMonth} · {formatDate(r.dueDate, { day: "2-digit", month: "short" })}
                            {r.category && ` · ${r.category.name}`}
                            {r.business && ` · ${r.business.name}`}
                            {r.wallet && ` · ${r.wallet.name}`}
                          </p>
                        </div>
                        {overdue && <Badge className="bg-negative/10 text-negative">Vencido</Badge>}
                        {!r.active && <Badge>Pausado</Badge>}
                        <Amount className="font-medium" value={formatMoney(r.amount, r.currencyCode)} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                        {r.paid && r.payment ? (
                          <span className="text-xs text-positive">
                            Pagado el {formatDate(r.payment.date, { day: "2-digit", month: "short" })} (
                            {formatMoney(r.payment.amount, r.wallet?.currencyCode ?? r.currencyCode)})
                          </span>
                        ) : (
                          r.active && (
                            <ActionForm
                              action={payRecurring.bind(null, r.id, month)}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <Select name="walletId" defaultValue={r.walletId ?? wallets[0]?.id} className="h-8 w-40 text-xs">
                                {wallets.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.name} ({w.currencyCode})
                                  </option>
                                ))}
                              </Select>
                              <Input name="amount" defaultValue={r.amount.toFixed(2)} inputMode="decimal" className="h-8 w-28 text-xs" />
                              <Input name="date" type="date" defaultValue={toISODate(r.dueDate)} className="h-8 w-36 text-xs" />
                              <SubmitButton variant="secondary" className="h-8 text-xs">
                                Marcar pagado
                              </SubmitButton>
                            </ActionForm>
                          )
                        )}
                        <div className="ml-auto flex">
                          <ConfirmButton action={toggleRecurring.bind(null, r.id)} variant="ghost" className="h-8 text-xs text-muted">
                            {r.active ? "Pausar" : "Activar"}
                          </ConfirmButton>
                          <ConfirmButton
                            action={deleteRecurring.bind(null, r.id)}
                            confirm="¿Eliminar este gasto fijo? Los pagos ya registrados se conservan."
                            variant="ghost"
                            className="h-8 text-xs"
                          >
                            Eliminar
                          </ConfirmButton>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nuevo gasto fijo</h2>
          <ActionForm action={createRecurring} className="flex flex-col gap-3">
            <Field label="Nombre">
              <Input name="name" required placeholder="Ej. Alquiler, Internet…" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Monto">
                <Input name="amount" required inputMode="decimal" placeholder="0,00" />
              </Field>
              <Field label="Divisa">
                <Select name="currencyCode" defaultValue="USD">
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.value}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Día del mes">
              <Input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={1} />
            </Field>
            <Field label="Cuenta habitual">
              <Select name="walletId" defaultValue="">
                <option value="">—</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Categoría">
              <Select name="categoryId" defaultValue="">
                <option value="">—</option>
                {categories
                  .filter((c) => c.kind === "EXPENSE")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Negocio">
              <Select name="businessId" defaultValue="">
                <option value="">Personal</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton>Crear</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

export default function GastosFijosPage(props: PageProps<"/gastos-fijos">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GastosFijosPageContent {...props} />
    </Suspense>
  );
}
