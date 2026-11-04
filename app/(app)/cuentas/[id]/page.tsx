import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { TransactionList } from "@/components/transaction-list";
import { Amount, Badge, buttonClass, Card, PageHeader } from "@/components/ui";
import { WalletFields, walletTypeLabel } from "@/components/wallet-fields";
import { requireUser } from "@/lib/dal";
import { formatMoney } from "@/lib/money";
import { getWallet, listTransactions } from "@/lib/queries";
import { deleteWallet, toggleArchiveWallet, updateWallet } from "../actions";

async function CuentaPageContent({ params }: PageProps<"/cuentas/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const wallet = await getWallet(user.id, id);
  if (!wallet) notFound();
  const transactions = await listTransactions(user.id, { walletId: id });

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
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm text-muted">Saldo actual</p>
            <p className="mt-1 text-3xl font-semibold">
              <Amount value={formatMoney(wallet.balance, wallet.currencyCode)} />
            </p>
            <p className="mt-1 text-xs text-muted">
              Saldo inicial {formatMoney(wallet.initialBalance, wallet.currencyCode)} · {transactions.length} movimientos
            </p>
          </Card>
          <TransactionList transactions={transactions} hideWallet />
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
            <ConfirmButton action={toggleArchiveWallet.bind(null, wallet.id)} variant="secondary" className="w-full">
              {wallet.archived ? "Desarchivar" : "Archivar"}
            </ConfirmButton>
            <ConfirmButton
              action={deleteWallet.bind(null, wallet.id)}
              confirm="¿Borrar la cuenta y TODOS sus movimientos? Esto no se puede deshacer."
              className="w-full"
            >
              Borrar cuenta
            </ConfirmButton>
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
