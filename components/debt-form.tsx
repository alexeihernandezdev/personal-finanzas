"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PocketPicker } from "@/components/pocket-picker";
import type { PocketChoice } from "@/components/transaction-form";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

export function DebtForm({
  action,
  wallets,
  businesses,
  pockets,
  today,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  wallets: { id: string; name: string; currencyCode: string }[];
  businesses: { id: string; name: string }[];
  pockets: PocketChoice[];
  today: string;
}) {
  const [kind, setKind] = useState<"PAYABLE" | "LOAN_RECEIVED">("PAYABLE");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const loanCurrency = wallets.find((w) => w.id === walletId)?.currencyCode;
  const isLoan = kind === "LOAN_RECEIVED";

  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1">
        {(
          [
            ["PAYABLE", "Debo pagar"],
            ["LOAN_RECEIVED", "Me prestaron"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn("min-h-10 rounded-lg py-2 text-sm font-medium transition sm:min-h-0 sm:py-1.5", kind === k ? "bg-surface shadow-sm" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <Field label={isLoan ? "¿Quién te prestó?" : "¿A quién le debes?"}>
        <Input name="counterparty" required />
      </Field>
      <Field label="Concepto">
        <Input name="description" placeholder="Opcional" maxLength={200} />
      </Field>
      {isLoan ? (
        <>
          <Field label="Entra a la cuenta">
            <Select name="walletId" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.currencyCode})
                </option>
              ))}
            </Select>
          </Field>
          <input type="hidden" name="currencyCode" value={loanCurrency ?? "USD"} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Monto (${loanCurrency ?? ""})`} hint={loanCurrency === "VES" ? "Se guarda en USD a la tasa del día" : undefined}>
              <Input name="amount" required inputMode="decimal" placeholder="0,00" />
            </Field>
            <Field label="Fecha del préstamo">
              <Input name="date" type="date" defaultValue={today} />
            </Field>
          </div>
          <Field label="Entra al apartado">
            <PocketPicker pockets={pockets} direction="in" />
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto">
            <Input name="amount" required inputMode="decimal" placeholder="0,00" />
          </Field>
          <Field label="Divisa" hint="En VES se guarda en USD a la tasa del día">
            <Select name="currencyCode" defaultValue="USD">
              <option value="USD">USD</option>
              <option value="VES">VES</option>
              <option value="USDT">USDT</option>
            </Select>
          </Field>
        </div>
      )}
      <Field label={isLoan ? "Fecha en que lo devuelves" : "Fecha límite de pago"}>
        <Input name="dueDate" type="date" />
      </Field>
      {!isLoan && (
        <Field label="Negocio">
          <Select name="businessId" defaultValue="">
            <option value="">Personal</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <SubmitButton>Registrar</SubmitButton>
    </ActionForm>
  );
}
