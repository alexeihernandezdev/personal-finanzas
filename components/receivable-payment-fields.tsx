"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { convert } from "@/lib/money";

/** Cuenta y monto de un cobro: el monto sugerido se muestra en la divisa de la cuenta elegida. */
export function ReceivablePaymentFields({
  wallets,
  remaining,
  currencyCode,
  rate,
}: {
  wallets: { id: string; name: string; currencyCode: string }[];
  remaining: string;
  currencyCode: string;
  rate: string | null;
}) {
  const suggested = (walletId: string) => {
    const to = wallets.find((w) => w.id === walletId)?.currencyCode ?? currencyCode;
    try {
      return convert(remaining, currencyCode, to, rate).toFixed(2);
    } catch {
      return "";
    }
  };
  const [walletId, setWalletId] = useState(wallets.find((w) => w.currencyCode === currencyCode)?.id ?? wallets[0]?.id ?? "");
  const [amount, setAmount] = useState(() => suggested(walletId));

  return (
    <>
      <Select
        name="walletId"
        className="col-span-2 sm:h-8 sm:w-40 sm:text-xs"
        value={walletId}
        onChange={(e) => {
          setWalletId(e.target.value);
          setAmount(suggested(e.target.value));
        }}
      >
        {wallets.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} ({w.currencyCode})
          </option>
        ))}
      </Select>
      <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="sm:h-8 sm:w-28 sm:text-xs" />
    </>
  );
}
