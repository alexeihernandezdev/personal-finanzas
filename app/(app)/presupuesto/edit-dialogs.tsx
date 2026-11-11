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

export type PocketOption = {
  id: string;
  name: string;
  currencyCode: string;
  ownerName: string;
  /** Dueño: "personal" o el id del negocio */
  ownerKey: string;
  isMain: boolean;
};

/** Dueños a los que puede ir una partida (otro negocio o Personal); el dinero cae en su Caja. */
export type OwnerOption = { key: string; name: string };

/** Valor del selector para una partida que va a la Caja de su apartado (o al dueño si es una Caja). */
export function pocketValue(pocket: PocketOption | undefined) {
  if (!pocket) return "";
  return pocket.isMain ? `owner:${pocket.ownerKey}` : pocket.id;
}

/**
 * A dónde va el dinero de la partida cuando entra dinero a la Caja: a otro dueño (p. ej. "Sueldo 30% →
 * Personal", que se vuelve a repartir con su presupuesto) o a un apartado concreto.
 */
export function PocketSelect({
  pockets,
  owners,
  defaultValue,
}: {
  pockets: PocketOption[];
  owners: OwnerOption[];
  defaultValue?: string;
}) {
  const regular = pockets.filter((p) => !p.isMain);
  const groups = [...new Set(regular.map((p) => p.ownerName))];
  return (
    <Field label="Va a" hint="A dónde va su parte cuando entra dinero">
      <Select name="pocketId" defaultValue={defaultValue ?? ""}>
        <option value="">Sin apartado (se queda en la Caja)</option>
        {owners.length > 0 && (
          <optgroup label="Otra cuenta">
            {owners.map((o) => (
              <option key={o.key} value={`owner:${o.key}`}>
                {o.name} (a su Caja, y se reparte con su presupuesto)
              </option>
            ))}
          </optgroup>
        )}
        {groups.map((owner) => (
          <optgroup key={owner} label={`Apartados · ${owner}`}>
            {regular
              .filter((p) => p.ownerName === owner)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.currencyCode}
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
  owners,
}: {
  bucket: { id: string; name: string; percent: string; color: string; pocketId: string | null };
  pockets: PocketOption[];
  owners: OwnerOption[];
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
          <PocketSelect
            pockets={pockets}
            owners={owners}
            defaultValue={pocketValue(pockets.find((p) => p.id === bucket.pocketId))}
          />
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
