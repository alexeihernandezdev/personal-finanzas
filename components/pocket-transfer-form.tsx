"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { dec, Decimal, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { normalizeAmount } from "@/lib/validators";

export type TransferDestination = { id: string; name: string; currencyCode: string; ownerName: string; isMain: boolean };

/**
 * Pasa dinero de un apartado a otro: monto fijo o % del saldo / de una entrada concreta
 * (p. ej. el 20% del ingreso de 300 del negocio a la Caja Personal).
 */
export function PocketTransferForm({
  action,
  pocket,
  entries,
  destinations,
  today,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  pocket: { id: string; currencyCode: string; balance: string };
  /** Entradas recientes del apartado, para calcular el % sobre una de ellas */
  entries: { id: string; label: string; amount: string }[];
  destinations: TransferDestination[];
  today: string;
}) {
  const [mode, setMode] = useState<"amount" | "percent">("percent");
  const [base, setBase] = useState(entries[0]?.id ?? "balance");
  const [value, setValue] = useState("");
  const [toId, setToId] = useState("");
  const currency = pocket.currencyCode;
  const to = destinations.find((d) => d.id === toId);
  const owners = [...new Set(destinations.map((d) => d.ownerName))];

  const baseAmount = dec(base === "balance" ? pocket.balance : (entries.find((e) => e.id === base)?.amount ?? 0));
  const n = dec(normalizeAmount(value) ?? "0");
  const result = mode === "percent" ? baseAmount.mul(n).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN) : n;
  const tooMuch = result.gt(dec(pocket.balance));

  return (
    <ActionForm action={action} onSuccess={() => setValue("")} resetOnSuccess={false} className="flex flex-col gap-3">
      <input type="hidden" name="fromPocketId" value={pocket.id} />
      <input type="hidden" name="mode" value={mode} />
      <Field label="Pasar a">
        <Select name="toPocketId" value={toId} onChange={(e) => setToId(e.target.value)} required>
          <option value="">Elige un apartado</option>
          {owners.map((owner) => (
            <optgroup key={owner} label={owner}>
              {destinations
                .filter((d) => d.ownerName === owner)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.currencyCode}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </Field>

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {mode === "percent" && (
          <Field label="Sobre">
            <Select name="base" value={base} onChange={(e) => setBase(e.target.value)}>
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label} · {formatMoney(e.amount, currency)}
                </option>
              ))}
              <option value="balance">Saldo actual · {formatMoney(pocket.balance, currency)}</option>
            </Select>
          </Field>
        )}
        <Field label={mode === "percent" ? "Porcentaje" : `Monto (${currency})`}>
          <Input
            name="value"
            inputMode="decimal"
            required
            placeholder={mode === "percent" ? "20" : "0,00"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Field label="Fecha">
          <Input name="date" type="date" defaultValue={today} />
        </Field>
        <Field label="Nota" hint="Opcional">
          <Input name="description" maxLength={200} placeholder="Ej. Sueldo de noviembre" />
        </Field>
      </div>

      {result.gt(0) && (
        <p className={cn("text-sm", tooMuch ? "text-negative" : "text-muted")}>
          Pasas <span className="font-medium tabular">{formatMoney(result, currency)}</span>
          {to && to.currencyCode !== currency && ` (se convierte a ${to.currencyCode})`}
          {tooMuch && " · más de lo que tiene el apartado"}
        </p>
      )}
      {to?.isMain && (
        <Checkbox name="distribute" defaultChecked label={`Repartir en ${to.name} según su presupuesto`} />
      )}
      <SubmitButton variant="secondary">Pasar</SubmitButton>
    </ActionForm>
  );
}
