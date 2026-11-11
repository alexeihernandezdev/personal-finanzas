import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { PocketFields, pocketKindLabel } from "@/components/pocket-fields";
import { Amount, Badge, Card, EmptyState, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getPockets, getWalletsWithBalance, type PocketWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { formatDate, toISODate, todayISO } from "@/lib/utils";
import { createPocket, deletePocket, deletePocketMovement, movePocketMoney, toggleArchivePocket, updatePocket } from "./actions";

type WalletOption = { id: string; name: string; currencyCode: string; availableLabel: string };
type BusinessOption = { id: string; name: string };

async function ApartadosPageContent() {
  const user = await requireUser();
  const [wallets, pockets, businesses, rates] = await Promise.all([
    getWalletsWithBalance(user.id),
    getPockets(user.id),
    getBusinesses(user.id),
    getCurrentRates(),
  ]);
  const rate = pickRate(rates, user.preferredRateSource);
  const cur = user.displayCurrency;
  const sum = (values: { amount: Decimal; currency: string }[]) =>
    values.reduce((acc, v) => {
      try {
        return acc.add(convert(v.amount, v.currency, cur, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));
  const total = sum(wallets.map((w) => ({ amount: w.balance, currency: w.currencyCode })));
  const reserved = sum(wallets.map((w) => ({ amount: w.reserved, currency: w.currencyCode })));
  const available = total.sub(reserved);

  const walletOptions: WalletOption[] = wallets.map((w) => ({
    id: w.id,
    name: w.name,
    currencyCode: w.currencyCode,
    availableLabel: formatMoney(w.available, w.currencyCode),
  }));
  const businessOptions: BusinessOption[] = businesses.map((b) => ({ id: b.id, name: b.name }));

  const active = pockets.filter((p) => !p.archived);
  const archived = pockets.filter((p) => p.archived);
  // Agrupa por dueño del dinero: Personal primero y luego cada negocio
  const groups = new Map<string, { name: string; pockets: PocketWithBalance[] }>([["personal", { name: "Personal", pockets: [] }]]);
  for (const p of active) {
    const key = p.businessId ?? "personal";
    const g = groups.get(key) ?? { name: p.business?.name ?? "Personal", pockets: [] };
    g.pockets.push(p);
    groups.set(key, g);
  }
  const overdrawn = wallets.filter((w) => w.available.isNegative());

  return (
    <>
      <PageHeader title="Apartados" description="Separa el dinero que no debes tocar: ahorros, metas y reservas" />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">En cuentas</p>
          <p className="mt-1 text-2xl font-semibold tabular">{formatMoney(total, cur)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Apartado</p>
          <p className="mt-1 text-2xl font-semibold tabular">{formatMoney(reserved, cur)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Disponible para usar</p>
          <p className="mt-1 text-2xl font-semibold">
            <Amount value={formatMoney(available, cur)} />
          </p>
        </Card>
      </div>
      {overdrawn.length > 0 && (
        <p role="alert" className="mb-6 rounded-lg bg-negative/10 px-4 py-3 text-sm text-negative">
          Gastaste dinero apartado en {overdrawn.map((w) => w.name).join(", ")}. Libera parte de un apartado o repón el saldo.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {active.length === 0 && (
            <EmptyState>
              Todavía no tienes apartados. Crea uno para separar dinero de una cuenta sin moverlo de ahí.
            </EmptyState>
          )}
          {[...groups.entries()]
            .filter(([, g]) => g.pockets.length > 0)
            .map(([key, g]) => (
              <section key={key}>
                <SectionTitle>{g.name}</SectionTitle>
                <div className="flex flex-col gap-3">
                  {g.pockets.map((p) => (
                    <PocketCard key={p.id} pocket={p} wallets={walletOptions} businesses={businessOptions} />
                  ))}
                </div>
              </section>
            ))}
          {archived.length > 0 && (
            <section>
              <SectionTitle>Archivados</SectionTitle>
              <div className="flex flex-col gap-3 opacity-70">
                {archived.map((p) => (
                  <PocketCard key={p.id} pocket={p} wallets={walletOptions} businesses={businessOptions} />
                ))}
              </div>
            </section>
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nuevo apartado</h2>
          {wallets.length === 0 ? (
            <p className="text-sm text-muted">Primero crea una cuenta.</p>
          ) : (
            <ActionForm action={createPocket} className="flex flex-col gap-3">
              <PocketFields wallets={walletOptions} businesses={businessOptions} />
              <Field label="Apartar ahora" hint="Opcional: sale de lo disponible en la cuenta">
                <Input name="initialAmount" inputMode="decimal" placeholder="0,00" />
              </Field>
              <SubmitButton>Crear apartado</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}

function PocketCard({
  pocket: p,
  wallets,
  businesses,
}: {
  pocket: PocketWithBalance;
  wallets: WalletOption[];
  businesses: BusinessOption[];
}) {
  const currency = p.wallet.currencyCode;
  const target = p.targetAmount ? new Decimal(p.targetAmount.toString()) : null;
  const pct = target && target.gt(0) ? Math.min(100, p.balance.div(target).mul(100).toNumber()) : null;
  const today = todayISO();
  // El select de edición necesita la cuenta actual aunque esté archivada
  const walletChoices = wallets.some((w) => w.id === p.walletId)
    ? wallets
    : [{ id: p.walletId, name: p.wallet.name, currencyCode: currency, availableLabel: "—" }, ...wallets];

  return (
    <Card className="relative overflow-hidden">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: p.color }} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-muted">
            {pocketKindLabel(p.kind)} · en {p.wallet.name}
            {p.targetDate && ` · para el ${formatDate(p.targetDate)}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold">
            <Amount value={formatMoney(p.balance, currency)} />
          </p>
          {target && <p className="text-xs text-muted">de {formatMoney(target, currency)}</p>}
        </div>
      </div>
      {pct !== null && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
            <div className="h-full" style={{ width: `${pct}%`, background: p.color }} />
          </div>
          <span className="text-xs tabular text-muted">{pct.toFixed(0)}%</span>
          {pct >= 100 && <Badge className="bg-positive/10 text-positive">¡Meta cumplida!</Badge>}
        </div>
      )}

      {!p.archived && (
        <ActionForm action={movePocketMoney} className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input type="hidden" name="pocketId" value={p.id} />
          <Select name="direction" className="h-8 w-28 text-xs" defaultValue="IN">
            <option value="IN">Apartar</option>
            <option value="OUT">Liberar</option>
          </Select>
          <Input name="amount" inputMode="decimal" placeholder="Monto" required className="h-8 w-28 text-xs" />
          <Input name="date" type="date" defaultValue={today} className="h-8 w-36 text-xs" />
          <Input name="description" placeholder="Nota (opcional)" maxLength={200} className="h-8 min-w-32 flex-1 text-xs" />
          <SubmitButton variant="secondary" className="h-8 text-xs">
            Guardar
          </SubmitButton>
        </ActionForm>
      )}

      {p.movements.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-foreground">Últimos movimientos</summary>
          <ul className="mt-2 divide-y divide-border">
            {p.movements.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-1.5">
                <span className="w-24 text-muted">{formatDate(m.date)}</span>
                <span className="flex-1 truncate">{m.description || (m.amount.isNegative() ? "Liberado" : "Apartado")}</span>
                <Amount value={formatMoney(m.amount.toString(), currency, { sign: true })} />
                <ConfirmButton
                  action={deletePocketMovement.bind(null, m.id)}
                  confirm="¿Eliminar este movimiento del apartado?"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                >
                  ✕
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-foreground">Editar</summary>
        <div className="mt-3 flex flex-col gap-3">
          <ActionForm action={updatePocket.bind(null, p.id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
            <PocketFields
              wallets={walletChoices}
              businesses={businesses}
              defaults={{
                name: p.name,
                kind: p.kind,
                walletId: p.walletId,
                businessId: p.businessId ?? "",
                targetAmount: target ? target.toFixed(2) : "",
                targetDate: p.targetDate ? toISODate(p.targetDate) : "",
                color: p.color,
              }}
            />
            <SubmitButton className="sm:col-span-2">Guardar cambios</SubmitButton>
          </ActionForm>
          <div className="flex flex-wrap gap-2">
            {(p.archived || p.balance.isZero()) && (
              <ConfirmButton action={toggleArchivePocket.bind(null, p.id)} variant="secondary" className="h-8 text-xs">
                {p.archived ? "Restaurar" : "Archivar"}
              </ConfirmButton>
            )}
            <ConfirmButton
              action={deletePocket.bind(null, p.id)}
              confirm="¿Eliminar el apartado? Su dinero vuelve a estar disponible en la cuenta."
              className="h-8 text-xs"
            >
              Eliminar apartado
            </ConfirmButton>
          </div>
        </div>
      </details>
    </Card>
  );
}

export default function ApartadosPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApartadosPageContent />
    </Suspense>
  );
}
