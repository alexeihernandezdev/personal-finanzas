"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { CURRENCIES } from "@/components/wallet-fields";
import { Field, Input, Select } from "@/components/ui";
import { updateFixedBuffer, updateOwnerPay } from "./actions";

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-background hover:text-foreground sm:size-8"
    >
      <Pencil className="size-4 sm:size-3.5" />
    </button>
  );
}

function PercentInput({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="relative">
      <Input name="percent" defaultValue={defaultValue} inputMode="decimal" className="pr-7 tabular" autoFocus />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
    </div>
  );
}

export function EditBufferButton({ percent }: { percent: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <EditButton label="Editar colchón" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={close} title="Colchón">
        <ActionForm action={updateFixedBuffer} resetOnSuccess={false} onSuccess={close} className="flex flex-col gap-3">
          <Field label="Porcentaje" hint="Extra sobre el total de tus gastos fijos para imprevistos">
            <PercentInput defaultValue={percent} />
          </Field>
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
      </Modal>
    </>
  );
}

const PAY_MODES = [
  { value: "NONE", label: "Sin sueldo" },
  { value: "FIXED", label: "Monto fijo al mes" },
  { value: "PROFIT_PERCENT", label: "% de la ganancia del mes" },
] as const;

/** Sueldo del dueño de un negocio: un monto fijo al mes o un % de la ganancia del mes. */
export function EditOwnerPayButton({
  businessId,
  mode: initialMode,
  percent,
  amount,
  currency,
}: {
  businessId: string;
  mode: string;
  percent: string;
  amount: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const close = () => setOpen(false);

  return (
    <>
      <EditButton label="Editar tu sueldo" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={close} title="Tu sueldo">
        <ActionForm
          action={updateOwnerPay.bind(null, businessId)}
          resetOnSuccess={false}
          onSuccess={close}
          className="flex flex-col gap-3"
        >
          <Field label="Cómo te pagas">
            <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {PAY_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {mode === "FIXED" && (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <Field label="Monto al mes">
                  <Input name="amount" defaultValue={amount} inputMode="decimal" placeholder="0,00" className="tabular" autoFocus />
                </Field>
                <Field label="Divisa">
                  <Select name="currencyCode" defaultValue={currency}>
                    {CURRENCIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-pretty text-muted">
                Se reserva como un gasto fijo del negocio con cada venta y cuenta como ingreso fijo en tus finanzas personales.
                Sirve aunque el negocio no tenga ingresos fijos.
              </p>
            </>
          )}
          {mode === "PROFIT_PERCENT" && (
            <>
              <Field label="% de la ganancia">
                <PercentInput defaultValue={percent} />
              </Field>
              <p className="text-xs text-pretty text-muted">
                Ganancia = ingresos − gastos del negocio en el mes. Al cerrar el mes te pagas ese % desde su Caja.
              </p>
            </>
          )}
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
      </Modal>
    </>
  );
}
