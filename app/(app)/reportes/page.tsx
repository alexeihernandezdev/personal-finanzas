import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CategoryBars, MonthlyTrendChart } from "@/components/charts";
import { MonthNav, parseMonthParam } from "@/components/month-nav";
import { Amount, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { Decimal, formatMoney } from "@/lib/money";
import { getMonthSummary } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { currentMonth, formatMonth, shiftMonth } from "@/lib/utils";

async function ReportesPageContent({ searchParams }: PageProps<"/reportes">) {
  const user = await requireUser();
  const { mes } = await searchParams;
  const month = parseMonthParam(mes, currentMonth());
  const rates = await getCurrentRates();
  const rate = pickRate(rates, user.preferredRateSource);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const summaries = await Promise.all(months.map((m) => getMonthSummary(user.id, m, rate)));
  const summary = summaries[summaries.length - 1];

  // Los reportes se calculan en USD (con la tasa de cada movimiento); para VES se usa la tasa actual.
  const cur = user.displayCurrency;
  const show = (usd: Decimal) => (cur === "VES" && rate ? usd.mul(rate) : usd);
  const fmt = (usd: Decimal, sign = false) => formatMoney(show(usd), cur, { sign });

  const trend = months.map((m, i) => ({
    month: m,
    label: formatMonth(m).slice(0, 3).toLowerCase(),
    income: show(summaries[i].income).toDecimalPlaces(2).toNumber(),
    expense: show(summaries[i].expense).toDecimalPlaces(2).toNumber(),
  }));
  const catData = (kind: string) =>
    summary.byCategory
      .filter((c) => c.kind === kind)
      .map((c) => ({ name: c.name, total: show(c.total).toDecimalPlaces(2).toNumber() }));
  const expenseCats = catData("EXPENSE");
  const incomeCats = catData("INCOME");

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Ingresos y gastos (sin transferencias ni préstamos)"
        actions={<MonthNav month={month} basePath="/reportes" />}
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Ingresos</p>
          <p className="text-2xl font-semibold tabular">{fmt(summary.income)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Gastos</p>
          <p className="text-2xl font-semibold tabular">{fmt(summary.expense)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Resultado</p>
          <p className="text-2xl font-semibold">
            <Amount value={fmt(summary.net, true)} />
          </p>
        </Card>
      </div>

      <SectionTitle>Últimos 6 meses</SectionTitle>
      <Card className="mb-6">
        <MonthlyTrendChart data={trend} currency={cur} />
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Gastos por categoría</SectionTitle>
          <Card>{expenseCats.length ? <CategoryBars data={expenseCats} currency={cur} /> : <EmptyState>Sin gastos este mes</EmptyState>}</Card>
        </div>
        <div>
          <SectionTitle>Ingresos por categoría</SectionTitle>
          <Card>{incomeCats.length ? <CategoryBars data={incomeCats} currency={cur} /> : <EmptyState>Sin ingresos este mes</EmptyState>}</Card>
        </div>
      </div>

      <SectionTitle>Por negocio</SectionTitle>
      <Card className="overflow-x-auto p-0">
        {summary.byBusiness.length === 0 ? (
          <div className="p-5">
            <EmptyState>Sin movimientos este mes</EmptyState>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Negocio</th>
                <th className="px-4 py-2 text-right font-medium">Ingresos</th>
                <th className="px-4 py-2 text-right font-medium">Gastos</th>
                <th className="px-4 py-2 text-right font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.byBusiness.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5">
                    <span className="mr-2 inline-block size-2 rounded-full" style={{ background: b.color }} />
                    {b.name}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{fmt(b.income)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{fmt(b.expense)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    <Amount value={fmt(b.net, true)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Cada movimiento se convierte a USD con la tasa del día en que se registró
        {cur === "VES" ? "; los totales en bolívares usan la tasa actual." : "."}
      </p>
    </>
  );
}

export default function ReportesPage(props: PageProps<"/reportes">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportesPageContent {...props} />
    </Suspense>
  );
}
