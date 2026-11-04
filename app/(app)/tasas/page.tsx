import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RateHistoryChart } from "@/components/charts";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { formatMoney } from "@/lib/money";
import { getCurrentRates, getRateHistory } from "@/lib/rates";
import { refreshRatesAction } from "./actions";

async function TasasPageContent() {
  await requireUser();
  const [rates, history] = await Promise.all([
    getCurrentRates({ refreshIfStale: true }),
    getRateHistory(60),
  ]);

  // Último valor por día y fuente
  const byDay = new Map<string, { day: string; BCV?: number; BINANCE_BUY?: number; BINANCE_SELL?: number }>();
  for (const r of history) {
    const day = r.fetchedAt.toISOString().slice(0, 10);
    const row = byDay.get(day) ?? { day };
    row[r.kind] = Number(r.rate);
    byDay.set(day, row);
  }
  const chartData = [...byDay.values()];
  const gap = rates.bcv && rates.binance ? rates.binance.div(rates.bcv).sub(1).mul(100) : null;

  const cards = [
    { label: "BCV (oficial)", value: rates.bcv },
    { label: "Binance P2P · compra", value: rates.binanceBuy },
    { label: "Binance P2P · venta", value: rates.binanceSell },
  ];

  return (
    <>
      <PageHeader
        title="Tasas"
        description={
          rates.updatedAt
            ? `Última actualización: ${rates.updatedAt.toLocaleString("es-VE", { timeZone: "America/Caracas" })}`
            : "Aún no hay tasas guardadas"
        }
        actions={
          <ActionForm action={refreshRatesAction} resetOnSuccess={false} className="flex flex-col items-end gap-2">
            <SubmitButton variant="secondary">Actualizar ahora</SubmitButton>
          </ActionForm>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <p className="text-sm text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular">{c.value ? formatMoney(c.value, "VES") : "—"}</p>
            <p className="text-xs text-muted">por 1 USD{c.label.startsWith("Binance") ? "T" : ""}</p>
          </Card>
        ))}
      </div>
      {gap && (
        <p className="mb-6 text-sm text-muted">
          Brecha Binance vs BCV: <strong className="text-foreground">{gap.toFixed(1)}%</strong>
        </p>
      )}
      <SectionTitle>Histórico (últimos 60 días)</SectionTitle>
      <Card>
        {chartData.length > 1 ? (
          <RateHistoryChart data={chartData} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">El histórico se irá llenando con las actualizaciones diarias.</p>
        )}
      </Card>
      <p className="mt-4 text-xs text-muted">
        BCV vía dolarapi.com (respaldo: bcv.org.ve). Binance: mediana de los 10 primeros anuncios P2P USDT/VES. La tasa
        se guarda en cada movimiento para que tus reportes en USD no cambien después.
      </p>
    </>
  );
}

export default function TasasPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TasasPageContent />
    </Suspense>
  );
}
