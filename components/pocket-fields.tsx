import { Field, Input, Select } from "@/components/ui";
import { CURRENCIES } from "@/components/wallet-fields";

export const POCKET_KINDS = [
  { value: "SAVINGS", label: "Ahorro" },
  { value: "GOAL", label: "Meta u objetivo" },
  { value: "EMERGENCY", label: "Fondo de emergencia" },
  { value: "RESERVE", label: "Reserva (impuestos, pagos…)" },
];

export function pocketKindLabel(kind: string) {
  return POCKET_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function PocketFields({
  businesses,
  defaults,
  currencyLocked,
}: {
  businesses: { id: string; name: string }[];
  defaults?: {
    name: string;
    kind: string;
    currencyCode: string;
    businessId: string;
    targetAmount: string;
    targetDate: string;
    color: string;
  };
  // Con dinero apartado no se puede cambiar la divisa
  currencyLocked?: boolean;
}) {
  return (
    <>
      <Field label="Nombre">
        <Input name="name" required placeholder="Ej. Vacaciones, Laptop nueva…" defaultValue={defaults?.name} />
      </Field>
      <Field label="Tipo">
        <Select name="kind" defaultValue={defaults?.kind ?? "SAVINGS"}>
          {POCKET_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Para" hint="Separa el dinero personal del de cada negocio">
        <Select name="businessId" defaultValue={defaults?.businessId ?? ""}>
          <option value="">Personal</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Moneda" hint={currencyLocked ? "Libera el dinero del apartado para cambiarla" : undefined}>
        <Select name="currencyCode" defaultValue={defaults?.currencyCode ?? "USD"} disabled={currencyLocked}>
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        {currencyLocked && <input type="hidden" name="currencyCode" value={defaults?.currencyCode} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meta" hint="Opcional">
          <Input name="targetAmount" inputMode="decimal" placeholder="0,00" defaultValue={defaults?.targetAmount} />
        </Field>
        <Field label="Para el" hint="Opcional">
          <Input name="targetDate" type="date" defaultValue={defaults?.targetDate} />
        </Field>
      </div>
      <Field label="Color">
        <Input name="color" type="color" defaultValue={defaults?.color ?? "#0f766e"} className="p-1" />
      </Field>
    </>
  );
}
