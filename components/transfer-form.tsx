"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { dec } from "@/lib/money";
import { normalizeAmount } from "@/lib/validators";

type Wallet = { id: string; name: string; currencyCode: string; balance: string };

export function TransferForm({
  action,
  wallets,
  today,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  wallets: Wallet[];
  today: string;
}) {
  const [fromId, setFromId] = useState(wallets[0]?.id ?? "");
  const [toId, setToId] = useState(wallets[1]?.id ?? "");
  const [out, setOut] = useState("");
  const [inn, setInn] = useState("");
  const from = wallets.find((w) => w.id === fromId);
  const to = wallets.find((w) => w.id === toId);
  const crossCurrency = from && to && from.currencyCode !== to.currencyCode;

  const outN = normalizeAmount(out);
  const inN = normalizeAmount(inn);
  let implied: string | null = null;
  if (crossCurrency && outN && inN && Number(outN) > 0 && Number(inN) > 0) {
    // Mostramos la tasa como VES por unidad de dólar/USDT
    const r = from!.currencyCode === "VES" ? dec(outN).div(inN) : dec(inN).div(outN);
    implied = `${r.toFixed(2)} Bs. por ${from!.currencyCode === "VES" ? to!.currencyCode : from!.currencyCode}`;
    if (from!.currencyCode !== "VES" && to!.currencyCode !== "VES") {
      implied = `${dec(inN).div(outN).toFixed(4)} ${to!.currencyCode} por ${from!.currencyCode}`;
    }
  }

  return (
    <ActionForm
      action={action}
      className="grid gap-4 sm:grid-cols-2"
      onSuccess={() => {
        setOut("");
        setInn("");
      }}
    >
      <Field label="Desde">
        <Select name="fromWalletId" value={fromId} onChange={(e) => setFromId(e.target.value)}>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.currencyCode})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Hacia">
        <Select name="toWalletId" value={toId} onChange={(e) => setToId(e.target.value)}>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.currencyCode})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Monto enviado (${from?.currencyCode ?? ""})`}>
        <Input name="amountOut" inputMode="decimal" required placeholder="0,00" value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      {crossCurrency ? (
        <Field key="amount-in" label={`Monto recibido (${to?.currencyCode})`} hint={implied ? `Tasa implícita: ${implied}` : "Lo que efectivamente llegó"}>
          <Input name="amountIn" inputMode="decimal" required placeholder="0,00" value={inn} onChange={(e) => setInn(e.target.value)} />
        </Field>
      ) : (
        <Field key="fee-same" label="Comisión" hint={`Se registra como gasto en ${from?.name ?? "la cuenta de origen"}`}>
          <Input name="fee" inputMode="decimal" placeholder="0,00" />
        </Field>
      )}
      {crossCurrency && (
        <Field key="fee-cross" label={`Comisión (${from?.currencyCode})`} hint="Opcional, se registra como gasto aparte">
          <Input name="fee" inputMode="decimal" placeholder="0,00" />
        </Field>
      )}
      <Field label="Fecha">
        <Input name="date" type="date" required defaultValue={today} />
      </Field>
      <Field label="Descripción" className="col-span-full">
        <Input name="description" placeholder="Opcional" maxLength={200} />
      </Field>
      <div className="col-span-full">
        <SubmitButton>Transferir</SubmitButton>
      </div>
    </ActionForm>
  );
}
