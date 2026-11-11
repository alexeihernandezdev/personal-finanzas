import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CheckCircle2, Circle, Repeat } from "lucide-react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { MonthNav, parseMonthParam } from "@/components/month-nav";
import { CURRENCIES } from "@/components/wallet-fields";
import { Amount, Badge, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getCategories, getRecurringForMonth, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { processAutoPayments } from "@/lib/recurring";
import { cn, currentMonth, formatDate, toISODate, todayISO } from "@/lib/utils";
import { createRecurring, deleteRecurring, updateRecurring, payRecurring, toggleAutoPay, toggleRecurring, unpayRecurring } from "./actions";

async function GastosFijosPageContent({ searchParams }: PageProps<"/gastos-fijos">) {
  const user = await requireUser();
  const { mes } = await searchParams;
  const month = parseMonthParam(mes, currentMonth());
  // Registra los cobros automáticos que ya vencieron (por si el cron aún no corrió)
  await processAutoPayments(user.id).catch(() => null);
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
                    <li key={r.id} className={cn("relative px-4 py-3", !r.active && "opacity-50")}>
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
                        {r.autoPay && (
                          <Badge className="gap-1">
                            <Repeat className="size-3" /> Automático
                          </Badge>
                        )}
                        {!r.active && <Badge>Pausado</Badge>}
                        <Amount className="font-medium" value={formatMoney(r.amount, r.currencyCode)} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                        {r.paid && r.payment ? (
                          <>
                            <span className="text-xs text-positive">
                              {r.autoPay ? "Cobrado" : "Pagado"} el{" "}
                              {formatDate(r.payment.date, { day: "2-digit", month: "short" })} con {r.payment.wallet.name} (
                              {formatMoney(r.payment.amount, r.payment.wallet.currencyCode)})
                            </span>
                            <Link href={`/movimientos/${r.payment.id}`} className="px-2 text-xs text-muted hover:text-foreground">
                              Editar
                            </Link>
                            <ConfirmButton
                              action={unpayRecurring.bind(null, r.id, month)}
                              confirm={
                                r.autoPay
                                  ? "¿Deshacer este cobro? Se eliminará el movimiento y el gasto pasará a pago manual."
                                  : "¿Deshacer este pago? Se eliminará el movimiento registrado."
                              }
                              variant="ghost"
                              className="h-8 text-xs text-muted"
                            >
                              Deshacer
                            </ConfirmButton>
                          </>
                        ) : (
                          r.active &&
                          (r.autoPay ? (
                            <span className="text-xs text-muted">
                              Se cobra solo el {formatDate(r.dueDate, { day: "2-digit", month: "short" })}
                              {r.wallet && ` de ${r.wallet.name}`}
                            </span>
                          ) : (
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
                              <Input name="amount" defaultValue={r.amount.toFixed(2)} inputMode="decimal" className="h-8 w-24 text-xs" />
                              <Select name="amountCurrency" defaultValue={r.currencyCode} className="h-8 w-24 text-xs">
                                {CURRENCIES.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.value}
                                  </option>
                                ))}
                              </Select>
                              <Input
                                name="date"
                                type="date"
                                defaultValue={month === currentMonth() ? today : toISODate(r.dueDate)}
                                title="Fecha en que pagaste; se usa la tasa BCV de ese día"
                                className="h-8 w-36 text-xs"
                              />
                              <SubmitButton variant="secondary" className="h-8 text-xs">
                                Marcar pagado
                              </SubmitButton>
                            </ActionForm>
                          ))
                        )}
                        <div className="ml-auto flex">
                          <details className="group">
                            <summary className="flex h-8 cursor-pointer list-none items-center px-3 text-xs text-muted hover:text-foreground">
                              Editar
                            </summary>
                            <div className="absolute left-4 right-4 z-10 mt-2 rounded-xl border border-border bg-surface p-4 shadow-lg sm:left-auto sm:w-80">
                              <ActionForm action={updateRecurring.bind(null, r.id)} resetOnSuccess={false} className="flex flex-col gap-3">
                                <RecurringFields wallets={wallets} categories={categories} businesses={businesses} defaults={r} />
                                <SubmitButton>Guardar</SubmitButton>
                              </ActionForm>
                            </div>
                          </details>
                          {(r.autoPay || r.walletId) && (
                            <ConfirmButton action={toggleAutoPay.bind(null, r.id)} variant="ghost" className="h-8 text-xs text-muted">
                              {r.autoPay ? "Hacer manual" : "Hacer automático"}
                            </ConfirmButton>
                          )}
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
            <RecurringFields wallets={wallets} categories={categories} businesses={businesses} />
            <SubmitButton>Crear</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

type RecurringDefaults = {
  name: string;
  amount: Decimal;
  currencyCode: string;
  dayOfMonth: number;
  walletId: string | null;
  categoryId: string | null;
  businessId: string | null;
  autoPay: boolean;
};

function RecurringFields({
  wallets,
  categories,
  businesses,
  defaults,
}: {
  wallets: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
  businesses: { id: string; name: string }[];
  defaults?: RecurringDefaults;
}) {
  return (
    <>
      <Field label="Nombre">
        <Input name="name" required placeholder="Ej. Alquiler, Internet…" defaultValue={defaults?.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monto">
          <Input name="amount" required inputMode="decimal" placeholder="0,00" defaultValue={defaults?.amount.toFixed(2)} />
        </Field>
        <Field label="Divisa">
          <Select name="currencyCode" defaultValue={defaults?.currencyCode ?? "USD"}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Día del mes">
        <Input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={defaults?.dayOfMonth ?? 1} />
      </Field>
      <Field label="Cuenta habitual">
        <Select name="walletId" defaultValue={defaults?.walletId ?? ""}>
          <option value="">—</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Categoría">
        <Select name="categoryId" defaultValue={defaults?.categoryId ?? ""}>
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
        <Select name="businessId" defaultValue={defaults?.businessId ?? ""}>
          <option value="">Personal</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="autoPay" className="mt-0.5" defaultChecked={defaults?.autoPay} />
        <span>
          Se cobra automáticamente
          <span className="block text-xs text-muted">
            Se registra solo el día del vencimiento en la cuenta habitual, con la tasa BCV de ese día.
          </span>
        </span>
      </label>
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
