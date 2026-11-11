import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { notFound } from "next/navigation";
import { TransactionForm } from "@/components/transaction-form";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { getCurrentRates, serializeRates } from "@/lib/rates";
import { getBusinesses, getCategories, getWalletsWithBalance } from "@/lib/queries";
import { toISODate, todayISO } from "@/lib/utils";
import { updateTransaction } from "../actions";

async function EditarMovimientoPageContent({ params }: PageProps<"/movimientos/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const tx = await prisma.transaction.findFirst({
    where: { id, userId: user.id, type: { in: ["INCOME", "EXPENSE"] } },
    include: { splits: true },
  });
  if (!tx) notFound();
  const [wallets, categories, businesses, rates] = await Promise.all([
    getWalletsWithBalance(user.id, { includeArchived: true }),
    getCategories(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
  ]);

  return (
    <>
      <PageHeader
        title="Editar movimiento"
        actions={
          tx.type === "INCOME" && (
            <Link href={`/presupuesto?repartir=${tx.id}`} className={buttonClass("secondary")}>
              Repartir en apartados
            </Link>
          )
        }
      />
      <Card className="max-w-2xl">
        <TransactionForm
          action={updateTransaction.bind(null, tx.id)}
          wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          businesses={businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
          today={todayISO()}
          rates={serializeRates(rates)}
          rateSource={user.preferredRateSource}
          defaults={{
            type: tx.type as "INCOME" | "EXPENSE",
            walletId: tx.walletId,
            amount: tx.amount.toFixed(2),
            date: toISODate(tx.date),
            categoryId: tx.categoryId,
            description: tx.description,
            splits: tx.splits.map((s) => ({ businessId: s.businessId, amount: s.amount.toFixed(2) })),
          }}
          submitLabel="Guardar cambios"
        />
      </Card>
    </>
  );
}

export default function EditarMovimientoPage(props: PageProps<"/movimientos/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditarMovimientoPageContent {...props} />
    </Suspense>
  );
}
