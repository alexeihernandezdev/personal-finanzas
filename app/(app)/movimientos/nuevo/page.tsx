import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { TransactionForm } from "@/components/transaction-form";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getBusinesses, getCategories, getWalletsWithBalance } from "@/lib/queries";
import { todayISO } from "@/lib/utils";
import { createTransaction } from "../actions";

async function NuevoMovimientoPageContent({ searchParams }: PageProps<"/movimientos/nuevo">) {
  const { cuenta } = await searchParams;
  const user = await requireUser();
  const [wallets, categories, businesses] = await Promise.all([
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
  ]);

  return (
    <>
      <PageHeader title="Nuevo movimiento" description="Registra un ingreso o un gasto" />
      {wallets.length === 0 ? (
        <EmptyState>
          Primero crea una cuenta.{" "}
          <Link href="/cuentas" className={buttonClass("secondary", "ml-2")}>
            Ir a cuentas
          </Link>
        </EmptyState>
      ) : (
        <Card className="max-w-2xl">
          <TransactionForm
            action={createTransaction}
            wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
            categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
            businesses={businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
            today={todayISO()}
            defaultWalletId={typeof cuenta === "string" ? cuenta : undefined}
            submitLabel="Registrar"
          />
        </Card>
      )}
    </>
  );
}

export default function NuevoMovimientoPage(props: PageProps<"/movimientos/nuevo">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NuevoMovimientoPageContent {...props} />
    </Suspense>
  );
}
