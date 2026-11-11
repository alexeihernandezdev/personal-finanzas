import { Field, Input, Select } from "@/components/ui";

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
  wallets,
  businesses,
  defaults,
}: {
  wallets: { id: string; name: string; currencyCode: string; availableLabel: string }[];
  businesses: { id: string; name: string }[];
  defaults?: {
    name: string;
    kind: string;
    walletId: string;
    businessId: string;
    targetAmount: string;
    targetDate: string;
    color: string;
  };
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
      <Field label="Cuenta donde está el dinero">
        <Select name="walletId" required defaultValue={defaults?.walletId}>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.currencyCode}) · disp. {w.availableLabel}
            </option>
          ))}
        </Select>
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
