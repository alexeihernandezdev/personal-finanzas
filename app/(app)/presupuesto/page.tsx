import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { Card, EmptyState, Field, Input, PageHeader, SectionTitle } from "@/components/ui";
import { formatPercent, SUGGESTED_BUCKETS, type BudgetOverview } from "@/lib/budget";
import { requireUser } from "@/lib/dal";
import { Decimal, formatMoney } from "@/lib/money";
import { getBudgetOverview, getPockets, getRecentIncomes } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, formatDate } from "@/lib/utils";
import { createBudgetBucket, createSuggestedBuckets, moveBudgetBucket } from "./actions";
import { DistributeIncomeButton } from "./distribute-income";
import { EditBucketButton, EditBufferButton, PocketSelect, type PocketOption } from "./edit-dialogs";

async function PresupuestoPageContent({ searchParams }: PageProps<"/presupuesto">) {
  const { repartir } = await searchParams;
  const user = await requireUser();
  const rates = await getCurrentRates();
  const rate = pickRate(rates, user.preferredRateSource);
  const [budget, pockets, incomes] = await Promise.all([
    getBudgetOverview(user.id, user.displayCurrency, rate),
    getPockets(user.id),
    getRecentIncomes(user.id),
  ]);
  const pocketOptions: PocketOption[] = pockets
    .filter((p) => !p.archived)
    .map((p) => ({ id: p.id, name: p.name, currencyCode: p.currencyCode }));
  const pocketById = new Map(pockets.filter((p) => !p.archived).map((p) => [p.id, p]));
  const cur = user.displayCurrency;
  const noIncome = budget.income.isZero();

  return (
    <>
      <PageHeader title="Presupuesto" description="Cómo se reparten tus ingresos fijos cada mes" />

      {noIncome && (
        <div className="mb-6">
          <EmptyState>
            Registra tus ingresos fijos para ver qué porcentaje se llevan tus gastos fijos y cuánto destinas a cada
            partida.{" "}
            <Link href="/ingresos-fijos" className="text-accent hover:underline">
              Agregar ingresos fijos
            </Link>
          </EmptyState>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">Ingresos fijos</p>
          <p className="mt-1 text-2xl font-semibold tabular text-positive">{formatMoney(budget.income, cur)}</p>
          <Link href="/ingresos-fijos" className="mt-1 inline-block text-xs text-accent hover:underline">
            Administrar
          </Link>
        </Card>
        <Card>
          <p className="text-sm text-muted">Gastos fijos</p>
          <p className="mt-1 text-2xl font-semibold tabular">
            {noIncome ? "—" : formatPercent(budget.fixedPercent)}
            <span className="ml-2 text-sm font-normal text-muted">de tus ingresos</span>
          </p>
          <p className="text-xs tabular text-muted">
            {formatMoney(budget.fixed, cur)} ·{" "}
            <Link href="/gastos-fijos" className="text-accent hover:underline">
              Ver gastos fijos
            </Link>
          </p>
          {budget.buffer.gt(0) && (
            <p className="text-xs tabular text-muted">
              Con colchón: {noIncome ? "—" : formatPercent(budget.fixedPercent.add(budget.bufferIncomePercent))} ·{" "}
              {formatMoney(budget.fixed.add(budget.buffer), cur)}
            </p>
          )}
        </Card>
        <Card>
          <p className="text-sm text-muted">Asignado a partidas</p>
          <p className="mt-1 text-2xl font-semibold tabular">{formatPercent(budget.assignedPercent)}</p>
          <p className="text-xs tabular text-muted">{formatMoney(budget.assigned, cur)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Libre</p>
          <p className={cn("mt-1 text-2xl font-semibold tabular", budget.overBudget && "text-negative")}>
            {noIncome ? "—" : formatPercent(budget.freePercent)}
          </p>
          <p className={cn("text-xs tabular", budget.overBudget ? "text-negative" : "text-muted")}>
            {formatMoney(budget.free, cur)}
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <SectionTitle>Distribución</SectionTitle>
          <Card>
            <DistributionBar budget={budget} />
            {budget.overBudget && !noIncome && (
              <p className="mt-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
                Tus gastos fijos{budget.buffer.gt(0) && ", el colchón"} y partidas suman{" "}
                {formatPercent(new Decimal(100).sub(budget.freePercent))} de tus ingresos: te faltan {formatMoney(budget.free.neg(), cur)} al mes.
              </p>
            )}
            <ul className="mt-4 divide-y divide-border">
              <li className="flex items-center gap-3 py-2.5 text-sm">
                <span className="size-3 shrink-0 rounded-full bg-muted" />
                <span className="flex-1 font-medium">Gastos fijos</span>
                <span className="w-16 text-right tabular text-muted">{noIncome ? "—" : formatPercent(budget.fixedPercent)}</span>
                <span className="w-28 text-right tabular">{formatMoney(budget.fixed, cur)}</span>
                <span className={rowActions} />
              </li>
              <li className="flex items-center gap-3 py-2.5 text-sm">
                <span className="size-3 shrink-0 rounded-full bg-muted/50" />
                <span className="min-w-0 flex-1 font-medium">
                  Colchón
                  <span className="block text-xs font-normal text-muted">
                    {formatPercent(budget.bufferPercent)} sobre tus gastos fijos para imprevistos
                  </span>
                </span>
                <span className="w-16 text-right tabular text-muted">
                  {noIncome ? "—" : formatPercent(budget.bufferIncomePercent)}
                </span>
                <span className="w-28 text-right tabular">{formatMoney(budget.buffer, cur)}</span>
                <span className={rowActions}>
                  <EditBufferButton percent={budget.bufferPercent.toString()} />
                </span>
              </li>
              {budget.buckets.map((b, i) => (
                <li key={b.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: b.color }} />
                  <span className="min-w-0 flex-1 font-medium">
                    <span className="block truncate">{b.name}</span>
                    {b.pocketId && pocketById.has(b.pocketId) && (
                      <span className="block truncate text-xs font-normal text-muted">
                        → {pocketById.get(b.pocketId)!.name}
                      </span>
                    )}
                  </span>
                  <span className="w-16 text-right tabular text-muted">{formatPercent(b.percent)}</span>
                  <span className="w-28 text-right tabular">{formatMoney(b.amount, cur)}</span>
                  <span className={rowActions}>
                    <MoveButton id={b.id} direction="up" disabled={i === 0} />
                    <MoveButton id={b.id} direction="down" disabled={i === budget.buckets.length - 1} />
                    <EditBucketButton
                      bucket={{ id: b.id, name: b.name, percent: b.percent.toString(), color: b.color, pocketId: b.pocketId ?? null }}
                      pockets={pocketOptions}
                    />
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-3 py-2.5 text-sm">
                <span className="size-3 shrink-0 rounded-full border border-dashed border-muted" />
                <span className="flex-1 font-medium">Libre</span>
                <span className={cn("w-16 text-right tabular", budget.overBudget ? "text-negative" : "text-muted")}>
                  {noIncome ? "—" : formatPercent(budget.freePercent)}
                </span>
                <span className={cn("w-28 text-right tabular", budget.overBudget && "text-negative")}>
                  {formatMoney(budget.free, cur)}
                </span>
                <span className={rowActions} />
              </li>
            </ul>
          </Card>
        </section>

        <div className="flex flex-col gap-6">
          {budget.buckets.length > 0 && (
            <Card className="h-fit">
              <h2 className="mb-1 font-semibold">Repartir un ingreso</h2>
              <p className="mb-4 text-xs text-muted">
                Elige un ingreso y aparta la parte de cada partida en su apartado. El dinero se queda en tus cuentas.
              </p>
              <DistributeIncomeButton
                initialIncomeId={typeof repartir === "string" ? repartir : undefined}
                incomes={incomes.map((i) => ({
                  id: i.id,
                  label: `${formatDate(i.date, { day: "2-digit", month: "short" })} · ${i.description || "Ingreso"} · ${i.wallet.name}`,
                  amount: i.amount.toString(),
                  currency: i.wallet.currencyCode,
                  distributed: i.distributed,
                }))}
                buckets={budget.buckets.map((b) => {
                  const p = b.pocketId ? pocketById.get(b.pocketId) : undefined;
                  return {
                    id: b.id,
                    name: b.name,
                    color: b.color,
                    percent: b.percent.toString(),
                    pocket: p ? { name: p.name, currency: p.currencyCode } : null,
                  };
                })}
              />
              {incomes.length === 0 && <p className="mt-2 text-xs text-muted">Aún no tienes ingresos registrados.</p>}
            </Card>
          )}
          <Card className="h-fit">
            <h2 className="mb-1 font-semibold">Nueva partida</h2>
            <p className="mb-4 text-xs text-muted">
              Un porcentaje de tus ingresos fijos para diversión, ahorro, inversión, viajes…
              {!noIncome && budget.freePercent.gt(0) && <> Te queda {formatPercent(budget.freePercent)} libre.</>}
            </p>
            <ActionForm action={createBudgetBucket} className="flex flex-col gap-3">
              <Field label="Nombre">
                <Input name="name" required placeholder="Ej. Diversión, Ahorro, Inversión…" />
              </Field>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <Field label="Porcentaje">
                  <Input name="percent" required inputMode="decimal" placeholder="10" />
                </Field>
                <Field label="Color">
                  <Input name="color" type="color" defaultValue="#6366f1" className="w-12 p-1" />
                </Field>
              </div>
              <PocketSelect pockets={pocketOptions} />
              <SubmitButton>Agregar</SubmitButton>
            </ActionForm>
          </Card>
          {budget.buckets.length === 0 && (
            <Card className="h-fit">
              <p className="mb-3 text-sm text-muted">
                ¿No sabes por dónde empezar? Prueba con{" "}
                {SUGGESTED_BUCKETS.map((b) => `${b.name} ${b.percent}%`).join(", ")} y ajústalo a tu medida.
              </p>
              <ConfirmButton action={createSuggestedBuckets} variant="secondary" className="w-full">
                Usar sugerencia
              </ConfirmButton>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Columna de acciones de cada fila (ordenar, editar); vacía en las filas fijas para alinear montos. */
const rowActions = "flex w-[5.25rem] shrink-0 items-center justify-end";

function MoveButton({ id, direction, disabled }: { id: string; direction: "up" | "down"; disabled: boolean }) {
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  const label = direction === "up" ? "Subir" : "Bajar";
  return (
    <form action={moveBudgetBucket.bind(null, id, direction)}>
      <button
        type="submit"
        disabled={disabled}
        aria-label={label}
        title={label}
        className="rounded-lg p-1.5 text-muted transition hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Icon className="size-3.5" />
      </button>
    </form>
  );
}

/** Barra apilada: gastos fijos + colchón + partidas + libre. Si se pasa del 100%, se escala al total asignado. */
function DistributionBar({ budget }: { budget: BudgetOverview }) {
  if (budget.income.isZero()) {
    return <div className="h-4 rounded-full bg-border" />;
  }
  const scale = Decimal.max(100, new Decimal(100).sub(budget.freePercent));
  const width = (p: Decimal) => `${p.div(scale).mul(100).toNumber()}%`;
  const segments = [
    { key: "fixed", label: "Gastos fijos", percent: budget.fixedPercent, className: "bg-muted" },
    { key: "buffer", label: "Colchón", percent: budget.bufferIncomePercent, className: "bg-muted/50" },
    ...budget.buckets.map((b) => ({ key: b.id, label: b.name, percent: b.percent, color: b.color })),
  ].filter((s) => s.percent.gt(0));

  return (
    <div className="flex h-4 overflow-hidden rounded-full bg-border" role="img" aria-label="Distribución de los ingresos fijos">
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

export default function PresupuestoPage(props: PageProps<"/presupuesto">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PresupuestoPageContent {...props} />
    </Suspense>
  );
}
