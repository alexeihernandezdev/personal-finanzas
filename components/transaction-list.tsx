import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HandCoins,
  Pencil,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
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

const TYPE_ICONS: Record<string, LucideIcon> = {
  INCOME: ArrowDownLeft,
  EXPENSE: ArrowUpRight,
  TRANSFER_OUT: ArrowLeftRight,
  TRANSFER_IN: ArrowLeftRight,
  LOAN_OUT: HandCoins,
  LOAN_REPAYMENT: HandCoins,
  LOAN_IN: HandCoins,
  DEBT_PAYMENT: HandCoins,
  ADJUSTMENT_IN: SlidersHorizontal,
  ADJUSTMENT_OUT: SlidersHorizontal,
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
    <Card className="p-0 sm:p-0">
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
          const color = t.category?.color ?? (t.type.startsWith("TRANSFER") ? "#6366f1" : "#94a3b8");
          const Icon = TYPE_ICONS[t.type] ?? ArrowLeftRight;
          const businessSplits = t.splits.filter((s) => s.business);
          const hasBadges = !editable || t.recurring || businessSplits.length > 0;
          const confirm = t.transferGroupId
            ? "Se borrarán las dos partes de la transferencia. ¿Continuar?"
            : "¿Borrar este movimiento?";
          return (
            <li key={t.id} className="relative flex items-center gap-3 px-4 py-3 transition-colors has-[a.row-link:active]:bg-background">
              {/* En móvil toda la fila abre la edición; en escritorio están los botones */}
              {editable && (
                <Link href={`/movimientos/${t.id}`} className="row-link absolute inset-0 sm:hidden" aria-label={`Editar ${title}`} />
              )}
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{title}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {formatDate(t.date)}
                  {!hideWallet && ` · ${t.wallet.name}`}
                  {t.category && t.description && ` · ${t.category.name}`}
                </p>
                {hasBadges && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {!editable && <Badge>{TYPE_LABELS[t.type]}</Badge>}
                    {t.recurring && <Badge>Fijo: {t.recurring.name}</Badge>}
                    {businessSplits.map((s) => (
                      <Badge key={s.id}>
                        <span className="size-1.5 rounded-full" style={{ background: s.business!.color }} />
                        {s.business!.name}
                        {t.splits.length > 1 && ` ${display(t, s.amount).main}`}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <Amount className="text-sm font-semibold" value={amount.main} />
                {amount.original && <span className="tabular text-xs text-muted">{amount.original}</span>}
              </div>
              <div className={editable ? "hidden items-center sm:flex" : "relative flex items-center"}>
                {editable && (
                  <Link
                    href={`/movimientos/${t.id}`}
                    className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-foreground"
                    title="Editar"
                    aria-label="Editar"
                  >
                    <Pencil className="size-3.5" />
                  </Link>
                )}
                <ConfirmButton
                  action={deleteTransaction.bind(null, t.id)}
                  confirm={confirm}
                  variant="ghost"
                  className="size-10 px-0 text-muted sm:size-8"
                >
                  <X className="size-4 sm:size-3.5" aria-label="Borrar" />
                </ConfirmButton>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
