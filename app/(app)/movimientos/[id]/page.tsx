import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { notFound, redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/action-form";
import { TransactionForm } from "@/components/transaction-form";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { getCurrentRates, pickRate, serializeRates } from "@/lib/rates";
import { getBusinesses, getCategories, getPocketChoices, getWalletsWithBalance } from "@/lib/queries";
import { toISODate, todayISO } from "@/lib/utils";
import { deleteTransaction, updateTransaction } from "../actions";

async function EditarMovimientoPageContent({ params }: PageProps<"/movimientos/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const tx = await prisma.transaction.findFirst({
    where: { id, userId: user.id, type: { in: ["INCOME", "EXPENSE"] } },
    include: {
      pocketMovements: {
        where: { groupId: { not: null } },
        include: { pocket: { select: { isMain: true, businessId: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!tx) notFound();
  const rates = await getCurrentRates();
  const [wallets, categories, businesses, pockets] = await Promise.all([
    getWalletsWithBalance(user.id, { includeArchived: true }),
    getCategories(user.id),
    getBusinesses(user.id),
    getPocketChoices(user.id, pickRate(rates, user.preferredRateSource)),
  ]);

  // Qué apartado se eligió al registrarlo: el primer movimiento de apartado que generó
  const first = tx.pocketMovements[0];
  const pocketId = !first
    ? ""
    : first.pocket.isMain && first.pocket.businessId === tx.businessId
      ? "auto"
      : first.pocketId;
  // En un ingreso, las salidas de una Caja solo las genera el reparto automático
  const distributed = !first || tx.pocketMovements.some((m) => m.amount.isNegative());

  async function deleteAndReturn() {
    "use server";
    await deleteTransaction(id);
    redirect("/movimientos");
  }

  return (
    <>
      <PageHeader
        title="Editar movimiento"
        actions={
          <ConfirmButton action={deleteAndReturn} confirm="¿Borrar este movimiento?" variant="danger" className="w-full">
            <Trash2 className="size-4" />
            Borrar
          </ConfirmButton>
        }
      />
      <Card className="max-w-2xl">
        <TransactionForm
          action={updateTransaction.bind(null, tx.id)}
          wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          businesses={businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
          pockets={pockets}
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
            businessId: tx.businessId,
            pocketId,
            distribute: distributed,
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
