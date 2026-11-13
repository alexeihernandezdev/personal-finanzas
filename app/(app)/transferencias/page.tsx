import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { TransactionList } from "@/components/transaction-list";
import { TransferForm } from "@/components/transfer-form";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getWalletsWithBalance, listTransactions } from "@/lib/queries";
import { todayISO } from "@/lib/utils";
import { createTransfer } from "./actions";

async function TransferenciasPageContent() {
  const user = await requireUser();
  const [wallets, recent] = await Promise.all([
    getWalletsWithBalance(user.id),
    listTransactions(user.id, { type: "TRANSFER" }, 30),
  ]);

  return (
    <>
      <PageHeader title="Transferencias" description="Mueve dinero entre tus cuentas, incluso entre divisas" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="h-fit">
          {wallets.length < 2 ? (
            <EmptyState>Necesitas al menos dos cuentas para transferir.</EmptyState>
          ) : (
            <TransferForm
              action={createTransfer}
              wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode, balance: w.balance.toString() }))}
              today={todayISO()}
            />
          )}
        </Card>
        <div>
          <SectionTitle>Recientes</SectionTitle>
          <TransactionList transactions={recent} />
        </div>
      </div>
    </>
  );
}

export default function TransferenciasPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TransferenciasPageContent />
    </Suspense>
  );
}
