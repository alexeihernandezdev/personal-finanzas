import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { Card, EmptyState, Field, Input, PageHeader, SectionTitle } from "@/components/ui";
import { formatPercent, SUGGESTED_BUCKETS, type BudgetOverview } from "@/lib/budget";
import { requireUser } from "@/lib/dal";
import { Decimal, formatMoney } from "@/lib/money";
import { getBudgetOverview } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn } from "@/lib/utils";
import { createBudgetBucket, createSuggestedBuckets, deleteBudgetBucket, updateBudgetBucket, updateFixedBuffer } from "./actions";

async function PresupuestoPageContent() {
  const user = await requireUser();
  const rates = await getCurrentRates();
  const rate = pickRate(rates, user.preferredRateSource);
  const budget = await getBudgetOverview(user.id, user.displayCurrency, rate);
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
                <span className="w-32 text-right tabular">{formatMoney(budget.fixed, cur)}</span>
              </li>
              <li className="py-2">
                <ActionForm action={updateFixedBuffer} resetOnSuccess={false} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="size-3 shrink-0 rounded-full bg-muted/50" />
                  <span className="flex-1 font-medium">
                    Colchón
                    <span className="block text-xs font-normal text-muted">Extra sobre tus gastos fijos para imprevistos</span>
                  </span>
                  <div className="relative">
                    <Input
                      name="percent"
                      defaultValue={budget.bufferPercent.toString()}
                      inputMode="decimal"
                      title="Porcentaje sobre el total de tus gastos fijos"
                      className="h-8 w-20 pr-6 text-right tabular"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                  </div>
                  <SubmitButton variant="ghost" className="h-8 text-xs">
                    Guardar
                  </SubmitButton>
                  <span className="w-16 text-right tabular text-muted">
                    {noIncome ? "—" : formatPercent(budget.bufferIncomePercent)}
                  </span>
                  <span className="w-32 text-right tabular">{formatMoney(budget.buffer, cur)}</span>
                </ActionForm>
              </li>
              {budget.buckets.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                  <ActionForm
                    action={updateBudgetBucket.bind(null, b.id)}
                    resetOnSuccess={false}
                    className="flex flex-1 flex-wrap items-center gap-2"
                  >
                    <Input name="color" type="color" defaultValue={b.color} className="h-8 w-9 shrink-0 p-1" />
                    <Input name="name" defaultValue={b.name} required className="h-8 min-w-28 flex-1" />
                    <div className="relative">
                      <Input
                        name="percent"
                        defaultValue={b.percent.toString()}
                        inputMode="decimal"
                        required
                        className="h-8 w-20 pr-6 text-right tabular"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                    </div>
                    <span className="w-32 text-right text-sm tabular">{formatMoney(b.amount, cur)}</span>
                    <SubmitButton variant="ghost" className="h-8 text-xs">
                      Guardar
                    </SubmitButton>
                  </ActionForm>
                  <ConfirmButton
                    action={deleteBudgetBucket.bind(null, b.id)}
                    confirm={`¿Eliminar la partida "${b.name}"?`}
                    variant="ghost"
                    className="h-8 text-xs"
                  >
                    Eliminar
                  </ConfirmButton>
                </li>
              ))}
              <li className="flex items-center gap-3 py-2.5 text-sm">
                <span className="size-3 shrink-0 rounded-full border border-dashed border-muted" />
                <span className="flex-1 font-medium">Libre</span>
                <span className={cn("w-16 text-right tabular", budget.overBudget ? "text-negative" : "text-muted")}>
                  {noIncome ? "—" : formatPercent(budget.freePercent)}
                </span>
                <span className={cn("w-32 text-right tabular", budget.overBudget && "text-negative")}>
                  {formatMoney(budget.free, cur)}
                </span>
              </li>
            </ul>
          </Card>
        </section>

        <div className="flex flex-col gap-6">
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

export default function PresupuestoPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PresupuestoPageContent />
    </Suspense>
  );
}
