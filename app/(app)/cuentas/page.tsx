import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Amount, Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { WalletFields, walletTypeLabel } from "@/components/wallet-fields";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getMoneySummary, getWalletsWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { createWallet } from "./actions";

async function CuentasPageContent() {
  const user = await requireUser();
  const rate = pickRate(await getCurrentRates(), user.preferredRateSource);
  const [wallets, summary] = await Promise.all([
    getWalletsWithBalance(user.id, { includeArchived: true }),
    getMoneySummary(user.id, user.displayCurrency, rate),
  ]);
  const active = wallets.filter((w) => !w.archived);
  const archived = wallets.filter((w) => w.archived);
  const sumDisplay = (pick: (w: (typeof active)[number]) => Decimal) =>
    active.reduce((acc, w) => {
      try {
        return acc.add(convert(pick(w), w.currencyCode, user.displayCurrency, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));
  const total = sumDisplay((w) => w.balance);
  const { available } = summary;

  return (
    <>
      <PageHeader
        title="Cuentas"
        description={`Total: ${formatMoney(total, user.displayCurrency)} · Disponible: ${formatMoney(available, user.displayCurrency)} (tasa ${user.preferredRateSource === "BCV" ? "BCV" : "Binance"})`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {active.length === 0 ? (
            <EmptyState>Todavía no tienes cuentas. Crea la primera con el formulario.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {active.map((w) => (
                <WalletCard key={w.id} wallet={w} />
              ))}
            </div>
          )}
          {archived.length > 0 && (
            <div>
              <SectionTitle>Archivadas</SectionTitle>
              <div className="grid gap-3 opacity-70 sm:grid-cols-2">
                {archived.map((w) => (
                  <WalletCard key={w.id} wallet={w} />
                ))}
              </div>
            </div>
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nueva cuenta</h2>
          <ActionForm action={createWallet} className="flex flex-col gap-3">
            <WalletFields />
            <SubmitButton>Crear cuenta</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function WalletCard({
  wallet,
}: {
  wallet: {
    id: string;
    name: string;
    type: string;
    currencyCode: string;
    color: string;
    balance: Decimal;
  };
}) {
  return (
    <Link href={`/cuentas/${wallet.id}`} className="group">
      <Card className="relative overflow-hidden transition group-hover:border-accent">
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: wallet.color }} />
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{wallet.name}</p>
            <p className="text-xs text-muted">{walletTypeLabel(wallet.type)}</p>
          </div>
          <Badge>{wallet.currencyCode}</Badge>
        </div>
        <p className="mt-4 text-2xl font-semibold">
          <Amount value={formatMoney(wallet.balance, wallet.currencyCode)} />
        </p>
      </Card>
    </Link>
  );
}

export default function CuentasPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CuentasPageContent />
    </Suspense>
  );
}
