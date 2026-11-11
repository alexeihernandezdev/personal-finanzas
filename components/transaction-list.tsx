import Link from "next/link";
import { Pencil, X } from "lucide-react";
import { deleteTransaction } from "@/app/(app)/movimientos/actions";
import { ConfirmButton } from "@/components/action-form";
import { Amount, Badge, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, dec, formatMoney, signedAmount, type DecimalLike } from "@/lib/money";
import type { TransactionRow } from "@/lib/queries";
import { getRatesForDates } from "@/lib/rates";
import { formatDate } from "@/lib/utils";

export const TYPE_LABELS: Record<string, string> = {
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
  TRANSFER_OUT: "Transferencia enviada",
  TRANSFER_IN: "Transferencia recibida",
  LOAN_OUT: "Préstamo otorgado",
  LOAN_REPAYMENT: "Devolución de préstamo",
  LOAN_IN: "Préstamo recibido",
  DEBT_PAYMENT: "Pago de deuda",
  ADJUSTMENT_IN: "Ajuste",
  ADJUSTMENT_OUT: "Ajuste",
};

/**
 * Según los ajustes del usuario, muestra cada monto en USD (con la tasa del día del movimiento)
 * o en la divisa de la cuenta.
 */
async function getDisplay(transactions: TransactionRow[], currency?: MovementsCurrency) {
  const user = await requireUser();
  const toUsd = (currency ?? user.movementsCurrency) === "USD";
  const rates = toUsd
    ? await getRatesForDates(
        transactions.filter((t) => t.wallet.currencyCode === "VES").map((t) => t.date),
        user.movementsRateSource,
      )
    : new Map();
  return (t: TransactionRow, amount: DecimalLike, opts?: { sign?: boolean }) => {
    const currency = t.wallet.currencyCode;
    if (!toUsd || currency === "USD") return { main: formatMoney(amount, currency, opts), original: null };
    const rate = rates.get(t.date.toISOString().slice(0, 10)) ?? (t.rateVesPerUsd ? dec(t.rateVesPerUsd) : null);
    try {
      return {
        main: formatMoney(convert(amount, currency, "USD", rate), "USD", opts),
        original: formatMoney(amount, currency, opts),
      };
    } catch {
      // Sin tasa disponible: se muestra en la divisa original
      return { main: formatMoney(amount, currency, opts), original: null };
    }
  };
}

export type MovementsCurrency = "USD" | "ORIGINAL";

export async function TransactionList({
  transactions,
  hideWallet,
  currency,
}: {
  transactions: TransactionRow[];
  hideWallet?: boolean;
  /** Fuerza cómo se muestran los montos; si no, se usa el ajuste del usuario. */
  currency?: MovementsCurrency;
}) {
  if (transactions.length === 0) return <EmptyState>No hay movimientos.</EmptyState>;
  const display = await getDisplay(transactions, currency);
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border">
        {transactions.map((t) => {
          const editable = t.type === "INCOME" || t.type === "EXPENSE";
          const title =
            t.description ||
            t.category?.name ||
            (t.receivable ?? t.debt
              ? `${TYPE_LABELS[t.type]} · ${(t.receivable ?? t.debt)!.counterparty}`
              : TYPE_LABELS[t.type]);
          const amount = display(t, signedAmount(t.type, t.amount), { sign: true });
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: t.category?.color ?? (t.type.startsWith("TRANSFER") ? "#6366f1" : "#94a3b8") }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span>{formatDate(t.date)}</span>
                  {!hideWallet && <span>· {t.wallet.name}</span>}
                  {t.category && t.description && <span>· {t.category.name}</span>}
                  {!editable && <Badge>{TYPE_LABELS[t.type]}</Badge>}
                  {t.recurring && <Badge>Fijo: {t.recurring.name}</Badge>}
                  {t.splits
                    .filter((s) => s.business)
                    .map((s) => (
                      <Badge key={s.id} className="gap-1">
                        <span className="size-1.5 rounded-full" style={{ background: s.business!.color }} />
                        {s.business!.name}
                        {t.splits.length > 1 && ` ${display(t, s.amount).main}`}
                      </Badge>
                    ))}
                </div>
              </div>
              <div className="flex flex-col items-end">
                <Amount className="text-sm font-medium" value={amount.main} />
                {amount.original && <span className="tabular text-xs text-muted">{amount.original}</span>}
              </div>
              <div className="flex items-center">
                {editable && (
                  <Link
                    href={`/movimientos/${t.id}`}
                    className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"
                    title="Editar"
                  >
                    <Pencil className="size-3.5" />
                  </Link>
                )}
                <ConfirmButton
                  action={deleteTransaction.bind(null, t.id)}
                  confirm={
                    t.transferGroupId
                      ? "Se borrarán las dos partes de la transferencia. ¿Continuar?"
                      : "¿Borrar este movimiento?"
                  }
                  variant="ghost"
                  className="h-7 px-1.5 text-muted"
                >
                  <X className="size-3.5" />
                </ConfirmButton>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
