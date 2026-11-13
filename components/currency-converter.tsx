"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { convert, formatMoney } from "@/lib/money";
import { normalizeAmount } from "@/lib/validators";

/** Tasas VES por USD serializadas para el cliente. */
export type RatesDTO = {
  bcv: string | null;
  binance: string | null;
  binanceBuy: string | null;
  binanceSell: string | null;
};

type RateKey = keyof RatesDTO | "CUSTOM";

const CURRENCIES = ["USD", "VES", "USDT"];
const RATE_LABELS: Record<RateKey, string> = {
  bcv: "BCV",
  binance: "Binance (promedio)",
  binanceBuy: "Binance compra",
  binanceSell: "Binance venta",
  CUSTOM: "Tasa manual",
};

export function CurrencyConverter({
  rates,
  defaultSource = "BCV",
  lockTo,
  onUse,
}: {
  rates: RatesDTO;
  defaultSource?: "BCV" | "BINANCE";
  /** Fija la moneda de destino (p. ej. la de la cuenta del movimiento). */
  lockTo?: string;
  /** Si se pasa, muestra un botón para usar el resultado. */
  onUse?: (value: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(lockTo === "VES" ? "USD" : "VES");
  const [toState, setTo] = useState(lockTo ?? "USD");
  const [rateKey, setRateKey] = useState<RateKey>(defaultSource === "BCV" ? "bcv" : "binance");
  const [customRate, setCustomRate] = useState("");
  const to = lockTo ?? toState;

  const rate = rateKey === "CUSTOM" ? normalizeAmount(customRate) : rates[rateKey];
  const amountN = normalizeAmount(amount);

  let result: string | null = null;
  let error: string | null = null;
  if (amountN) {
    try {
      result = convert(amountN, from, to, rate).toFixed(2);
    } catch (e) {
      error = e instanceof Error ? e.message : "No se pudo convertir";
    }
  }
  const needsRate = from === "VES" || to === "VES";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Monto a convertir">
        <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="flex items-end gap-2">
        <Field label="De" className="flex-1">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {!lockTo && (
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-2"
            aria-label="Invertir monedas"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <ArrowLeftRight className="size-4" />
          </Button>
        )}
        <Field label="A" className="flex-1">
          <Select value={to} onChange={(e) => setTo(e.target.value)} disabled={!!lockTo}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {needsRate && (
        <Field label="Tasa (Bs. por USD)">
          <Select value={rateKey} onChange={(e) => setRateKey(e.target.value as RateKey)}>
            {(Object.keys(RATE_LABELS) as RateKey[]).map((k) => (
              <option key={k} value={k} disabled={k !== "CUSTOM" && !rates[k]}>
                {RATE_LABELS[k]}
                {k !== "CUSTOM" && rates[k] ? ` · ${Number(rates[k]).toFixed(2)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {needsRate && rateKey === "CUSTOM" && (
        <Field label="Tasa manual">
          <Input inputMode="decimal" placeholder="0,00" value={customRate} onChange={(e) => setCustomRate(e.target.value)} />
        </Field>
      )}
      <div className="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2">
        <p className="text-sm">
          {error ? (
            <span className="text-negative">{error}</span>
          ) : result ? (
            <>
              {formatMoney(amountN!, from)} = <strong className="text-lg tabular">{formatMoney(result, to)}</strong>
            </>
          ) : (
            <span className="text-muted">Escribe un monto para ver la conversión</span>
          )}
        </p>
        {onUse && result && (
          <Button type="button" variant="secondary" className="h-10 px-3 text-sm sm:h-8 sm:text-xs" onClick={() => onUse(result!)}>
            Usar como monto
          </Button>
        )}
      </div>
    </div>
  );
}
