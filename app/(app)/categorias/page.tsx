import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { NamedItemRow } from "@/components/named-item-row";
import { Card, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getCategories } from "@/lib/queries";
import { createCategory, renameCategory, toggleArchiveCategory } from "./actions";

async function CategoriasPageContent() {
  const user = await requireUser();
  const categories = await getCategories(user.id, { includeArchived: true });

  return (
    <>
      <PageHeader title="Categorías" description="Organiza tus ingresos y gastos" />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="grid gap-6 md:grid-cols-2">
          {(["INCOME", "EXPENSE"] as const).map((kind) => (
            <div key={kind}>
              <SectionTitle>{kind === "INCOME" ? "Ingresos" : "Gastos"}</SectionTitle>
              <Card className="p-0">
                <ul className="divide-y divide-border">
                  {categories
                    .filter((c) => c.kind === kind)
                    .map((c) => (
                      <NamedItemRow
                        key={c.id}
                        item={c}
                        rename={renameCategory.bind(null, c.id)}
                        toggleArchive={toggleArchiveCategory.bind(null, c.id)}
                      />
                    ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nueva categoría</h2>
          <ActionForm action={createCategory} className="flex flex-col gap-3">
            <Field label="Nombre">
              <Input name="name" required />
            </Field>
            <Field label="Tipo">
              <Select name="kind" defaultValue="EXPENSE">
                <option value="EXPENSE">Gasto</option>
                <option value="INCOME">Ingreso</option>
              </Select>
            </Field>
            <Field label="Color">
              <Input name="color" type="color" defaultValue="#64748b" className="p-1" />
            </Field>
            <SubmitButton>Crear</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

export default function CategoriasPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CategoriasPageContent />
    </Suspense>
  );
}
