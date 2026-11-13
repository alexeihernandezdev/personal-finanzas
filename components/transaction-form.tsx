"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CurrencyConverter, type RatesDTO } from "@/components/currency-converter";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { dec, Decimal, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { normalizeAmount } from "@/lib/validators";

type Option = { id: string; name: string };

/**
 * Apartado elegible al registrar un movimiento. `rules`: reparto automático si es una Caja
 * (`percent` null = los gastos fijos se llevan lo que les falta del mes).
 */
export type PocketChoice = {
  id: string;
  name: string;
  currencyCode: string;
  isMain: boolean;
  businessId: string | null;
  ownerName: string;
  rules: { name: string; percent: string | null; target: string }[];
};

const AUTO_POCKET = "auto";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  wallets: (Option & { currencyCode: string })[];
  categories: (Option & { kind: "INCOME" | "EXPENSE" })[];
  businesses: (Option & { color: string })[];
  pockets?: PocketChoice[];
  today: string;
  rates?: RatesDTO;
  rateSource?: "BCV" | "BINANCE";
  defaults?: {
    type: "INCOME" | "EXPENSE";
    walletId: string;
    amount: string;
    date: string;
    categoryId: string | null;
    description: string;
    businessId: string | null;
    pocketId: string;
    distribute: boolean;
  };
  defaultWalletId?: string;
  submitLabel?: string;
};

export function TransactionForm({
  action,
  wallets,
  categories,
  businesses,
  pockets = [],
  today,
  rates,
  rateSource,
  defaults,
  defaultWalletId,
  submitLabel = "Guardar",
}: Props) {
  const [type, setType] = useState<"INCOME" | "EXPENSE">(defaults?.type ?? "EXPENSE");
  const [walletId, setWalletId] = useState(defaults?.walletId ?? defaultWalletId ?? wallets[0]?.id ?? "");
  const [amount, setAmount] = useState(defaults?.amount ?? "");
  const [businessId, setBusinessId] = useState(defaults?.businessId ?? "");
  const [calcOn, setCalcOn] = useState(false);
  const [pocketId, setPocketId] = useState(defaults?.pocketId ?? AUTO_POCKET);

  const currency = wallets.find((w) => w.id === walletId)?.currencyCode ?? "USD";
  const total = dec(normalizeAmount(amount) ?? "0");

  const filteredCategories = categories.filter((c) => c.kind === type);

  const ownerId = businessId || null;
  const ownerName = businesses.find((b) => b.id === ownerId)?.name ?? "Personal";
  const caja = pockets.find((p) => p.isMain && p.businessId === ownerId);
  // Caja que recibirá el dinero (y lo repartirá) con la selección actual
  const receiver =
    pocketId === AUTO_POCKET
      ? { name: caja?.name ?? `Caja ${ownerName} (se crea)`, rules: caja?.rules ?? [] }
      : pockets.find((p) => p.id === pocketId && p.isMain);
  const owners = [...new Set(pockets.map((p) => p.ownerName))];

  const resetAll = () => {
    if (defaults) return;
    setAmount("");
    setPocketId(AUTO_POCKET);
  };

  return (
    <ActionForm
      action={action}
      resetOnSuccess={!defaults}
      onSuccess={resetAll}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <input type="hidden" name="type" value={type} />

      <div className="col-span-full grid grid-cols-2 gap-1 rounded-xl bg-background p-1">
        {(["EXPENSE", "INCOME"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "min-h-10 rounded-lg py-2 text-sm font-medium transition sm:min-h-0 sm:py-1.5 transition",
              type === t ? "bg-surface shadow-sm" : "text-muted",
              type === t && (t === "INCOME" ? "text-positive" : "text-negative"),
            )}
          >
            {t === "INCOME" ? "Ingreso" : "Gasto"}
          </button>
        ))}
      </div>

      <Field label="Cuenta">
        <Select name="walletId" value={walletId} onChange={(e) => setWalletId(e.target.value)} required>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.currencyCode})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Monto (${currency})`}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          placeholder="0,00"
          className="h-14 text-2xl font-semibold tabular sm:h-11 sm:text-lg"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {rates && (
        <div className="col-span-full rounded-xl border border-border px-3 py-1">
          <button
            type="button"
            onClick={() => setCalcOn(!calcOn)}
            className="flex min-h-10 w-full items-center gap-2 text-sm font-medium text-accent"
          >
            <Calculator className="size-4" />
            {calcOn ? "Ocultar calculadora de divisas" : "Calculadora de divisas"}
          </button>
          {calcOn && (
            <div className="mt-1 mb-2">
              <CurrencyConverter
                key={currency}
                rates={rates}
                defaultSource={rateSource}
                lockTo={currency}
                onUse={setAmount}
              />
            </div>
          )}
        </div>
      )}
      <Field label="Fecha">
        <Input name="date" type="date" required defaultValue={defaults?.date ?? today} />
      </Field>
      <Field label="Categoría">
        <Select name="categoryId" defaultValue={defaults?.categoryId ?? ""} key={type}>
          <option value="">Sin categoría</option>
          {filteredCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Descripción" className="col-span-full">
        <Input name="description" placeholder="Opcional" defaultValue={defaults?.description} maxLength={200} />
      </Field>

      {businesses.length > 0 && (
        <Field label="Es de" className="col-span-full">
          <Select name="businessId" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
            <option value="">Personal</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="col-span-full flex flex-col gap-2 rounded-xl border border-border p-3">
        <Field label={type === "INCOME" ? "Va al apartado" : "Sale del apartado"}>
          <Select name="pocketId" value={pocketId} onChange={(e) => setPocketId(e.target.value)}>
            <option value={AUTO_POCKET}>Caja {ownerName} (automático)</option>
            <option value="">Ninguno: dinero sin asignar</option>
            {owners.map((owner) => (
              <optgroup key={owner} label={owner}>
                {pockets
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
        {type === "EXPENSE" && pocketId === AUTO_POCKET && (
          <p className="text-xs text-muted">Sale de la Caja de su dueño, si ya la tiene.</p>
        )}
        {type === "INCOME" && receiver && (
          <>
            <Checkbox
              name="distribute"
              defaultChecked={defaults?.distribute ?? true}
              key={defaults ? "edit" : "new"}
              label="Repartir en los apartados"
            />
            <ul className="flex flex-col gap-1 text-xs text-muted">
              <li>
                <span className="font-medium text-foreground">{receiver.name}</span>
                {receiver.rules.length === 0
                  ? " · sin apartados con %: todo se queda en la Caja"
                  : receiver.rules.map((rule) => (
                      <span key={rule.name} className="block pl-3">
                        {rule.name} {rule.percent === null ? "(lo que falta del mes)" : `${rule.percent}%`} → {rule.target}
                        {rule.percent !== null &&
                          total.gt(0) &&
                          ` · ${formatMoney(total.mul(rule.percent).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN), currency)}`}
                      </span>
                    ))}
              </li>
            </ul>
          </>
        )}
      </div>

      <div className="col-span-full">
        <SubmitButton className="w-full sm:w-auto sm:min-w-40">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
