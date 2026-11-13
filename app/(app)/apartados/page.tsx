import { Suspense } from "react";
import Link from "next/link";
import { PageSkeleton } from "@/components/page-skeleton";
import { ChevronDown, ChevronRight, Info, Star, X } from "lucide-react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { PocketFields, pocketKindLabel } from "@/components/pocket-fields";
import { PocketTransferForm, type TransferDestination } from "@/components/pocket-transfer-form";
import { Amount, Badge, Card, EmptyState, Field, Input, OwnerTabs, PageHeader, SectionTitle, Select, StatCard } from "@/components/ui";
import { formatPercent, SUGGESTED_POCKETS, type BudgetOverview } from "@/lib/budget";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { currentFallbackRate, getBudgetOverview, getBusinesses, getMoneySummary, getOwnerPayMonths, getPockets, type PocketWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, currentMonth, formatDate, formatMonth, shiftMonth, toISODate, todayISO } from "@/lib/utils";
import {
  createMainPocket,
  createPocket,
  createSuggestedPockets,
  deletePocket,
  deletePocketMovement,
  movePocketMoney,
  payOwner,
  toggleArchivePocket,
  togglePinPocket,
  transferPocketMoney,
  undoOwnerPay,
  updatePocket,
} from "./actions";
import { EditBufferButton, EditOwnerPayButton } from "./plan-dialogs";

type BusinessOption = { id: string; name: string };

async function ApartadosPageContent({ searchParams }: PageProps<"/apartados">) {
  const { negocio } = await searchParams;
  const user = await requireUser();
  const rate = pickRate(await getCurrentRates(), user.preferredRateSource);
  const cur = user.displayCurrency;
  const [summary, pockets, businesses] = await Promise.all([
    getMoneySummary(user.id, cur, rate),
    getPockets(user.id),
    getBusinesses(user.id),
  ]);
  const { total, reserved, available } = summary;

  const businessOptions: BusinessOption[] = businesses.map((b) => ({ id: b.id, name: b.name }));

  // Una pestaña por dueño del dinero: Personal primero y luego cada negocio (también los
  // archivados que todavía tengan apartados)
  const tabs = [{ key: "personal", name: "Personal" }, ...businessOptions.map((b) => ({ key: b.id, name: b.name }))];
  for (const p of pockets) {
    if (p.business && !tabs.some((t) => t.key === p.business!.id)) tabs.push({ key: p.business.id, name: p.business.name });
  }
  const currentTab = tabs.find((t) => t.key === negocio) ?? tabs[0];
  const tabBusinessId = currentTab.key === "personal" ? null : currentTab.key;
  const business = businesses.find((b) => b.id === tabBusinessId);
  const budget = await getBudgetOverview(user.id, cur, rate, tabBusinessId);
  // Sueldo del negocio: el mes pasado (para cerrarlo) y el actual
  const payMonths =
    business && business.ownerPayMode !== "NONE"
      ? await getOwnerPayMonths(user.id, business, [shiftMonth(currentMonth(), -1), currentMonth()], cur, rate ?? (await currentFallbackRate()))
      : [];

  const tabPockets = (key: string) => pockets.filter((p) => (p.businessId ?? "personal") === key);
  const reservedIn = (key: string) =>
    tabPockets(key).reduce((acc, p) => {
      try {
        return acc.add(convert(p.balance, p.currencyCode, cur, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));

  const inTab = tabPockets(currentTab.key);
  // Primero la Caja, luego Gastos fijos, los que tienen % y el resto
  const rank = (p: PocketWithBalance) => (p.isMain ? 0 : p.isFixedReserve ? 1 : p.percent?.gt(0) ? 2 : 3);
  const active = inTab.filter((p) => !p.archived).sort((a, b) => rank(a) - rank(b));
  const archived = inTab.filter((p) => p.archived);
  const hasCaja = inTab.some((p) => p.isMain);
  const hasPercentPockets = active.some((p) => p.percent?.gt(0));
  const fixedShare = budget.income.isZero() ? null : budget.fixedPercent.add(budget.bufferIncomePercent);
  const destinations: TransferDestination[] = [
    ...pockets.filter((p) => !p.archived && !p.businessId),
    ...pockets.filter((p) => !p.archived && p.businessId),
  ].map((p) => ({
    id: p.id,
    name: p.name,
    currencyCode: p.currencyCode,
    ownerName: p.business?.name ?? "Personal",
    isMain: p.isMain,
  }));

  return (
    <>
      <PageHeader title="Apartados" description="Cómo se reparte tu dinero: gastos fijos, ocio, ahorro, inversión…" />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="En cuentas" value={formatMoney(total, cur)} />
        <StatCard label="Apartado" value={formatMoney(reserved, cur)} />
        <StatCard
          label="Disponible para usar"
          value={<Amount value={formatMoney(available, cur)} />}
          className="col-span-2 sm:col-span-1"
        />
      </div>
      {available.isNegative() && (
        <p role="alert" className="mb-6 rounded-lg bg-negative/10 px-4 py-3 text-sm text-negative">
          Gastaste dinero apartado. Libera parte de un apartado o repón el saldo de tus cuentas.
        </p>
      )}
      <OwnerTabs
        tabs={tabs.map((t) => ({ ...t, extra: formatMoney(reservedIn(t.key), cur) }))}
        current={currentTab.key}
        href={(key) => `/apartados?negocio=${key}`}
        label="Dueño del dinero"
      />
      <PlanCard
        budget={budget}
        currency={cur}
        ownerName={currentTab.name}
        isBusiness={Boolean(business)}
        bufferPercent={budget.bufferPercent.toString()}
      />
      {business && (
        <OwnerPayCard
          business={{
            id: business.id,
            name: business.name,
            mode: business.ownerPayMode,
            percent: business.ownerPayPercent?.toString() ?? "",
            amount: business.ownerPayAmount?.toFixed(2) ?? "",
            currency: business.ownerPayCurrency ?? cur,
          }}
          months={payMonths}
          currency={cur}
        />
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {!hasCaja && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4 text-sm">
              <p className="text-muted">
                La <span className="font-medium text-foreground">Caja {currentTab.name}</span> recibe los ingresos de{" "}
                {tabBusinessId ? "este negocio" : "lo personal"} y los reparte entre sus apartados. Se crea sola con el
                primer ingreso.
              </p>
              <ConfirmButton action={createMainPocket.bind(null, tabBusinessId)} variant="secondary" className="h-10 px-3 text-sm sm:h-8 sm:text-xs">
                Crear Caja ahora
              </ConfirmButton>
            </div>
          )}
          {active.length === 0 ? (
            <EmptyState>
              {currentTab.key === "personal"
                ? "Todavía no tienes apartados personales."
                : `Todavía no tienes apartados para ${currentTab.name}.`}{" "}
              Crea uno para separar dinero sin moverlo de tus cuentas.
            </EmptyState>
          ) : (
            <section>
              <SectionTitle>{currentTab.name}</SectionTitle>
              <div className="flex flex-col gap-3">
                {active.map((p) => (
                  <PocketCard
                    key={p.id}
                    pocket={p}
                    fixedShare={fixedShare}
                    businesses={businessOptions}
                    destinations={destinations.filter((d) => d.id !== p.id)}
                  />
                ))}
              </div>
            </section>
          )}
          {archived.length > 0 && (
            <section>
              <SectionTitle>Archivados</SectionTitle>
              <div className="flex flex-col gap-3 opacity-70">
                {archived.map((p) => (
                  <PocketCard key={p.id} pocket={p} fixedShare={fixedShare} businesses={businessOptions} destinations={[]} />
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card className="h-fit">
            <h2 className="mb-1 font-semibold">Nuevo apartado</h2>
            <p className="mb-4 text-xs text-muted">
              Con un % se llena solo cada vez que entra dinero a la Caja. Sin %, lo llenas a mano.
              {!budget.income.isZero() && budget.freePercent.gt(0) && <> Te queda {formatPercent(budget.freePercent)} libre.</>}
            </p>
            <ActionForm key={currentTab.key} action={createPocket} className="flex flex-col gap-3">
              <PocketFields
                businesses={businessOptions}
                defaultBusinessId={currentTab.key === "personal" ? "" : currentTab.key}
              />
              <Field label="Apartar ahora" hint="Opcional: sale de lo disponible para usar">
                <Input name="initialAmount" inputMode="decimal" placeholder="0,00" />
              </Field>
              <SubmitButton>Crear apartado</SubmitButton>
            </ActionForm>
          </Card>
          {!hasPercentPockets && (
            <Card className="h-fit">
              <p className="mb-3 text-sm text-muted">
                ¿No sabes por dónde empezar? Prueba con{" "}
                {SUGGESTED_POCKETS.map((b) => `${b.name} ${b.percent}%`).join(", ")} y ajústalo a tu medida.
              </p>
              <ConfirmButton action={createSuggestedPockets.bind(null, tabBusinessId)} variant="secondary" className="w-full">
                Usar sugerencia
              </ConfirmButton>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Plan del mes del dueño: qué % de su ingreso fijo se llevan los gastos fijos (con tu sueldo fijo si
 * es un negocio) y cada apartado, y cuánto queda libre en la Caja.
 */
function PlanCard({
  budget,
  currency: cur,
  ownerName,
  isBusiness,
  bufferPercent,
}: {
  budget: Awaited<ReturnType<typeof getBudgetOverview>>;
  currency: string;
  ownerName: string;
  isBusiness: boolean;
  bufferPercent: string;
}) {
  const noIncome = budget.income.isZero();
  const pct = (value: Decimal) => (noIncome ? "—" : formatPercent(value));

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Plan del mes · {ownerName}</h2>
        <p className="text-sm text-muted">
          Ingreso fijo <span className="font-medium text-positive tabular">{formatMoney(budget.income, cur)}</span> ·{" "}
          <Link href="/ingresos-fijos" className="text-accent hover:underline">
            Administrar
          </Link>
        </p>
      </div>
      {budget.salaries.length > 0 && (
        <p className="-mt-2 mb-3 text-xs text-muted">
          Incluye tu sueldo fijo de {budget.salaries.map((s) => `${s.name} (${formatMoney(s.amount, cur)})`).join(", ")}
        </p>
      )}
      <DistributionBar budget={budget} />
      {budget.overBudget && !noIncome && (
        <p className="mt-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          Tus gastos fijos{budget.buffer.gt(0) && ", el colchón"} y apartados suman{" "}
          {formatPercent(new Decimal(100).sub(budget.freePercent))} de tu ingreso fijo: te faltan{" "}
          {formatMoney(budget.free.neg(), cur)} al mes. Al repartir, los apartados se reducen en proporción.
        </p>
      )}
      <ul className="mt-3 divide-y divide-border">
        <PlanRow
          dot="bg-muted"
          name="Gastos fijos"
          detail={
            <Link href="/gastos-fijos" className="hover:underline">
              {noIncome ? "Sin ingreso fijo: se aparta lo que falta del mes" : "Su % real de tu ingreso fijo"}
              {budget.ownerSalary.gt(0) && ` · incluye tu sueldo de ${formatMoney(budget.ownerSalary, cur)}`}
            </Link>
          }
          percent={pct(budget.fixedPercent)}
          amount={formatMoney(budget.fixed, cur)}
        />
        <PlanRow
          dot="bg-muted/50"
          name="Colchón"
          detail={`${formatPercent(budget.bufferPercent)} sobre tus gastos fijos para imprevistos`}
          percent={pct(budget.bufferIncomePercent)}
          amount={formatMoney(budget.buffer, cur)}
          action={<EditBufferButton percent={bufferPercent} />}
        />
        {budget.pockets.map((p) => (
          <PlanRow key={p.id} color={p.color} name={p.name} percent={formatPercent(p.percent)} amount={formatMoney(p.amount, cur)} />
        ))}
        <PlanRow
          dot="border border-dashed border-muted"
          name="Libre"
          detail="Se queda en la Caja"
          percent={pct(budget.freePercent)}
          amount={formatMoney(budget.free, cur)}
          negative={budget.overBudget}
        />
      </ul>
      <details className="group mt-3 text-sm">
        <summary className="flex min-h-10 items-center gap-2 text-muted hover:text-foreground">
          <Info className="size-4 text-accent" />
          ¿Cómo se reparte el dinero?
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <p className="mt-1 text-pretty text-muted">
          Cada ingreso de {ownerName} entra a su Caja y se reparte al momento: Gastos fijos se lleva el % que tus gastos
          fijos (con el colchón) son de tu ingreso fijo; si no tienes ingreso fijo, lo que le falta para cubrir el mes. Cada
          apartado se lleva su %. Lo que sobra se queda libre en la Caja. Los
          gastos fijos anuales o trimestrales cuentan su parte de cada mes.
          {isBusiness && " Tu sueldo fijo cuenta como un gasto fijo más del negocio."}
        </p>
      </details>
    </Card>
  );
}

/**
 * Tu sueldo de un negocio: cómo te pagas (monto fijo o % de la ganancia) y, por mes, cuánto te toca y
 * si ya te lo pagaste. Pagarlo pasa el dinero de los apartados del negocio a tu Caja Personal.
 */
function OwnerPayCard({
  business,
  months,
  currency: cur,
}: {
  business: { id: string; name: string; mode: string; percent: string; amount: string; currency: string };
  months: Awaited<ReturnType<typeof getOwnerPayMonths>>;
  currency: string;
}) {
  const summary =
    business.mode === "FIXED"
      ? `${formatMoney(business.amount, business.currency)} al mes · se reserva en Gastos fijos con cada venta`
      : business.mode === "PROFIT_PERCENT"
        ? `${formatPercent(business.percent)} de la ganancia del mes (ingresos − gastos)`
        : "Sin sueldo: el dinero se queda en el negocio";

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">Tu sueldo</h2>
          <p className="text-sm text-muted">{summary}</p>
        </div>
        <EditOwnerPayButton
          businessId={business.id}
          mode={business.mode}
          percent={business.percent}
          amount={business.amount}
          currency={business.currency}
        />
      </div>
      {months.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {months.map((m) => (
            <li key={m.month} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium capitalize">{formatMonth(m.month)}</p>
                <p className="text-xs text-muted">
                  Ganancia {formatMoney(m.profit, cur)} ({formatMoney(m.income, cur)} − {formatMoney(m.expense, cur)})
                  {m.month === currentMonth() && " · hasta hoy"}
                </p>
              </div>
              {m.payment ? (
                <div className="flex items-center gap-2">
                  <Badge color="success">Pagado {formatMoney(m.payment.amount, m.payment.currencyCode)}</Badge>
                  <ConfirmButton
                    action={undoOwnerPay.bind(null, m.payment.id)}
                    confirm="¿Deshacer este pago? El dinero vuelve a los apartados del negocio."
                    variant="ghost"
                    className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs"
                  >
                    Deshacer
                  </ConfirmButton>
                </div>
              ) : (
                <ActionForm action={payOwner.bind(null, business.id)} className="flex items-center gap-2">
                  <input type="hidden" name="month" value={m.month} />
                  <div className="relative">
                    <Input
                      name="amount"
                      defaultValue={m.due.gt(0) ? m.due.toFixed(2) : ""}
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label={`Sueldo de ${formatMonth(m.month)}`}
                      className="w-32 pr-11 text-right tabular sm:h-8 sm:text-xs"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{cur}</span>
                  </div>
                  <SubmitButton className="sm:h-8 sm:text-xs">Pagarme</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlanRow({
  dot,
  color,
  name,
  detail,
  percent,
  amount,
  action,
  negative,
}: {
  dot?: string;
  color?: string;
  name: string;
  detail?: React.ReactNode;
  percent: string;
  amount: string;
  action?: React.ReactNode;
  negative?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <span className={cn("size-3 shrink-0 rounded-full", dot)} style={color ? { background: color } : undefined} />
      <span className="min-w-0 flex-1 font-medium">
        <span className="block truncate">{name}</span>
        {detail && <span className="block truncate text-xs font-normal text-muted">{detail}</span>}
      </span>
      <span className={cn("w-12 shrink-0 text-right tabular sm:w-16", negative ? "text-negative" : "text-muted")}>{percent}</span>
      <span className={cn("shrink-0 text-right tabular sm:w-28", negative && "text-negative")}>{amount}</span>
      <span className="-mr-2 flex w-10 shrink-0 justify-end sm:mr-0">{action}</span>
    </li>
  );
}

/** Barra apilada: gastos fijos + colchón + apartados + libre. Si se pasa del 100%, se escala al total asignado. */
function DistributionBar({ budget }: { budget: BudgetOverview }) {
  if (budget.income.isZero()) {
    return <div className="h-4 rounded-full bg-border" />;
  }
  const scale = Decimal.max(100, new Decimal(100).sub(budget.freePercent));
  const width = (p: Decimal) => `${p.div(scale).mul(100).toNumber()}%`;
  const segments = [
    { key: "fixed", label: "Gastos fijos", percent: budget.fixedPercent, className: "bg-muted" },
    { key: "buffer", label: "Colchón", percent: budget.bufferIncomePercent, className: "bg-muted/50" },
    ...budget.pockets.map((b) => ({ key: b.id, label: b.name, percent: b.percent, color: b.color })),
  ].filter((s) => s.percent.gt(0));

  return (
    <div className="flex h-4 overflow-hidden rounded-full bg-border" role="img" aria-label="Reparto del ingreso fijo">
      {segments.map((s) => (
        <div
          key={s.key}
          title={`${s.label}: ${formatPercent(s.percent)}`}
          className={cn("h-full border-r-2 border-surface last:border-r-0", "className" in s && s.className)}
          style={{ width: width(s.percent), ...("color" in s ? { background: s.color } : {}) }}
        />
      ))}
    </div>
  );
}

function PocketCard({
  pocket: p,
  fixedShare,
  businesses,
  destinations,
}: {
  pocket: PocketWithBalance;
  /** % del ingreso fijo que se lleva Gastos fijos (con colchón); null sin ingreso fijo */
  fixedShare: Decimal | null;
  businesses: BusinessOption[];
  destinations: TransferDestination[];
}) {
  const currency = p.currencyCode;
  const target = p.targetAmount ? new Decimal(p.targetAmount.toString()) : null;
  const pct = target && target.gt(0) ? Math.min(100, p.balance.div(target).mul(100).toNumber()) : null;
  const today = todayISO();
  const rule = p.isMain
    ? "Recibe los ingresos y se queda lo que sobra"
    : p.isFixedReserve
      ? fixedShare
        ? `Se lleva el ${formatPercent(fixedShare)} de cada ingreso para tus gastos fijos`
        : "Se lleva lo que falta para los gastos fijos del mes"
      : p.percent?.gt(0)
        ? `Se lleva el ${formatPercent(p.percent)} de cada ingreso`
        : pocketKindLabel(p.kind);

  return (
    <Card className="relative overflow-hidden">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: p.color }} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            {p.name}
            {p.isMain && <Badge color="brand">Caja</Badge>}
            {p.isFixedReserve && <Badge>Gastos fijos</Badge>}
            {!p.isMain && !p.isFixedReserve && p.percent?.gt(0) && <Badge color="brand">{formatPercent(p.percent)}</Badge>}
          </p>
          <p className="text-xs text-muted">
            {rule} · {currency}
            {p.targetDate && ` · para el ${formatDate(p.targetDate)}`}
          </p>
        </div>
        <div className="flex items-start gap-1">
          <div className="text-right">
            <p className="text-xl font-semibold">
              <Amount value={formatMoney(p.balance, currency)} />
            </p>
            {target && <p className="text-xs text-muted">de {formatMoney(target, currency)}</p>}
          </div>
          {!p.archived && (
            <ConfirmButton
              action={togglePinPocket.bind(null, p.id)}
              variant="ghost"
              className={cn("-mt-1 -mr-2 size-10 px-0 sm:size-8", p.pinned ? "text-amber-500" : "text-muted")}
            >
              <Star
                className={cn("size-4", p.pinned && "fill-current")}
                aria-label={p.pinned ? "Quitar del inicio" : "Fijar en el inicio"}
              />
            </ConfirmButton>
          )}
        </div>
      </div>
      {pct !== null && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
            <div className="h-full" style={{ width: `${pct}%`, background: p.color }} />
          </div>
          <span className="text-xs tabular text-muted">{pct.toFixed(0)}%</span>
          {pct >= 100 && <Badge color="success">¡Meta cumplida!</Badge>}
        </div>
      )}

      {!p.archived && (
        <ActionForm action={movePocketMoney} className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 sm:flex sm:flex-wrap sm:items-center">
          <input type="hidden" name="pocketId" value={p.id} />
          <Select name="direction" className="sm:h-8 sm:w-28 sm:text-xs" defaultValue="IN">
            <option value="IN">Apartar</option>
            <option value="OUT">Liberar</option>
          </Select>
          <Input name="amount" inputMode="decimal" placeholder="Monto" required className="sm:h-8 sm:w-28 sm:text-xs" />
          <Input name="date" type="date" defaultValue={today} className="sm:h-8 sm:w-36 sm:text-xs" />
          <Input name="description" placeholder="Nota (opcional)" maxLength={200} className="sm:h-8 sm:min-w-32 sm:flex-1 sm:text-xs" />
          <SubmitButton className="col-span-2 sm:h-8 sm:text-xs">
            Guardar
          </SubmitButton>
        </ActionForm>
      )}

      {!p.archived && destinations.length > 0 && p.balance.gt(0) && (
        <details className="group mt-2 text-xs">
          <summary className="-mx-1 flex min-h-10 items-center gap-1 rounded-lg px-1 text-sm text-muted hover:text-foreground sm:min-h-8 sm:text-xs"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />Pasar a otro apartado</summary>
          <div className="mt-3 text-sm">
            <PocketTransferForm
              action={transferPocketMoney}
              pocket={{ id: p.id, currencyCode: currency, balance: p.balance.toString() }}
              entries={p.movements
                .filter((m) => m.amount.gt(0))
                .map((m) => ({
                  id: m.id,
                  label: `${formatDate(m.date, { day: "2-digit", month: "short" })} · ${m.description || "Entrada"}`,
                  amount: m.amount.toString(),
                }))}
              destinations={destinations}
              today={today}
            />
          </div>
        </details>
      )}

      {p.movements.length > 0 && (
        <details className="group mt-2 text-xs">
          <summary className="-mx-1 flex min-h-10 items-center gap-1 rounded-lg px-1 text-sm text-muted hover:text-foreground sm:min-h-8 sm:text-xs"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />Últimos movimientos</summary>
          <ul className="mt-2 divide-y divide-border">
            {p.movements.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-1.5">
                <span className="w-20 shrink-0 text-muted sm:w-24">{formatDate(m.date)}</span>
                <span className="flex-1 truncate">{m.description || (m.amount.isNegative() ? "Liberado" : "Apartado")}</span>
                <Amount value={formatMoney(m.amount.toString(), currency, { sign: true })} />
                <ConfirmButton
                  action={deletePocketMovement.bind(null, m.id)}
                  confirm={
                    m.groupId
                      ? "Se eliminará la operación completa (el traspaso o reparto en todos sus apartados). ¿Continuar?"
                      : "¿Eliminar este movimiento del apartado?"
                  }
                  variant="ghost"
                  className="size-9 px-0 text-muted"
                >
                  <X className="size-3.5" aria-label="Eliminar" />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="group mt-1 text-xs">
        <summary className="-mx-1 flex min-h-10 items-center gap-1 rounded-lg px-1 text-sm text-muted hover:text-foreground sm:min-h-8 sm:text-xs"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />Editar</summary>
        <div className="mt-3 flex flex-col gap-3">
          <ActionForm action={updatePocket.bind(null, p.id)} resetOnSuccess={false} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PocketFields
              businesses={businesses}
              currencyLocked={!p.balance.isZero()}
              ownerLocked={p.isMain || p.isFixedReserve}
              percentHint={p.isMain || p.isFixedReserve ? rule : undefined}
              defaults={{
                name: p.name,
                kind: p.kind,
                currencyCode: currency,
                businessId: p.businessId ?? "",
                targetAmount: target ? target.toFixed(2) : "",
                targetDate: p.targetDate ? toISODate(p.targetDate) : "",
                color: p.color,
                percent: p.percent?.toString() ?? "",
              }}
            />
            <SubmitButton className="sm:col-span-2">Guardar cambios</SubmitButton>
          </ActionForm>
          <div className="flex flex-wrap gap-2">
            {!p.isMain && (p.archived || p.balance.isZero()) && (
              <ConfirmButton action={toggleArchivePocket.bind(null, p.id)} variant="secondary" className="h-10 px-3 text-sm sm:h-8 sm:text-xs">
                {p.archived ? "Restaurar" : "Archivar"}
              </ConfirmButton>
            )}
            {(!p.isMain || p.balance.isZero()) && (
              <ConfirmButton
                action={deletePocket.bind(null, p.id)}
                confirm="¿Eliminar el apartado? Su dinero vuelve a estar disponible."
                className="h-10 px-3 text-sm sm:h-8 sm:text-xs"
              >
                Eliminar apartado
              </ConfirmButton>
            )}
          </div>
        </div>
      </details>
    </Card>
  );
}

export default function ApartadosPage(props: PageProps<"/apartados">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApartadosPageContent {...props} />
    </Suspense>
  );
}
