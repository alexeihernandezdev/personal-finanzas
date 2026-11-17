import { Suspense } from "react";
import Link from "next/link";
import { ImportWizard } from "@/components/import/import-wizard";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getBusinesses, getCategories, getWalletsWithBalance } from "@/lib/queries";

async function ImportarPageContent() {
  const user = await requireUser();
  const [wallets, categories, businesses] = await Promise.all([
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Importar movimientos"
        description="Sube capturas de tu banco: se leen los movimientos, los revisas y se guardan"
        actions={
          <Link href="/movimientos" className={buttonClass("ghost")}>
            Volver
          </Link>
        }
      />
      {wallets.length === 0 ? (
        <EmptyState>
          Primero crea una cuenta.{" "}
          <Link href="/cuentas" className={buttonClass("secondary", "ml-2")}>
            Ir a cuentas
          </Link>
        </EmptyState>
      ) : (
        <ImportWizard
          wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        />
      )}
    </>
  );
}

export default function ImportarPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportarPageContent />
    </Suspense>
  );
}
