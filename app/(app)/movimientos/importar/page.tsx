import { Suspense } from "react";
import Link from "next/link";
import { ImportWizard } from "@/components/import/import-wizard";
import { PageSkeleton } from "@/components/page-skeleton";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getBusinesses, getCategories, getDebts, getReceivables, getWalletsWithBalance } from "@/lib/queries";

async function ImportarPageContent() {
  const user = await requireUser();
  const [wallets, categories, businesses, debts, receivables] = await Promise.all([
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
    getDebts(user.id, { onlyOpen: true }),
    getReceivables(user.id, { onlyOpen: true }),
  ]);
  const ledger = (r: { id: string; kind: string; counterparty: string; description: string; currencyCode: string; remaining: { toString(): string } }) => ({
    id: r.id,
    name: `${r.counterparty}${r.description ? ` · ${r.description}` : ""}`,
    loan: r.kind === "LOAN_RECEIVED" || r.kind === "LOAN_GIVEN",
    currencyCode: r.currencyCode,
    remaining: r.remaining.toString(),
  });

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
          debts={debts.filter((d) => Number(d.remaining) > 0).map(ledger)}
          receivables={receivables.filter((r) => Number(r.remaining) > 0).map(ledger)}
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
