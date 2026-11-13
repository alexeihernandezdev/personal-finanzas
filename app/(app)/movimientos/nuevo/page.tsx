import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { TransactionForm } from "@/components/transaction-form";
import { TransferForm } from "@/components/transfer-form";
import { buttonClass, Card, EmptyState, PageHeader, SectionSwitch } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getCurrentRates, pickRate, serializeRates } from "@/lib/rates";
import { getBusinesses, getCategories, getPocketChoices, getWalletsWithBalance } from "@/lib/queries";
import { todayISO } from "@/lib/utils";
import { createTransaction } from "../actions";
import { createTransfer } from "../transfer-actions";

const MOVEMENT = "/movimientos/nuevo";
const TRANSFER = "/movimientos/nuevo?tipo=transferencia";

async function NuevoMovimientoPageContent({ searchParams }: PageProps<"/movimientos/nuevo">) {
  const { cuenta, tipo } = await searchParams;
  const isTransfer = tipo === "transferencia";
  const user = await requireUser();
  const rates = await getCurrentRates();
  const [wallets, categories, businesses, pockets] = await Promise.all([
    getWalletsWithBalance(user.id),
    getCategories(user.id),
    getBusinesses(user.id),
    getPocketChoices(user.id, pickRate(rates, user.preferredRateSource)),
  ]);

  return (
    <>
      <SectionSwitch
        items={[
          { href: MOVEMENT, label: "Ingreso o gasto" },
          { href: TRANSFER, label: "Transferencia" },
        ]}
        current={isTransfer ? TRANSFER : MOVEMENT}
      />
      <PageHeader
        title={isTransfer ? "Nueva transferencia" : "Nuevo movimiento"}
        description={isTransfer ? "Mueve dinero entre tus cuentas, incluso entre divisas" : "Registra un ingreso o un gasto"}
      />
      {wallets.length === 0 ? (
        <EmptyState>
          Primero crea una cuenta.{" "}
          <Link href="/cuentas" className={buttonClass("secondary", "ml-2")}>
            Ir a cuentas
          </Link>
        </EmptyState>
      ) : isTransfer ? (
        <Card className="max-w-2xl">
          {wallets.length < 2 ? (
            <EmptyState>Necesitas al menos dos cuentas para transferir.</EmptyState>
          ) : (
            <TransferForm
              action={createTransfer}
              wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode, balance: w.balance.toString() }))}
              today={todayISO()}
            />
          )}
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <TransactionForm
            action={createTransaction}
            wallets={wallets.map((w) => ({ id: w.id, name: w.name, currencyCode: w.currencyCode }))}
            categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
            businesses={businesses.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
            pockets={pockets}
            today={todayISO()}
            rates={serializeRates(rates)}
            rateSource={user.preferredRateSource}
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
