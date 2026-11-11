import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { CURRENCIES } from "@/components/wallet-fields";
import { Amount, Badge, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getCategories, getRecurringIncome, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn } from "@/lib/utils";
import { createRecurringIncome, deleteRecurringIncome, toggleRecurringIncome, updateRecurringIncome } from "./actions";

async function IngresosFijosPageContent() {
  const user = await requireUser();
  const [items, wallets, categories, businesses, rates] = await Promise.all([
    getRecurringIncome(user.id),
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
  ]);
  const rate = pickRate(rates, user.preferredRateSource);
  const total = items
    .filter((i) => i.active)
    .reduce((acc, i) => {
      try {
        return acc.add(convert(i.amount, i.currencyCode, user.displayCurrency, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));

  return (
    <>
      <PageHeader title="Ingresos fijos" description="Lo que te entra cada mes (sueldo, alquileres, clientes fijos…)" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-muted">Total mensual</p>
          <p className="text-2xl font-semibold tabular text-positive">{formatMoney(total, user.displayCurrency)}</p>
        </Card>
        <Card className="flex flex-col justify-center">
          <p className="text-sm text-muted">¿Cuánto se llevan tus gastos fijos?</p>
          <Link href="/presupuesto" className="text-sm font-medium text-accent hover:underline">
            Ver presupuesto
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {items.length === 0 ? (
            <EmptyState>No tienes ingresos fijos. Agrega tu sueldo, honorarios, alquileres…</EmptyState>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-border">
                {items.map((r) => (
                  <li key={r.id} className={cn("relative px-4 py-3", !r.active && "opacity-50")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted">
                          Día {r.dayOfMonth}
                          {r.category && ` · ${r.category.name}`}
                          {r.business && ` · ${r.business.name}`}
                          {r.wallet && ` · ${r.wallet.name}`}
                        </p>
                      </div>
                      {!r.active && <Badge>Pausado</Badge>}
                      <Amount className="font-medium text-positive" value={formatMoney(r.amount, r.currencyCode)} />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <details className="group">
                        <summary className="flex h-8 cursor-pointer list-none items-center px-3 text-xs text-muted hover:text-foreground">
                          Editar
                        </summary>
                        <div className="absolute left-4 right-4 z-10 mt-2 rounded-xl border border-border bg-surface p-4 shadow-lg sm:left-auto sm:w-80">
                          <ActionForm action={updateRecurringIncome.bind(null, r.id)} resetOnSuccess={false} className="flex flex-col gap-3">
                            <IncomeFields wallets={wallets} categories={categories} businesses={businesses} defaults={r} />
                            <SubmitButton>Guardar</SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                      <ConfirmButton action={toggleRecurringIncome.bind(null, r.id)} variant="ghost" className="h-8 text-xs text-muted">
                        {r.active ? "Pausar" : "Activar"}
                      </ConfirmButton>
                      <ConfirmButton
                        action={deleteRecurringIncome.bind(null, r.id)}
                        confirm="¿Eliminar este ingreso fijo?"
                        variant="ghost"
                        className="h-8 text-xs"
                      >
                        Eliminar
                      </ConfirmButton>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nuevo ingreso fijo</h2>
          <ActionForm action={createRecurringIncome} className="flex flex-col gap-3">
            <IncomeFields wallets={wallets} categories={categories} businesses={businesses} />
            <SubmitButton>Crear</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

type IncomeDefaults = {
  name: string;
  amount: Decimal;
  currencyCode: string;
  dayOfMonth: number;
  walletId: string | null;
  categoryId: string | null;
  businessId: string | null;
};

function IncomeFields({
  wallets,
  categories,
  businesses,
  defaults,
}: {
  wallets: { id: string; name: string }[];
  categories: { id: string; name: string; kind: string }[];
  businesses: { id: string; name: string }[];
  defaults?: IncomeDefaults;
}) {
  return (
    <>
      <Field label="Nombre">
        <Input name="name" required placeholder="Ej. Sueldo, Cliente X…" defaultValue={defaults?.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monto">
          <Input name="amount" required inputMode="decimal" placeholder="0,00" defaultValue={defaults?.amount.toFixed(2)} />
        </Field>
        <Field label="Divisa">
          <Select name="currencyCode" defaultValue={defaults?.currencyCode ?? "USD"}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Día del mes en que cobras">
        <Input name="dayOfMonth" type="number" min={1} max={31} required defaultValue={defaults?.dayOfMonth ?? 1} />
      </Field>
      <Field label="Cuenta donde entra">
        <Select name="walletId" defaultValue={defaults?.walletId ?? ""}>
          <option value="">—</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Categoría">
        <Select name="categoryId" defaultValue={defaults?.categoryId ?? ""}>
          <option value="">—</option>
          {categories
            .filter((c) => c.kind === "INCOME")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Negocio">
        <Select name="businessId" defaultValue={defaults?.businessId ?? ""}>
          <option value="">Personal</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

export default function IngresosFijosPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IngresosFijosPageContent />
    </Suspense>
  );
}
