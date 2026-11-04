"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Button, Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { dec, Decimal, formatMoney, splitByPercent } from "@/lib/money";
import { cn } from "@/lib/utils";
import { normalizeAmount } from "@/lib/validators";

type Option = { id: string; name: string };
type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  wallets: (Option & { currencyCode: string })[];
  categories: (Option & { kind: "INCOME" | "EXPENSE" })[];
  businesses: (Option & { color: string })[];
  today: string;
  defaults?: {
    type: "INCOME" | "EXPENSE";
    walletId: string;
    amount: string;
    date: string;
    categoryId: string | null;
    description: string;
    splits: { businessId: string | null; amount: string }[];
  };
  defaultWalletId?: string;
  submitLabel?: string;
};

type Row = { businessId: string; value: string };
const PERSONAL = "";

export function TransactionForm({
  action,
  wallets,
  categories,
  businesses,
  today,
  defaults,
  defaultWalletId,
  submitLabel = "Guardar",
}: Props) {
  const initialSplits = defaults?.splits.filter((s) => s.businessId) ?? [];
  const hasRealSplits = initialSplits.length > 0;
  const [type, setType] = useState<"INCOME" | "EXPENSE">(defaults?.type ?? "EXPENSE");
  const [walletId, setWalletId] = useState(defaults?.walletId ?? defaultWalletId ?? wallets[0]?.id ?? "");
  const [amount, setAmount] = useState(defaults?.amount ?? "");
  const [splitOn, setSplitOn] = useState(hasRealSplits);
  const [mode, setMode] = useState<"percent" | "amount">(hasRealSplits ? "amount" : "percent");
  const [rows, setRows] = useState<Row[]>(
    hasRealSplits
      ? (defaults?.splits ?? []).map((s) => ({ businessId: s.businessId ?? PERSONAL, value: s.amount }))
      : [{ businessId: businesses[0]?.id ?? PERSONAL, value: "100" }],
  );

  const currency = wallets.find((w) => w.id === walletId)?.currencyCode ?? "USD";
  const total = dec(normalizeAmount(amount) ?? "0");

  const computed = useMemo(() => {
    const values = rows.map((r) => dec(normalizeAmount(r.value) ?? "0"));
    const amounts = mode === "percent" ? splitByPercent(total, values) : values;
    const sum = amounts.reduce((a, b) => a.add(b), new Decimal(0));
    const pctSum = values.reduce((a, b) => a.add(b), new Decimal(0));
    const ok = mode === "percent" ? pctSum.eq(100) : sum.toDecimalPlaces(2).eq(total.toDecimalPlaces(2));
    return { amounts, ok, diff: mode === "percent" ? new Decimal(100).sub(pctSum) : total.sub(sum) };
  }, [rows, mode, total]);

  const splitsJson =
    splitOn && total.gt(0)
      ? JSON.stringify(
          rows.map((r, i) => ({ businessId: r.businessId || null, amount: computed.amounts[i].toFixed(2) })),
        )
      : "[]";

  const filteredCategories = categories.filter((c) => c.kind === type);

  const resetAll = () => {
    if (defaults) return;
    setAmount("");
    setSplitOn(false);
  };

  return (
    <ActionForm
      action={action}
      resetOnSuccess={!defaults}
      onSuccess={resetAll}
      className="grid gap-4 sm:grid-cols-2"
    >
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="splits" value={splitsJson} />

      <div className="col-span-full grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
        {(["EXPENSE", "INCOME"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium transition",
              type === t ? "bg-surface shadow-sm" : "text-muted",
              type === t && (t === "INCOME" ? "text-positive" : "text-negative"),
            )}
          >
            {t === "INCOME" ? "Ingreso" : "Gasto"}
          </button>
        ))}
      </div>

      <Field label="Cuenta">
        <Select name="walletId" value={walletId} onChange={(e) => setWalletId(e.target.value)} required>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.currencyCode})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Monto (${currency})`}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Fecha">
        <Input name="date" type="date" required defaultValue={defaults?.date ?? today} />
      </Field>
      <Field label="Categoría">
        <Select name="categoryId" defaultValue={defaults?.categoryId ?? ""} key={type}>
          <option value="">Sin categoría</option>
          {filteredCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Descripción" className="col-span-full">
        <Input name="description" placeholder="Opcional" defaultValue={defaults?.description} maxLength={200} />
      </Field>

      <div className="col-span-full rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} />
          Asignar a negocios / dividir
        </label>
        {!splitOn && <p className="mt-1 text-xs text-muted">Si no lo marcas, el movimiento cuenta como Personal.</p>}
        {splitOn && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex gap-1 text-xs">
              {(["percent", "amount"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-md border px-2 py-1",
                    mode === m ? "border-accent text-accent" : "border-border text-muted",
                  )}
                >
                  {m === "percent" ? "Por %" : "Por monto"}
                </button>
              ))}
            </div>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={row.businessId}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, businessId: e.target.value } : r)))}
                  className="flex-1"
                >
                  <option value={PERSONAL}>Personal</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
                <Input
                  className="w-28"
                  inputMode="decimal"
                  value={row.value}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                  placeholder={mode === "percent" ? "%" : "0,00"}
                />
                <span className="w-28 text-right text-xs text-muted tabular">
                  {mode === "percent" ? formatMoney(computed.amounts[i] ?? 0, currency) : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  disabled={rows.length === 1}
                  className="rounded-md p-1.5 text-muted hover:text-negative disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setRows([...rows, { businessId: PERSONAL, value: "" }])}
              >
                <Plus className="size-3.5" /> Agregar parte
              </Button>
              {!computed.ok && total.gt(0) && (
                <span className="text-xs text-negative">
                  {mode === "percent"
                    ? `Faltan ${computed.diff.toFixed(2)}%`
                    : `Diferencia: ${formatMoney(computed.diff, currency)}`}
                </span>
              )}
            </div>
            {businesses.length === 0 && (
              <p className="text-xs text-muted">Crea tus negocios en la sección Negocios para poder asignarlos.</p>
            )}
          </div>
        )}
      </div>

      <div className="col-span-full">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
