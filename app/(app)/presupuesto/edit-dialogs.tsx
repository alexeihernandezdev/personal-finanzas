"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Field, Input, Select } from "@/components/ui";
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

export type PocketOption = { id: string; name: string; currencyCode: string; ownerName: string; isMain: boolean };

/**
 * Apartado al que va el dinero de la partida cuando entra dinero a la Caja. Puede ser la Caja de otro
 * dueño (p. ej. "Sueldo → Caja Personal"): ahí se vuelve a repartir con su propio presupuesto.
 */
export function PocketSelect({ pockets, defaultValue }: { pockets: PocketOption[]; defaultValue?: string | null }) {
  const owners = [...new Set(pockets.map((p) => p.ownerName))];
  return (
    <Field label="Apartado" hint="A dónde va su parte cuando entra dinero">
      <Select name="pocketId" defaultValue={defaultValue ?? ""}>
        <option value="">Sin apartado</option>
        {owners.map((owner) => (
          <optgroup key={owner} label={owner}>
            {pockets
              .filter((p) => p.ownerName === owner)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.currencyCode}
                  {p.isMain ? " (se reparte con su presupuesto)" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

export function EditBucketButton({
  bucket,
  pockets,
}: {
  bucket: { id: string; name: string; percent: string; color: string; pocketId: string | null };
  pockets: PocketOption[];
}) {
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
          <PocketSelect pockets={pockets} defaultValue={bucket.pocketId} />
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
