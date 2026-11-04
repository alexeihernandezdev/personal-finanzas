import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { TransactionList } from "@/components/transaction-list";
import { buttonClass, Card, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getBusinesses, getCategories, getWalletsWithBalance, listTransactions } from "@/lib/queries";

async function MovimientosPageContent({ searchParams }: PageProps<"/movimientos">) {
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters = {
    walletId: get("cuenta"),
    categoryId: get("categoria"),
    businessId: get("negocio"),
    type: get("tipo"),
    from: get("desde"),
    to: get("hasta"),
    q: get("q"),
  };
  const user = await requireUser();
  const [transactions, wallets, categories, businesses] = await Promise.all([
    listTransactions(user.id, filters),
    getWalletsWithBalance(user.id, { includeArchived: true }),
    getCategories(user.id),
    getBusinesses(user.id),
  ]);
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Movimientos"
        description="Ingresos, gastos, transferencias y préstamos"
        actions={
          <Link href="/movimientos/nuevo" className={buttonClass()}>
            Nuevo movimiento
          </Link>
        }
      />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input name="q" placeholder="Buscar descripción…" defaultValue={filters.q} />
          <Select name="tipo" defaultValue={filters.type ?? ""}>
            <option value="">Todos los tipos</option>
            <option value="INCOME">Ingresos</option>
            <option value="EXPENSE">Gastos</option>
            <option value="TRANSFER">Transferencias</option>
            <option value="LOAN">Préstamos</option>
          </Select>
          <Select name="cuenta" defaultValue={filters.walletId ?? ""}>
            <option value="">Todas las cuentas</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Select name="categoria" defaultValue={filters.categoryId ?? ""}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "INCOME" ? "↑" : "↓"} {c.name}
              </option>
            ))}
          </Select>
          <Select name="negocio" defaultValue={filters.businessId ?? ""}>
            <option value="">Todos los negocios</option>
            <option value="personal">Personal</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Input name="desde" type="date" defaultValue={filters.from} title="Desde" />
          <Input name="hasta" type="date" defaultValue={filters.to} title="Hasta" />
          <div className="flex gap-2">
            <button className={buttonClass("secondary", "flex-1")}>Filtrar</button>
            {hasFilters && (
              <Link href="/movimientos" className={buttonClass("ghost")}>
                Limpiar
              </Link>
            )}
          </div>
        </form>
      </Card>
      <TransactionList transactions={transactions} />
      {transactions.length === 200 && (
        <p className="mt-2 text-center text-xs text-muted">Se muestran los 200 más recientes. Usa los filtros para acotar.</p>
      )}
    </>
  );
}

export default function MovimientosPage(props: PageProps<"/movimientos">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MovimientosPageContent {...props} />
    </Suspense>
  );
}
