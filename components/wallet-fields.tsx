import { Field, Input, Select } from "@/components/ui";

export const WALLET_TYPES = [
  { value: "BANK", label: "Banco" },
  { value: "PAYPAL", label: "PayPal" },
  { value: "BINANCE", label: "Binance" },
  { value: "CASH", label: "Efectivo" },
  { value: "OTHER", label: "Otro" },
];

export const CURRENCIES = [
  { value: "USD", label: "USD · Dólares" },
  { value: "VES", label: "VES · Bolívares" },
  { value: "USDT", label: "USDT · Tether" },
];

export function walletTypeLabel(type: string) {
  return WALLET_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function WalletFields({
  defaults,
}: {
  defaults?: { name: string; type: string; currencyCode: string; initialBalance: string; color: string };
}) {
  return (
    <>
      <Field label="Nombre">
        <Input name="name" required placeholder="Ej. Banesco, PayPal…" defaultValue={defaults?.name} />
      </Field>
      <Field label="Tipo">
        <Select name="type" defaultValue={defaults?.type ?? "BANK"}>
          {WALLET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Divisa">
        <Select name="currencyCode" defaultValue={defaults?.currencyCode ?? "USD"}>
          {CURRENCIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Saldo inicial" hint="Lo que tenías al empezar a usar la app">
        <Input name="initialBalance" inputMode="decimal" placeholder="0,00" defaultValue={defaults?.initialBalance} />
      </Field>
      <Field label="Color">
        <Input name="color" type="color" defaultValue={defaults?.color ?? "#0f766e"} className="p-1" />
      </Field>
    </>
  );
}
