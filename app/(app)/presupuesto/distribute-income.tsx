"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Button, Field, Input, Select } from "@/components/ui";
import { Decimal, formatMoney } from "@/lib/money";
import { distributeIncome } from "./actions";

export type IncomeOption = {
  id: string;
  label: string;
  amount: string;
  currency: string;
  distributed: boolean;
};

export type DistributableBucket = {
  id: string;
  name: string;
  color: string;
  percent: string;
  pocket: { name: string; currency: string } | null;
};

/** Botón + modal para repartir un ingreso entre los apartados de cada partida según su porcentaje. */
export function DistributeIncomeButton({
  incomes,
  buckets,
  initialIncomeId,
}: {
  incomes: IncomeOption[];
  buckets: DistributableBucket[];
  initialIncomeId?: string;
}) {
  const initial = incomes.find((i) => i.id === initialIncomeId);
  const [open, setOpen] = useState(Boolean(initial));
  const [incomeId, setIncomeId] = useState(initial?.id ?? incomes.find((i) => !i.distributed)?.id ?? incomes[0]?.id ?? "");
  const income = incomes.find((i) => i.id === incomeId);
  const linked = buckets.filter((b) => b.pocket);
  const unlinked = buckets.filter((b) => !b.pocket);
  const close = () => setOpen(false);

  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)} disabled={!incomes.length}>
        Repartir un ingreso
      </Button>
      <Modal open={open} onClose={close} title="Repartir un ingreso">
        <ActionForm action={distributeIncome} onSuccess={close} className="flex flex-col gap-4">
          <Field label="Ingreso">
            <Select name="incomeId" value={incomeId} onChange={(e) => setIncomeId(e.target.value)} required>
              {incomes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label} · {formatMoney(i.amount, i.currency)}
                  {i.distributed ? " · ya repartido" : ""}
                </option>
              ))}
            </Select>
          </Field>

          {income?.distributed && (
            <p className="rounded-lg bg-background px-3 py-2 text-xs text-muted">
              Ya repartiste parte de este ingreso. Revisa los montos para no apartarlo dos veces.
            </p>
          )}

          {linked.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">
              Ninguna partida tiene apartado. Asígnale uno con el lápiz de cada partida.
            </p>
          ) : (
            income && (
              <ul className="flex flex-col gap-3">
                {linked.map((b) => {
                  const pocket = b.pocket!;
                  const suggested = new Decimal(income.amount).mul(b.percent).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
                  return (
                    <li key={b.id} className="flex items-center gap-3 text-sm">
                      <span className="size-3 shrink-0 rounded-full" style={{ background: b.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {b.name} <span className="font-normal text-muted">· {b.percent}%</span>
                        </p>
                        <p className="flex items-center gap-1 truncate text-xs text-muted">
                          <ArrowRight className="size-3 shrink-0" />
                          {pocket.name}
                          {pocket.currency !== income.currency && ` (${pocket.currency})`}
                        </p>
                      </div>
                      <div className="relative">
                        <Input
                          key={`${income.id}:${b.id}`}
                          name={`amount:${b.id}`}
                          defaultValue={suggested.toFixed(2)}
                          inputMode="decimal"
                          aria-label={`Monto para ${b.name}`}
                          className="w-28 pr-10 text-right tabular"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                          {income.currency}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {unlinked.length > 0 && linked.length > 0 && (
            <p className="text-xs text-muted">
              Sin apartado: {unlinked.map((b) => b.name).join(", ")}. Su parte queda disponible para usar.
            </p>
          )}
          <p className="text-xs text-muted">Deja un monto vacío o en 0 para no apartar esa partida.</p>
          <SubmitButton>Apartar</SubmitButton>
        </ActionForm>
      </Modal>
    </>
  );
}
