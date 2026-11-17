"use client";

import { ArrowRight, Link2, Trash2, Unlink } from "lucide-react";
import { Badge, Button, Card, Checkbox, Input, Select } from "@/components/ui";
import type { ImportRowType } from "@/lib/import/normalize";
import { dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { normalizeAmount } from "@/lib/validators";
import { isTransferType, TYPE_OPTIONS, type Business, type Category, type Pair, type ReviewRow, type Wallet } from "./model";

const dateCls =
  "h-10 w-full min-w-0 rounded-lg bg-primary px-3 text-sm text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset focus:ring-2 focus:ring-brand max-sm:h-11";

const walletOf = (wallets: Wallet[], id: string) => wallets.find((w) => w.id === id);
const money = (amount: string, currency = "USD") => formatMoney(normalizeAmount(amount) ?? "0", currency);

function RowSummary({ row, wallets, sign }: { row: ReviewRow; wallets: Wallet[]; sign: "-" | "+" }) {
  const w = walletOf(wallets, row.walletId);
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2">
      <p className="truncate text-sm font-medium">{w?.name ?? "Cuenta"}</p>
      <p className="truncate text-xs text-muted">
        {row.date} · {row.description || "sin descripción"}
      </p>
      <p className={cn("tabular text-sm font-semibold", sign === "-" ? "text-negative" : "text-positive")}>
        {sign}
        {money(row.amount, w?.currencyCode)}
      </p>
    </div>
  );
}

/** "¿Es transferencia?": una salida y una entrada que coinciden. */
export function SuggestionCard({
  pair,
  rows,
  wallets,
  onAccept,
  onReject,
}: {
  pair: Pair;
  rows: ReviewRow[];
  wallets: Wallet[];
  onAccept: () => void;
  onReject: () => void;
}) {
  const out = rows.find((r) => r.key === pair.outKey);
  const inn = rows.find((r) => r.key === pair.inKey);
  if (!out || !inn) return null;
  return (
    <Card className="flex flex-col gap-3 border-dashed">
      <p className="text-sm font-medium">¿Es una transferencia entre tus cuentas?</p>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <RowSummary row={out} wallets={wallets} sign="-" />
        <ArrowRight className="mx-auto size-4 shrink-0 rotate-90 text-muted sm:rotate-0" />
        <RowSummary row={inn} wallets={wallets} sign="+" />
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={onAccept}>
          Sí, es transferencia
        </Button>
        <Button type="button" variant="ghost" onClick={onReject}>
          No
        </Button>
      </div>
    </Card>
  );
}

/** Transferencia emparejada: sale de una captura y entra en la otra. */
export function PairCard({
  pair,
  rows,
  wallets,
  onChange,
  onToggle,
  onSplit,
}: {
  pair: Pair;
  rows: ReviewRow[];
  wallets: Wallet[];
  onChange: (patch: Partial<Pair>) => void;
  onToggle: (include: boolean) => void;
  onSplit: () => void;
}) {
  const out = rows.find((r) => r.key === pair.outKey);
  const inn = rows.find((r) => r.key === pair.inKey);
  if (!out || !inn) return null;
  const from = walletOf(wallets, out.walletId);
  const to = walletOf(wallets, inn.walletId);
  const a = normalizeAmount(out.amount);
  const b = normalizeAmount(inn.amount);
  const fee = from?.currencyCode === to?.currencyCode && a && b && dec(a).gt(dec(b)) ? dec(a).minus(dec(b)) : null;
  return (
    <Card className={cn("flex flex-col gap-3", !out.include && "opacity-60")}>
      <div className="flex items-center gap-2">
        <Checkbox label="" checked={out.include && inn.include} onCheckedChange={onToggle} title="Incluir" />
        <Badge color="brand">Transferencia</Badge>
        <span className="truncate text-sm text-muted">
          {from?.name} → {to?.name}
        </span>
        <Button type="button" variant="ghost" className="ml-auto" onClick={onSplit} aria-label="Separar">
          <Unlink className="size-4" />
          <span className="max-sm:hidden">Separar</span>
        </Button>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <RowSummary row={out} wallets={wallets} sign="-" />
        <ArrowRight className="mx-auto size-4 shrink-0 rotate-90 text-muted sm:rotate-0" />
        <RowSummary row={inn} wallets={wallets} sign="+" />
      </div>
      {fee && fee.gt(0) && (
        <p className="text-xs text-muted">Comisión: {formatMoney(fee, from?.currencyCode ?? "USD")} (se registra como gasto en Comisiones)</p>
      )}
      <Input
        value={pair.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder={`Descripción (por defecto: ${out.description || `${from?.name} → ${to?.name}`})`}
        maxLength={200}
        aria-label="Descripción"
      />
    </Card>
  );
}

/** Una fila suelta: ingreso, gasto o transferencia sin pareja. */
export function RowCard({
  row,
  rows,
  linked,
  wallets,
  categories,
  businesses,
  onChange,
  onLink,
  onRemove,
}: {
  row: ReviewRow;
  rows: ReviewRow[];
  linked: Set<string>;
  wallets: Wallet[];
  categories: Category[];
  businesses: Business[];
  onChange: (patch: Partial<ReviewRow>) => void;
  onLink: (otherKey: string) => void;
  onRemove: () => void;
}) {
  const wallet = walletOf(wallets, row.walletId);
  const transfer = isTransferType(row.type);
  const counter = walletOf(wallets, row.counterWalletId);
  const out = row.type === "EXPENSE" || row.type === "TRANSFER_OUT";
  // Filas de otra cuenta en sentido contrario con las que se puede emparejar
  const candidates = transfer
    ? rows.filter(
        (r) =>
          r.key !== row.key &&
          !linked.has(r.key) &&
          r.walletId !== row.walletId &&
          (out ? r.type === "INCOME" || r.type === "TRANSFER_IN" : r.type === "EXPENSE" || r.type === "TRANSFER_OUT"),
      )
    : [];

  return (
    <Card className={cn("flex flex-col gap-3", !row.include && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox label="" checked={row.include} onCheckedChange={(include) => onChange({ include })} title="Incluir" />
        <span className={cn("tabular text-base font-semibold", out ? "text-negative" : "text-positive")}>
          {out ? "-" : "+"}
          {money(row.amount, wallet?.currencyCode)}
        </span>
        {row.duplicate && <Badge color="warning">Posible duplicado</Badge>}
        {row.reference && <span className="text-xs text-muted">Ref. {row.reference}</span>}
        <button type="button" onClick={onRemove} aria-label="Quitar" className="ml-auto p-1 text-muted hover:text-negative">
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={row.type}
          onChange={(e) => onChange({ type: e.target.value as ImportRowType, categoryId: "" })}
          aria-label="Tipo"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select value={row.walletId} onChange={(e) => onChange({ walletId: e.target.value })} aria-label="Cuenta">
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.currencyCode})
            </option>
          ))}
        </Select>
        <input type="date" value={row.date} onChange={(e) => onChange({ date: e.target.value })} aria-label="Fecha" className={dateCls} />
        <Input value={row.amount} onChange={(e) => onChange({ amount: e.target.value })} inputMode="decimal" aria-label="Monto" />
        <Input
          value={row.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Descripción"
          maxLength={200}
          aria-label="Descripción"
          className="sm:col-span-2"
        />

        {!transfer && (
          <>
            <Select value={row.categoryId} onChange={(e) => onChange({ categoryId: e.target.value })} aria-label="Categoría">
              <option value="">Sin categoría</option>
              {categories
                .filter((c) => c.kind === row.type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            {businesses.length > 0 && (
              <Select value={row.businessId} onChange={(e) => onChange({ businessId: e.target.value })} aria-label="Es de">
                <option value="">Personal</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}

        {transfer && (
          <>
            <Select
              value={row.counterWalletId}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("row:")) onLink(v.slice(4));
                else onChange({ counterWalletId: v });
              }}
              aria-label={out ? "Cuenta destino" : "Cuenta origen"}
            >
              <option value="">{out ? "¿A qué cuenta fue?" : "¿De qué cuenta vino?"}</option>
              <optgroup label="Cuenta">
                {wallets
                  .filter((w) => w.id !== row.walletId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.currencyCode})
                    </option>
                  ))}
              </optgroup>
              {candidates.length > 0 && (
                <optgroup label="Emparejar con otra captura">
                  {candidates.map((c) => (
                    <option key={c.key} value={`row:${c.key}`}>
                      {walletOf(wallets, c.walletId)?.name} · {c.date} · {money(c.amount, walletOf(wallets, c.walletId)?.currencyCode)}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
            {counter && counter.currencyCode !== wallet?.currencyCode && (
              <Input
                value={row.counterAmount}
                onChange={(e) => onChange({ counterAmount: e.target.value })}
                inputMode="decimal"
                placeholder={`${out ? "Llegó" : "Salió"} en ${counter.currencyCode}`}
                aria-label={`Monto en ${counter.currencyCode}`}
              />
            )}
          </>
        )}
      </div>
      {transfer && candidates.length === 0 && !row.counterWalletId && (
        <p className="flex items-center gap-1 text-xs text-muted">
          <Link2 className="size-3.5" />
          Sube la captura de la otra cuenta para emparejarla, o elige la cuenta.
        </p>
      )}
    </Card>
  );
}
