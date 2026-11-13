import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { TransactionList } from "@/components/transaction-list";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { buttonClass, Field, Input, PageHeader, Select } from "@/components/ui";
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
  const advancedCount = [filters.walletId, filters.categoryId, filters.businessId, filters.type, filters.from || filters.to].filter(
    Boolean,
  ).length;

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
      <form className="mb-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input name="q" type="search" placeholder="Buscar descripción…" defaultValue={filters.q} className="pl-9" />
          </div>
          <button className={buttonClass("primary", "px-4")}>Buscar</button>
        </div>
        <details className="group rounded-2xl border border-border bg-surface" open={advancedCount > 0}>
          <summary className="flex min-h-11 items-center gap-2 px-4 text-sm font-medium">
            <SlidersHorizontal className="size-4 text-muted" />
            Filtros
            {advancedCount > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] text-white dark:text-black">
                {advancedCount}
              </span>
            )}
            <ChevronDown className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-3 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select name="tipo" defaultValue={filters.type ?? ""} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              <option value="INCOME">Ingresos</option>
              <option value="EXPENSE">Gastos</option>
              <option value="TRANSFER">Transferencias</option>
              <option value="LOAN">Préstamos</option>
            </Select>
            <Select name="cuenta" defaultValue={filters.walletId ?? ""} aria-label="Cuenta">
              <option value="">Todas las cuentas</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Select name="categoria" defaultValue={filters.categoryId ?? ""} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind === "INCOME" ? "↑" : "↓"} {c.name}
                </option>
              ))}
            </Select>
            <Select name="negocio" defaultValue={filters.businessId ?? ""} aria-label="Negocio">
              <option value="">Todos los negocios</option>
              <option value="personal">Personal</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <Field label="Desde">
                <Input name="desde" type="date" defaultValue={filters.from} />
              </Field>
              <Field label="Hasta">
                <Input name="hasta" type="date" defaultValue={filters.to} />
              </Field>
            </div>
            <div className="flex gap-2 sm:col-span-2 sm:items-end">
              <button className={buttonClass("secondary", "flex-1")}>Aplicar filtros</button>
              {hasFilters && (
                <Link href="/movimientos" className={buttonClass("ghost")}>
                  Limpiar
                </Link>
              )}
            </div>
          </div>
        </details>
      </form>
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
