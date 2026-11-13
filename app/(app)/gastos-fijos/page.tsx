import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { Check, CheckCircle2, Circle, Repeat } from "lucide-react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { MonthNav, parseMonthParam } from "@/components/month-nav";
import { PocketPicker } from "@/components/pocket-picker";
import { CURRENCIES } from "@/components/wallet-fields";
import { Amount, Badge, buttonClass, Card, Checkbox, EmptyState, Field, FIXED_SECTIONS, Input, PageHeader, SectionSwitch, Select } from "@/components/ui";
import { FREQUENCIES, nextDueMonth } from "@/lib/budget";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { getMonthlyPlan } from "@/lib/fixed-reserve";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getCategories, getPocketChoices, getPockets, getRecurringForMonth, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { processAutoPayments } from "@/lib/recurring";
import { cn, currentMonth, formatDate, toISODate, todayISO } from "@/lib/utils";
import { createRecurring, deleteRecurring, updateRecurring, payRecurring, toggleAutoPay, toggleRecurring, unpayRecurring } from "./actions";

async function GastosFijosPageContent({ searchParams }: PageProps<"/gastos-fijos">) {
  const user = await requireUser();
  const { mes, negocio } = await searchParams;
  const month = parseMonthParam(mes, currentMonth());
  // Registra los cobros automáticos que ya vencieron (por si el cron aún no corrió)
  await processAutoPayments(user.id).catch(() => null);
  const [allItems, wallets, categories, businesses, rates, pockets, pocketBalances] = await Promise.all([
    getRecurringForMonth(user.id, month),
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
    getPocketChoices(user.id),
    getPockets(user.id),
  ]);
  const rate = pickRate(rates, user.preferredRateSource);
  // Los gastos fijos van por dueño del dinero: Personal y cada negocio
  const tabs = [{ key: "personal", name: "Personal" }, ...businesses.map((b) => ({ key: b.id, name: b.name }))];
  const currentTab = tabs.find((t) => t.key === negocio) ?? tabs[0];
  const businessId = currentTab.key === "personal" ? null : currentTab.key;
  // Primero los que vencen este mes; los trimestrales, semestrales y anuales que no, al final
  const items = allItems.filter((i) => i.businessId === businessId).sort((a, b) => Number(b.due) - Number(a.due));
  // Los pagos salen del apartado "Gastos fijos" del dueño (se puede elegir otro al pagar)
  const ownReserve = pocketBalances.find((p) => p.isFixedReserve && !p.archived && p.businessId === businessId);
  const plan = await getMonthlyPlan(prisma, user.id, businessId, user.displayCurrency, rate);
  let reserveHave = new Decimal(0);
  try {
    if (ownReserve) reserveHave = convert(ownReserve.balance, ownReserve.currencyCode, user.displayCurrency, rate);
  } catch {
    // Sin tasa para convertir
  }
  const reserveTarget = plan.fixedWithBuffer;
  const active = items.filter((i) => i.active && i.due);
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
      <SectionSwitch items={FIXED_SECTIONS} current="/gastos-fijos" />
      <PageHeader
        title="Gastos fijos"
        description="Pagos que se repiten cada mes, trimestre, semestre o año"
        actions={<MonthNav month={month} basePath="/gastos-fijos" query={`negocio=${currentTab.key}`} />}
      />
      <nav className="no-scrollbar -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:mb-6 sm:flex-wrap sm:px-0" aria-label="Dueño de los gastos fijos">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/gastos-fijos?negocio=${t.key}&mes=${month}`}
            className={cn(
              "flex h-10 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
              currentTab.key === t.key ? "border-transparent bg-foreground font-medium text-background" : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {t.name}
          </Link>
        ))}
      </nav>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Total del mes</p>
          <p className="mt-1 truncate text-xl font-semibold tabular sm:text-2xl">{formatMoney(total, user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Pendiente</p>
          <p className="mt-1 truncate text-xl font-semibold tabular text-negative sm:text-2xl">{formatMoney(pending, user.displayCurrency)}</p>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <p className="text-sm text-muted">En {ownReserve?.name ?? "Gastos fijos"}</p>
          <p className="text-2xl font-semibold tabular">
            {formatMoney(reserveHave, user.displayCurrency)}
            <span className="ml-1 text-sm font-normal text-muted">de {formatMoney(reserveTarget, user.displayCurrency)} al mes</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn("h-full rounded-full", reserveHave.lt(reserveTarget) ? "bg-accent" : "bg-positive")}
              style={{ width: `${reserveTarget.isZero() ? 0 : Decimal.min(100, reserveHave.div(reserveTarget).mul(100)).toNumber()}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Se llena con cada ingreso de {currentTab.name}; los anuales y trimestrales cuentan su parte de cada mes.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {items.length === 0 ? (
            <EmptyState>No tienes gastos fijos. Agrega alquiler, internet, suscripciones…</EmptyState>
          ) : (
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-border">
                {items.map((r) => {
                  const overdue = r.active && r.due && !r.paid && toISODate(r.dueDate) < today;
                  const frequency = FREQUENCIES.find((f) => f.months === r.intervalMonths);
                  return (
                    <li key={r.id} className={cn("relative px-4 py-4", !r.active && "opacity-50")}>
                      <div className="flex items-start gap-3">
                        {r.paid ? (
                          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" />
                        ) : (
                          <Circle className={cn("mt-0.5 size-5 shrink-0", overdue ? "text-negative" : "text-muted")} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 font-medium">{r.name}</p>
                            <Amount className="font-semibold" value={formatMoney(r.amount, r.currencyCode)} />
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {r.intervalMonths > 1 && `${frequency?.label ?? `Cada ${r.intervalMonths} meses`} · `}
                            Día {r.dayOfMonth} · {formatDate(r.dueDate, { day: "2-digit", month: "short", ...(r.due ? {} : { year: "numeric" }) })}
                            {r.category && ` · ${r.category.name}`}
                            {r.business && ` · ${r.business.name}`}
                            {r.wallet && ` · ${r.wallet.name}`}
                          </p>
                          {(overdue || r.autoPay || !r.active) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {overdue && <Badge color="error">Vencido</Badge>}
                              {r.autoPay && (
                                <Badge>
                                  <Repeat className="size-3" /> Automático
                                </Badge>
                              )}
                              {!r.active && <Badge>Pausado</Badge>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:pl-8">
                        {r.paid && r.paidMark && !r.payment ? (
                          <>
                            <span className="text-xs text-positive">
                              Pagado el {formatDate(r.paidMark.date, { day: "2-digit", month: "short" })} (sin movimiento)
                            </span>
                            <ConfirmButton
                              action={unpayRecurring.bind(null, r.id, month)}
                              confirm="¿Volver a marcar este gasto como pendiente?"
                              variant="ghost"
                              className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs"
                            >
                              Deshacer
                            </ConfirmButton>
                          </>
                        ) : r.paid && r.payment ? (
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
                              className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs"
                            >
                              Deshacer
                            </ConfirmButton>
                          </>
                        ) : !r.due ? (
                          <span className="text-xs text-muted">
                            No toca este mes · próximo pago el {formatDate(r.dueDate)}
                          </span>
                        ) : (
                          r.active &&
                          (r.autoPay ? (
                            <span className="text-xs text-muted">
                              Se cobra solo el {formatDate(r.dueDate, { day: "2-digit", month: "short" })}
                              {r.wallet && ` de ${r.wallet.name}`}
                            </span>
                          ) : (
                            <details className="group/pay w-full sm:w-auto">
                              <summary className={buttonClass("secondary", "w-full sm:h-8 sm:w-auto sm:text-xs group-open/pay:hidden")}>
                                <Check className="size-4 sm:size-3.5" />
                                Registrar pago
                              </summary>
                            <ActionForm
                              action={payRecurring.bind(null, r.id, month)}
                              className="grid grid-cols-2 gap-2 rounded-xl bg-background p-2.5 sm:flex sm:flex-wrap sm:items-center"
                            >
                              <Select name="walletId" defaultValue={r.walletId ?? wallets[0]?.id} aria-label="Cuenta" className="col-span-2 sm:h-8 sm:w-40 sm:text-xs">
                                {wallets.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.name} ({w.currencyCode})
                                  </option>
                                ))}
                              </Select>
                              <Input name="amount" defaultValue={r.amount.toFixed(2)} inputMode="decimal" aria-label="Monto" className="sm:h-8 sm:w-24 sm:text-xs" />
                              <Select name="amountCurrency" defaultValue={r.currencyCode} aria-label="Divisa" className="sm:h-8 sm:w-24 sm:text-xs">
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
                                aria-label="Fecha de pago"
                                className="col-span-2 sm:h-8 sm:w-36 sm:text-xs"
                              />
                              <PocketPicker
                                pockets={pockets}
                                direction="out"
                                defaultValue={ownReserve?.id ?? "auto"}
                                className="col-span-2 sm:h-8 sm:w-44 sm:text-xs"
                              />
                              <Checkbox
                                name="noMovement"
                                label="Sin movimiento"
                                title="Lo marca como pagado sin registrar un gasto en la cuenta (por ejemplo, si ya lo registraste aparte)"
                                className="col-span-2"
                              />
                              <SubmitButton className="col-span-2 sm:h-8 sm:text-xs">
                                Marcar pagado
                              </SubmitButton>
                            </ActionForm>
                            </details>
                          ))
                        )}
                        <div className="-mx-2 flex flex-wrap items-center sm:mx-0 sm:ml-auto">
                          <details className="group">
                            <summary className="flex h-10 items-center rounded-lg px-3 text-sm text-muted hover:bg-background hover:text-foreground sm:h-8 sm:text-xs">
                              Editar
                            </summary>
                            <div className="absolute left-4 right-4 z-10 mt-2 rounded-xl border border-border bg-surface p-4 shadow-lg sm:left-auto sm:w-80">
                              <ActionForm action={updateRecurring.bind(null, r.id)} resetOnSuccess={false} className="flex flex-col gap-3">
                                <RecurringFields
                                  wallets={wallets}
                                  categories={categories}
                                  businesses={businesses}
                                  defaults={r}
                                />
                                <SubmitButton>Guardar</SubmitButton>
                              </ActionForm>
                            </div>
                          </details>
                          {(r.autoPay || r.walletId) && (
                            <ConfirmButton action={toggleAutoPay.bind(null, r.id)} variant="ghost" className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs">
                              {r.autoPay ? "Hacer manual" : "Hacer automático"}
                            </ConfirmButton>
                          )}
                          <ConfirmButton action={toggleRecurring.bind(null, r.id)} variant="ghost" className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs">
                            {r.active ? "Pausar" : "Activar"}
                          </ConfirmButton>
                          <ConfirmButton
                            action={deleteRecurring.bind(null, r.id)}
                            confirm="¿Eliminar este gasto fijo? Los pagos ya registrados se conservan."
                            variant="danger"
                            className="h-10 px-3 text-sm sm:h-8 sm:text-xs"
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
          <ActionForm key={currentTab.key} action={createRecurring} className="flex flex-col gap-3">
            <RecurringFields
              wallets={wallets}
              categories={categories}
              businesses={businesses}
              businessId={businessId}
            />
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
  intervalMonths: number;
  startMonth: string | null;
  walletId: string | null;
  categoryId: string | null;
  businessId: string | null;
  autoPay: boolean;
};

function RecurringFields({
  wallets,
  categories,
  businesses,
  businessId = null,
  defaults,
}: {
  wallets: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
  businesses: { id: string; name: string }[];
  /** Dueño de un gasto nuevo (null = Personal) */
  businessId?: string | null;
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frecuencia">
          <Select name="intervalMonths" defaultValue={defaults?.intervalMonths ?? 1}>
            {FREQUENCIES.map((f) => (
              <option key={f.months} value={f.months}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Día del mes">
          <Input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={defaults?.dayOfMonth ?? 1} />
        </Field>
      </div>
      <Field label="Mes del próximo pago">
        <Input
          name="startMonth"
          type="month"
          defaultValue={defaults?.startMonth ? nextDueMonth(defaults, currentMonth()) : currentMonth()}
        />
        <span className="text-xs text-muted">
          Para los trimestrales, semestrales y anuales: desde ahí se repite. Cada mes se aparta su parte (anual ÷ 12…).
        </span>
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
        <Select name="businessId" defaultValue={(defaults ? defaults.businessId : businessId) ?? ""}>
          <option value="">Personal</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox
        name="autoPay"
        defaultChecked={defaults?.autoPay}
        label="Se cobra automáticamente"
        hint="Se registra solo el día del vencimiento en la cuenta habitual, con la tasa BCV de ese día."
      />
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
