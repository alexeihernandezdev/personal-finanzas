import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CheckCircle2, Circle, Repeat } from "lucide-react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { MonthNav, parseMonthParam } from "@/components/month-nav";
import { PocketPicker } from "@/components/pocket-picker";
import { CURRENCIES } from "@/components/wallet-fields";
import { Amount, Badge, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { FIXED_RESERVE, FREQUENCIES, nextDueMonth } from "@/lib/budget";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { getFixedReserve, sumInCurrency } from "@/lib/fixed-reserve";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getCategories, getPocketChoices, getRecurringForMonth, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { processAutoPayments } from "@/lib/recurring";
import { cn, currentMonth, formatDate, toISODate, todayISO } from "@/lib/utils";
import { assignFixedReserveToAll, createRecurring, deleteRecurring, updateRecurring, payRecurring, toggleAutoPay, toggleRecurring, unpayRecurring } from "./actions";

async function GastosFijosPageContent({ searchParams }: PageProps<"/gastos-fijos">) {
  const user = await requireUser();
  const { mes, negocio } = await searchParams;
  const month = parseMonthParam(mes, currentMonth());
  const isCurrentMonth = month === currentMonth();
  // Registra los cobros automáticos que ya vencieron (por si el cron aún no corrió)
  await processAutoPayments(user.id).catch(() => null);
  const [allItems, wallets, categories, businesses, rates, pockets] = await Promise.all([
    getRecurringForMonth(user.id, month),
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
    getPocketChoices(user.id),
  ]);
  const rate = pickRate(rates, user.preferredRateSource);
  // Los gastos fijos van por dueño del dinero: Personal y cada negocio
  const tabs = [{ key: "personal", name: "Personal" }, ...businesses.map((b) => ({ key: b.id, name: b.name }))];
  const currentTab = tabs.find((t) => t.key === negocio) ?? tabs[0];
  const businessId = currentTab.key === "personal" ? null : currentTab.key;
  // Primero los que vencen este mes; los trimestrales, semestrales y anuales que no, al final
  const items = allItems.filter((i) => i.businessId === businessId).sort((a, b) => Number(b.due) - Number(a.due));
  // Apartados para "Se paga de": los del dueño primero, sin las Cajas (vacío = la Caja)
  const reservePockets = pockets
    .filter((p) => !p.isMain)
    .sort((a, b) => Number(a.businessId !== businessId) - Number(b.businessId !== businessId));
  const ownReserve = reservePockets.find((p) => p.isFixedReserve && p.businessId === businessId);
  const reserve = await getFixedReserve(prisma, user.id, businessId, rate);
  const coverage = new Map(reserve.items.map((i) => [i.id, i]));
  const inDisplay = (key: "target" | "missing") =>
    sumInCurrency(reserve.pockets.map((p) => ({ amount: p[key], currencyCode: p.pocket?.currencyCode })), user.displayCurrency, rate);
  const reserveTarget = inDisplay("target");
  const reserveMissing = inDisplay("missing");
  const reserveHave = reserveTarget.sub(reserveMissing);
  const withoutPocket = items.filter((i) => i.active && !i.pocketId).length;
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
      <PageHeader
        title="Gastos fijos"
        description="Pagos que se repiten cada mes, trimestre, semestre o año"
        actions={<MonthNav month={month} basePath="/gastos-fijos" query={`negocio=${currentTab.key}`} />}
      />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Dueño de los gastos fijos">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/gastos-fijos?negocio=${t.key}&mes=${month}`}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm",
              currentTab.key === t.key ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface",
            )}
          >
            {t.name}
          </Link>
        ))}
      </nav>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Total del mes</p>
          <p className="text-2xl font-semibold tabular">{formatMoney(total, user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Pendiente por pagar</p>
          <p className="text-2xl font-semibold tabular text-negative">{formatMoney(pending, user.displayCurrency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Reservado para los próximos pagos</p>
          <p className="text-2xl font-semibold tabular">
            {formatMoney(reserveHave, user.displayCurrency)}
            <span className="ml-1 text-sm font-normal text-muted">de {formatMoney(reserveTarget, user.displayCurrency)}</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn("h-full rounded-full", reserveMissing.gt(0) ? "bg-accent" : "bg-positive")}
              style={{ width: `${reserveTarget.isZero() ? 0 : reserveHave.div(reserveTarget).mul(100).toNumber()}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            {reserveMissing.gt(0)
              ? `Faltan ${formatMoney(reserveMissing, user.displayCurrency)}: se cubren primero con lo próximo que entre a la Caja`
              : "Cubierto, colchón incluido"}
          </p>
        </Card>
      </div>
      {withoutPocket > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-background px-4 py-3 text-sm text-muted">
          <span className="flex-1">
            {withoutPocket === 1 ? "1 gasto fijo se paga" : `${withoutPocket} gastos fijos se pagan`} desde la Caja. Pásalos a un
            apartado de reserva para que su dinero no se mezcle con el libre.
          </span>
          <ConfirmButton action={assignFixedReserveToAll.bind(null, businessId)} variant="secondary" className="h-8 text-xs">
            Usar &quot;Gastos fijos&quot; para todos
          </ConfirmButton>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {items.length === 0 ? (
            <EmptyState>No tienes gastos fijos. Agrega alquiler, internet, suscripciones…</EmptyState>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-border">
                {items.map((r) => {
                  const overdue = r.active && r.due && !r.paid && toISODate(r.dueDate) < today;
                  const frequency = FREQUENCIES.find((f) => f.months === r.intervalMonths);
                  // La reserva cubre el próximo pago pendiente: solo se muestra en el mes en curso
                  const cover = r.active && !r.paid && isCurrentMonth ? coverage.get(r.id) : undefined;
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
                            {r.intervalMonths > 1 && `${frequency?.label ?? `Cada ${r.intervalMonths} meses`} · `}
                            Día {r.dayOfMonth} · {formatDate(r.dueDate, { day: "2-digit", month: "short", ...(r.due ? {} : { year: "numeric" }) })}
                            {r.category && ` · ${r.category.name}`}
                            {r.business && ` · ${r.business.name}`}
                            {r.wallet && ` · ${r.wallet.name}`}
                            {` · de ${r.pocket && !r.pocket.archived ? r.pocket.name : "la Caja"}`}
                          </p>
                        </div>
                        {overdue && <Badge className="bg-negative/10 text-negative">Vencido</Badge>}
                        {cover &&
                          (cover.missing.gt(0) ? (
                            <Badge className="bg-accent-soft text-accent">
                              Faltan {formatMoney(cover.missing, cover.pocket?.currencyCode ?? r.currencyCode)}
                            </Badge>
                          ) : (
                            <Badge className="bg-positive/10 text-positive">Cubierto</Badge>
                          ))}
                        {r.autoPay && (
                          <Badge className="gap-1">
                            <Repeat className="size-3" /> Automático
                          </Badge>
                        )}
                        {!r.active && <Badge>Pausado</Badge>}
                        <Amount className="font-medium" value={formatMoney(r.amount, r.currencyCode)} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                        {r.paid && r.paidMark && !r.payment ? (
                          <>
                            <span className="text-xs text-positive">
                              Pagado el {formatDate(r.paidMark.date, { day: "2-digit", month: "short" })} (sin movimiento)
                            </span>
                            <ConfirmButton
                              action={unpayRecurring.bind(null, r.id, month)}
                              confirm="¿Volver a marcar este gasto como pendiente?"
                              variant="ghost"
                              className="h-8 text-xs text-muted"
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
                              className="h-8 text-xs text-muted"
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
                              <PocketPicker
                                pockets={pockets}
                                direction="out"
                                defaultValue={r.pocket && !r.pocket.archived ? r.pocket.id : "auto"}
                                className="h-8 w-44 text-xs"
                              />
                              <label
                                className="flex items-center gap-1.5 text-xs text-muted"
                                title="Lo marca como pagado sin registrar un gasto en la cuenta (por ejemplo, si ya lo registraste aparte)"
                              >
                                <input type="checkbox" name="noMovement" />
                                Sin movimiento
                              </label>
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
                                <RecurringFields
                                  wallets={wallets}
                                  categories={categories}
                                  businesses={businesses}
                                  pockets={reservePockets}
                                  newPocketDefault={ownReserve?.id ?? FIXED_RESERVE}
                                  defaults={r}
                                />
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
          <ActionForm key={currentTab.key} action={createRecurring} className="flex flex-col gap-3">
            <RecurringFields
              wallets={wallets}
              categories={categories}
              businesses={businesses}
              pockets={reservePockets}
              newPocketDefault={ownReserve?.id ?? FIXED_RESERVE}
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
  pocketId: string | null;
  autoPay: boolean;
};

function RecurringFields({
  wallets,
  categories,
  businesses,
  pockets,
  newPocketDefault,
  businessId = null,
  defaults,
}: {
  wallets: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
  businesses: { id: string; name: string }[];
  /** Apartados de los que se puede pagar (sin las Cajas) */
  pockets: { id: string; name: string; currencyCode: string; ownerName: string }[];
  /** "Se paga de" para un gasto nuevo: el apartado de "Gastos fijos" del dueño o FIXED_RESERVE para crearlo */
  newPocketDefault: string;
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
          Para los trimestrales, semestrales y anuales: desde ahí se repite. Su reserva se llena poco a poco cada mes.
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
      <Field label="Se paga de">
        <Select name="pocketId" defaultValue={defaults ? (defaults.pocketId ?? "") : newPocketDefault}>
          {newPocketDefault === FIXED_RESERVE && <option value={FIXED_RESERVE}>Gastos fijos (nuevo apartado de reserva)</option>}
          {pockets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.currencyCode} ({p.ownerName})
            </option>
          ))}
          <option value="">La Caja de su dueño</option>
        </Select>
        <span className="text-xs text-muted">Al entrar dinero a la Caja, este apartado se llena primero para cubrir el próximo pago.</span>
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
