"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--foreground)" },
};
const nf = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 });
const nfCompact = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const dayLabel = (d: string) =>
  new Intl.DateTimeFormat("es-VE", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function RateHistoryChart({
  data,
}: {
  data: { day: string; BCV?: number; BINANCE_BUY?: number; BINANCE_SELL?: number }[];
}) {
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} {...axis} minTickGap={24} />
          <YAxis {...axis} width={56} tickFormatter={(v) => nfCompact.format(v)} domain={["auto", "auto"]} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(d) => dayLabel(String(d))}
            formatter={(v) => `Bs. ${nf.format(Number(v))}`}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
          <Line name="BCV" dataKey="BCV" stroke="var(--series-1)" strokeWidth={2} dot={false} connectNulls />
          <Line name="Binance compra" dataKey="BINANCE_BUY" stroke="var(--series-2)" strokeWidth={2} dot={false} connectNulls />
          <Line name="Binance venta" dataKey="BINANCE_SELL" stroke="var(--series-3)" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ingresos vs gastos por mes (dos series). */
export function MonthlyTrendChart({
  data,
  currency,
}: {
  data: { month: string; label: string; income: number; expense: number }[];
  currency: string;
}) {
  const symbol = currency === "VES" ? "Bs." : "$";
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={56} tickFormatter={(v) => nfCompact.format(v)} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "var(--grid)", opacity: 0.5 }}
            formatter={(v) => `${symbol} ${nf.format(Number(v))}`}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
          <Bar name="Ingresos" dataKey="income" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar name="Gastos" dataKey="expense" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras horizontales de un solo tono (magnitud por categoría). */
export function CategoryBars({ data, currency }: { data: { name: string; total: number }[]; currency: string }) {
  const symbol = currency === "VES" ? "Bs." : "$";
  return (
    <div style={{ height: Math.max(120, data.length * 34) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" {...axis} width={120} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "var(--grid)", opacity: 0.5 }}
            formatter={(v) => [`${symbol} ${nf.format(Number(v))}`, "Total"]}
          />
          <Bar
            dataKey="total"
            fill="var(--series-1)"
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
            label={{ position: "right", fill: "var(--muted)", fontSize: 12, formatter: (v: unknown) => nfCompact.format(Number(v)) }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
