"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Field, Input } from "@/components/ui";
import { deleteBudgetBucket, updateBudgetBucket, updateFixedBuffer } from "./actions";

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5 text-muted transition hover:bg-background hover:text-foreground"
    >
      <Pencil className="size-3.5" />
    </button>
  );
}

function PercentInput({ defaultValue, required }: { defaultValue: string; required?: boolean }) {
  return (
    <div className="relative">
      <Input name="percent" defaultValue={defaultValue} inputMode="decimal" required={required} className="pr-7 tabular" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
    </div>
  );
}

export function EditBucketButton({ bucket }: { bucket: { id: string; name: string; percent: string; color: string } }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <EditButton label={`Editar ${bucket.name}`} onClick={() => setOpen(true)} />
      <Modal open={open} onClose={close} title="Editar partida">
        <ActionForm
          action={updateBudgetBucket.bind(null, bucket.id)}
          resetOnSuccess={false}
          onSuccess={close}
          className="flex flex-col gap-3"
        >
          <Field label="Nombre">
            <Input name="name" defaultValue={bucket.name} required autoFocus />
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Porcentaje">
              <PercentInput defaultValue={bucket.percent} required />
            </Field>
            <Field label="Color">
              <Input name="color" type="color" defaultValue={bucket.color} className="w-12 p-1" />
            </Field>
          </div>
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
        <ConfirmButton
          action={deleteBudgetBucket.bind(null, bucket.id)}
          confirm={`¿Eliminar la partida "${bucket.name}"?`}
          className="mt-2 w-full"
        >
          Eliminar partida
        </ConfirmButton>
      </Modal>
    </>
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
