import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { NamedItemRow } from "@/components/named-item-row";
import { Card, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getBusinesses } from "@/lib/queries";
import { createBusiness, renameBusiness, toggleArchiveBusiness } from "../categorias/actions";

async function NegociosPageContent() {
  const user = await requireUser();
  const businesses = await getBusinesses(user.id, { includeArchived: true });

  return (
    <>
      <PageHeader
        title="Negocios"
        description="Emprendimientos a los que puedes asignar o repartir ingresos y gastos"
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          {businesses.length === 0 ? (
            <EmptyState>
              Aún no tienes negocios. Lo que no asignes a ningún negocio cuenta como <strong>Personal</strong>.
            </EmptyState>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-border">
                {businesses.map((b) => (
                  <NamedItemRow
                    key={b.id}
                    item={b}
                    rename={renameBusiness.bind(null, b.id)}
                    toggleArchive={toggleArchiveBusiness.bind(null, b.id)}
                  />
                ))}
              </ul>
            </Card>
          )}
          <p className="mt-3 text-sm text-muted">
            Mira el resultado de cada negocio en{" "}
            <Link href="/reportes" className="text-accent hover:underline">
              Reportes
            </Link>
            .
          </p>
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nuevo negocio</h2>
          <ActionForm action={createBusiness} className="flex flex-col gap-3">
            <Field label="Nombre">
              <Input name="name" required placeholder="Ej. Tienda online" />
            </Field>
            <Field label="Color">
              <Input name="color" type="color" defaultValue="#6366f1" className="p-1" />
            </Field>
            <SubmitButton>Crear</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

export default function NegociosPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NegociosPageContent />
    </Suspense>
  );
}
