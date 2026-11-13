import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { TransactionList, type MovementsCurrency } from "@/components/transaction-list";
import { Amount, Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { WalletFields, walletTypeLabel } from "@/components/wallet-fields";
import { requireUser } from "@/lib/dal";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getWallet, listTransactions } from "@/lib/queries";
import { deleteWallet, toggleArchiveWallet, updateWallet } from "../actions";

async function CuentaPageContent({ params, searchParams }: PageProps<"/cuentas/[id]">) {
  const { id } = await params;
  const { ver } = await searchParams;
  const user = await requireUser();
  const wallet = await getWallet(user.id, id);
  if (!wallet) notFound();
  // ?ver=usd | ?ver=cuenta cambia cómo se ven los movimientos; por defecto, el ajuste del usuario
  const currency: MovementsCurrency =
    ver === "usd" ? "USD" : ver === "cuenta" ? "ORIGINAL" : (user.movementsCurrency as MovementsCurrency);
  const transactions = await listTransactions(user.id, { walletId: id });
  const hasLoans = transactions.some((t) => t.type === "LOAN_OUT" || t.type === "LOAN_IN");

  return (
    <>
      <PageHeader
        title={wallet.name}
        description={`${walletTypeLabel(wallet.type)} · ${wallet.currencyCode}${wallet.archived ? " · Archivada" : ""}`}
        actions={
          <Link href={`/movimientos/nuevo?cuenta=${wallet.id}`} className={buttonClass()}>
            Registrar movimiento
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm text-muted">Saldo actual</p>
            <p className="mt-1 text-3xl font-semibold">
              <Amount value={formatMoney(wallet.balance, wallet.currencyCode)} />
            </p>
            <p className="mt-1 text-xs text-muted">
              Saldo inicial {formatMoney(wallet.initialBalance, wallet.currencyCode)} · {transactions.length} movimientos
            </p>
            {!wallet.projected.eq(wallet.balance) && (
              <p className="mt-1 text-xs text-muted">
                Con los movimientos de fechas futuras: {formatMoney(wallet.projected, wallet.currencyCode)}
              </p>
            )}
          </Card>
          {wallet.currencyCode !== "USD" && transactions.length > 0 && (
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted">Movimientos</h2>
              <div className="flex rounded-lg border border-border p-0.5 text-xs font-medium">
                {(
                  [
                    ["cuenta", "ORIGINAL", wallet.currencyCode === "VES" ? "Bs." : wallet.currencyCode],
                    ["usd", "USD", "USD"],
                  ] as const
                ).map(([param, value, label]) => (
                  <Link
                    key={param}
                    href={`/cuentas/${wallet.id}?ver=${param}`}
                    replace
                    scroll={false}
                    className={cn(
                      "rounded-md px-3 py-1",
                      currency === value ? "bg-foreground text-background" : "text-muted hover:text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <TransactionList transactions={transactions} hideWallet currency={currency} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-4 font-semibold">Editar cuenta</h2>
            <ActionForm action={updateWallet.bind(null, wallet.id)} resetOnSuccess={false} className="flex flex-col gap-3">
              <WalletFields
                defaults={{
                  name: wallet.name,
                  type: wallet.type,
                  currencyCode: wallet.currencyCode,
                  initialBalance: wallet.initialBalance.toString(),
                  color: wallet.color,
                }}
              />
              <SubmitButton>Guardar</SubmitButton>
            </ActionForm>
          </Card>
          <Card className="flex flex-col gap-2">
            {wallet.archived || wallet.balance.isZero() ? (
              <ConfirmButton action={toggleArchiveWallet.bind(null, wallet.id)} variant="secondary" className="w-full">
                {wallet.archived ? "Desarchivar" : "Archivar"}
              </ConfirmButton>
            ) : (
              <p className="text-center text-xs text-muted">Para archivarla, deja el saldo en 0 (transfiere lo que tenga)</p>
            )}
            {hasLoans ? (
              <p className="text-center text-xs text-muted">
                Tiene préstamos: bórralos primero en Por cobrar o Deudas para poder borrar la cuenta
              </p>
            ) : (
              <ConfirmButton
                action={deleteWallet.bind(null, wallet.id)}
                confirm="¿Borrar la cuenta y TODOS sus movimientos? Esto no se puede deshacer."
                className="w-full"
              >
                Borrar cuenta
              </ConfirmButton>
            )}
            <Badge className="justify-center">Archivar la oculta sin perder el historial</Badge>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function CuentaPage(props: PageProps<"/cuentas/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CuentaPageContent {...props} />
    </Suspense>
  );
}
