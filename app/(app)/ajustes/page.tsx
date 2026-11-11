import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, PageHeader, Select } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import type { ActionState } from "@/lib/action";

const settingsSchema = z.object({
  displayCurrency: z.enum(["USD", "VES"]),
  preferredRateSource: z.enum(["BCV", "BINANCE"]),
  movementsCurrency: z.enum(["USD", "ORIGINAL"]),
  movementsRateSource: z.enum(["BCV", "BINANCE"]),
});

async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  "use server";
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "Ajustes guardados" };
}

async function AjustesPageContent() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Ajustes" />
      <Card className="max-w-md">
        <ActionForm action={saveSettings} resetOnSuccess={false} className="flex flex-col gap-4">
          <Field label="Moneda para totales" hint="En qué moneda ves el patrimonio y los reportes">
            <Select name="displayCurrency" defaultValue={user.displayCurrency}>
              <option value="USD">Dólares (USD)</option>
              <option value="VES">Bolívares (VES)</option>
            </Select>
          </Field>
          <Field
            label="Tasa de referencia"
            hint="Se usa para convertir entre USD y VES y se guarda en cada movimiento nuevo"
          >
            <Select name="preferredRateSource" defaultValue={user.preferredRateSource}>
              <option value="BCV">BCV (oficial)</option>
              <option value="BINANCE">Binance P2P (promedio compra/venta)</option>
            </Select>
          </Field>
          <Field
            label="Ver movimientos en"
            hint="Los movimientos se registran en la divisa de la cuenta; aquí eliges cómo verlos"
          >
            <Select name="movementsCurrency" defaultValue={user.movementsCurrency}>
              <option value="USD">Dólares (USD)</option>
              <option value="ORIGINAL">Moneda de la cuenta</option>
            </Select>
          </Field>
          <Field
            label="Tasa para ver movimientos en dólares"
            hint="Se usa la tasa del día de cada movimiento"
          >
            <Select name="movementsRateSource" defaultValue={user.movementsRateSource}>
              <option value="BCV">BCV (oficial)</option>
              <option value="BINANCE">Binance P2P (promedio compra/venta)</option>
            </Select>
          </Field>
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

export default function AjustesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AjustesPageContent />
    </Suspense>
  );
}
