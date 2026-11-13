"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Field, Input } from "@/components/ui";
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

/** Sueldo del dueño de un negocio: % de cada ingreso que pasa a la Caja Personal. */
export function EditOwnerPayButton({ businessId, percent }: { businessId: string; percent: string }) {
  const [open, setOpen] = useState(false);
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
          <Field
            label="% de cada ingreso del negocio"
            hint="Pasa a tu Caja Personal y se reparte con tus apartados personales. Déjalo vacío para no pasarte nada."
          >
            <PercentInput defaultValue={percent} />
          </Field>
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
      </Modal>
    </>
  );
}
