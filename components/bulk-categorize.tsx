"use client";

import { useState, useTransition } from "react";
import { bulkCategorize } from "@/app/(app)/movimientos/actions";
import { Amount, Button, Card, Checkbox, EmptyState, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

export type UncategorizedRow = {
  id: string;
  type: "INCOME" | "EXPENSE";
  date: string;
  description: string;
  wallet: string;
  amount: string;
};

type Category = { id: string; name: string; kind: "INCOME" | "EXPENSE" };

/** Ingresos y gastos sin categoría: se eligen varios y se les pone una categoría de una vez. */
export function BulkCategorize({ rows, categories }: { rows: UncategorizedRow[]; categories: Category[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">(rows.some((r) => r.type === "EXPENSE") || !rows.length ? "EXPENSE" : "INCOME");
  const [categoryId, setCategoryId] = useState("");
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const visible = rows.filter((r) => r.type === kind);
  const options = categories.filter((c) => c.kind === kind);
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const apply = () =>
    startTransition(async () => {
      const ids = visible.filter((r) => selected.has(r.id)).map((r) => r.id);
      const result = await bulkCategorize(ids, categoryId);
      setState(result);
      if (result?.ok) setSelected(new Set());
    });

  if (!rows.length) return <EmptyState>No hay ingresos ni gastos sin categoría.</EmptyState>;

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1">
        {(["EXPENSE", "INCOME"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setKind(t);
              setCategoryId("");
            }}
            className={cn(
              "min-h-10 rounded-lg py-2 text-sm font-medium transition sm:min-h-0 sm:py-1.5",
              kind === t ? "bg-surface shadow-sm" : "text-muted",
              kind === t && (t === "INCOME" ? "text-positive" : "text-negative"),
            )}
          >
            {t === "INCOME" ? "Ingresos" : "Gastos"} ({rows.filter((r) => r.type === t).length})
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Checkbox
          label="Todos"
          checked={allSelected}
          onCheckedChange={(on) => setSelected(on ? new Set(visible.map((r) => r.id)) : new Set())}
        />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoría" className="sm:ml-auto sm:w-64">
          <option value="">Elige una categoría</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="button" onClick={apply} isLoading={pending} disabled={!categoryId || !visible.some((r) => selected.has(r.id))}>
          Categorizar {visible.filter((r) => selected.has(r.id)).length || ""}
        </Button>
      </div>
      {state?.error && <p className="rounded-lg bg-error-primary px-3 py-2 text-sm text-error-primary">{state.error}</p>}
      {state?.ok && state.message && <p className="rounded-lg bg-success-primary px-3 py-2 text-sm text-success-primary">{state.message}</p>}

      <ul className="divide-y divide-border">
        {visible.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <Checkbox label="" checked={selected.has(r.id)} onCheckedChange={(on) => toggle(r.id, on)} title="Elegir" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.description || "Sin descripción"}</p>
              <p className="text-xs text-muted">
                {r.date} · {r.wallet}
              </p>
            </div>
            <Amount value={r.amount} className="text-sm font-medium" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
