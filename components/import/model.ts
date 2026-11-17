import type { ImportRowType } from "@/lib/import/normalize";
import { dec } from "@/lib/money";
import type { ImportCommit } from "@/lib/validators";
import { normalizeAmount } from "@/lib/validators";

export type Wallet = { id: string; name: string; currencyCode: string };
export type Category = { id: string; name: string; kind: "INCOME" | "EXPENSE" };
export type Business = { id: string; name: string };
/** Deuda o cuenta por cobrar abierta, con lo que falta en su divisa. */
export type Ledger = { id: string; name: string; loan: boolean; currencyCode: string; remaining: string };

/** Fila en revisión (todo editable). */
export type ReviewRow = {
  key: string;
  source: string;
  include: boolean;
  duplicate: boolean;
  walletId: string;
  type: ImportRowType;
  date: string;
  description: string;
  amount: string;
  reference: string | null;
  categoryId: string;
  businessId: string;
  /** Gasto que paga una deuda o ingreso que cobra algo que te deben */
  debtId: string;
  receivableId: string;
  /** Transferencia sin pareja: la otra cuenta y, si su divisa es otra, cuánto salió/llegó allí */
  counterWalletId: string;
  counterAmount: string;
};

export type Pair = {
  outKey: string;
  inKey: string;
  /** Comisión sugerida (misma divisa) */
  fee: string;
  description: string;
  accepted: boolean;
};

export const TYPE_OPTIONS: { value: ImportRowType; label: string }[] = [
  { value: "EXPENSE", label: "Gasto" },
  { value: "INCOME", label: "Ingreso" },
  { value: "TRANSFER_OUT", label: "Transferencia enviada" },
  { value: "TRANSFER_IN", label: "Transferencia recibida" },
];

export const isTransferType = (t: ImportRowType) => t === "TRANSFER_OUT" || t === "TRANSFER_IN";
export const pairId = (p: { outKey: string; inKey: string }) => `${p.outKey}|${p.inKey}`;

const amountOf = (v: string) => {
  const n = normalizeAmount(v);
  return n && Number(n) > 0 ? n : null;
};

/**
 * Convierte lo revisado en el payload de `commitImport`. Devuelve los problemas encontrados
 * (uno por fila) en vez de un payload si falta algo.
 */
export function buildCommit(
  rows: ReviewRow[],
  pairs: Pair[],
  wallets: Wallet[],
  pockets: boolean,
  ledgers: Ledger[] = [],
): { payload: ImportCommit; problems: string[] } {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const currency = (id: string) => wallets.find((w) => w.id === id)?.currencyCode;
  const problems: string[] = [];
  const items: ImportCommit["items"] = [];
  const paired = new Set<string>();
  const label = (r: ReviewRow) => `${r.date} · ${r.description || "sin descripción"}`;

  for (const p of pairs.filter((p) => p.accepted)) {
    const out = byKey.get(p.outKey);
    const inn = byKey.get(p.inKey);
    if (!out || !inn) continue;
    paired.add(out.key);
    paired.add(inn.key);
    if (!out.include || !inn.include) continue;
    const a = amountOf(out.amount);
    const b = amountOf(inn.amount);
    if (!a || !b) {
      problems.push(`Transferencia ${label(out)}: monto inválido`);
      continue;
    }
    if (out.walletId === inn.walletId) {
      problems.push(`Transferencia ${label(out)}: las dos cuentas son la misma`);
      continue;
    }
    const sameCurrency = currency(out.walletId) === currency(inn.walletId);
    const fee = sameCurrency && dec(a).gt(dec(b)) ? dec(a).minus(dec(b)) : dec(0);
    items.push({
      kind: "transfer",
      fromWalletId: out.walletId,
      toWalletId: inn.walletId,
      // Lo que salió de la cuenta = lo enviado + la comisión
      amountOut: dec(a).minus(fee).toString(),
      amountIn: b,
      fee: fee.toString(),
      date: out.date,
      description: (p.description || out.description).slice(0, 200),
    });
  }

  for (const r of rows) {
    if (!r.include || paired.has(r.key)) continue;
    const amount = amountOf(r.amount);
    if (!amount) {
      problems.push(`${label(r)}: monto inválido`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      problems.push(`${label(r)}: fecha inválida`);
      continue;
    }
    if (r.type === "INCOME" || r.type === "EXPENSE") {
      items.push({
        kind: "movement",
        type: r.type,
        walletId: r.walletId,
        amount,
        date: r.date,
        description: r.description.slice(0, 200),
        categoryId: r.categoryId || null,
        businessId: r.businessId || null,
        debtId: r.type === "EXPENSE" && r.debtId ? r.debtId : null,
        receivableId: r.type === "INCOME" && r.receivableId ? r.receivableId : null,
      });
      continue;
    }
    if (!r.counterWalletId || r.counterWalletId === r.walletId) {
      problems.push(`${label(r)}: elige la otra cuenta de la transferencia`);
      continue;
    }
    let counter = amount;
    if (currency(r.counterWalletId) !== currency(r.walletId)) {
      const c = amountOf(r.counterAmount);
      if (!c) {
        problems.push(`${label(r)}: indica el monto en ${currency(r.counterWalletId)}`);
        continue;
      }
      counter = c;
    }
    const out = r.type === "TRANSFER_OUT";
    items.push({
      kind: "transfer",
      fromWalletId: out ? r.walletId : r.counterWalletId,
      toWalletId: out ? r.counterWalletId : r.walletId,
      amountOut: out ? amount : counter,
      amountIn: out ? counter : amount,
      fee: "0",
      date: r.date,
      description: r.description.slice(0, 200),
    });
  }

  // Lo asociado a cada deuda o cobro no puede pasar de lo que falta (el servidor lo vuelve a revisar
  // con la tasa del día cuando las divisas son distintas)
  const usdLike = (c?: string) => (c === "USDT" ? "USD" : c);
  for (const l of ledgers) {
    let total = dec(0);
    for (const i of items) {
      if (i.kind !== "movement" || (i.debtId !== l.id && i.receivableId !== l.id)) continue;
      if (usdLike(currency(i.walletId)) !== usdLike(l.currencyCode)) continue;
      total = total.add(dec(i.amount));
    }
    if (total.toDecimalPlaces(2).gt(dec(l.remaining).toDecimalPlaces(2).add("0.01"))) {
      problems.push(`${l.name}: solo faltan ${dec(l.remaining).toDecimalPlaces(2).toString()} ${l.currencyCode}`);
    }
  }

  return { payload: { pockets, items }, problems };
}
