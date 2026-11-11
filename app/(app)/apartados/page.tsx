import { Suspense } from "react";
import Link from "next/link";
import { PageSkeleton } from "@/components/page-skeleton";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { PocketFields, pocketKindLabel } from "@/components/pocket-fields";
import { PocketTransferForm, type TransferDestination } from "@/components/pocket-transfer-form";
import { Amount, Badge, Card, EmptyState, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { convert, Decimal, formatMoney } from "@/lib/money";
import { getBusinesses, getMoneySummary, getPockets, type PocketWithBalance } from "@/lib/queries";
import { getCurrentRates, pickRate } from "@/lib/rates";
import { cn, formatDate, toISODate, todayISO } from "@/lib/utils";
import {
  createMainPocket,
  createPocket,
  deletePocket,
  deletePocketMovement,
  movePocketMoney,
  toggleArchivePocket,
  togglePinPocket,
  transferPocketMoney,
  updatePocket,
} from "./actions";

type BusinessOption = { id: string; name: string };

async function ApartadosPageContent({ searchParams }: PageProps<"/apartados">) {
  const { negocio } = await searchParams;
  const user = await requireUser();
  const rate = pickRate(await getCurrentRates(), user.preferredRateSource);
  const cur = user.displayCurrency;
  const [summary, pockets, businesses] = await Promise.all([
    getMoneySummary(user.id, cur, rate),
    getPockets(user.id),
    getBusinesses(user.id),
  ]);
  const { total, reserved, available } = summary;

  const businessOptions: BusinessOption[] = businesses.map((b) => ({ id: b.id, name: b.name }));

  // Una pestaña por dueño del dinero: Personal primero y luego cada negocio (también los
  // archivados que todavía tengan apartados)
  const tabs = [{ key: "personal", name: "Personal" }, ...businessOptions.map((b) => ({ key: b.id, name: b.name }))];
  for (const p of pockets) {
    if (p.business && !tabs.some((t) => t.key === p.business!.id)) tabs.push({ key: p.business.id, name: p.business.name });
  }
  const currentTab = tabs.find((t) => t.key === negocio) ?? tabs[0];
  const tabPockets = (key: string) => pockets.filter((p) => (p.businessId ?? "personal") === key);
  const reservedIn = (key: string) =>
    tabPockets(key).reduce((acc, p) => {
      try {
        return acc.add(convert(p.balance, p.currencyCode, cur, rate));
      } catch {
        return acc;
      }
    }, new Decimal(0));

  const inTab = tabPockets(currentTab.key);
  // La Caja va primero
  const active = inTab.filter((p) => !p.archived).sort((a, b) => Number(b.isMain) - Number(a.isMain));
  const archived = inTab.filter((p) => p.archived);
  const hasCaja = inTab.some((p) => p.isMain);
  const tabBusinessId = currentTab.key === "personal" ? null : currentTab.key;
  const destinations: TransferDestination[] = [
    ...pockets.filter((p) => !p.archived && !p.businessId),
    ...pockets.filter((p) => !p.archived && p.businessId),
  ].map((p) => ({
    id: p.id,
    name: p.name,
    currencyCode: p.currencyCode,
    ownerName: p.business?.name ?? "Personal",
    isMain: p.isMain,
  }));

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
      {available.isNegative() && (
        <p role="alert" className="mb-6 rounded-lg bg-negative/10 px-4 py-3 text-sm text-negative">
          Gastaste dinero apartado. Libera parte de un apartado o repón el saldo de tus cuentas.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <nav className="flex flex-wrap gap-2" aria-label="Dueño del dinero">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={`/apartados?negocio=${t.key}`}
                className={cn(
                  "flex items-baseline gap-2 rounded-lg px-3 py-1.5 text-sm",
                  currentTab.key === t.key ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface",
                )}
              >
                {t.name}
                <span className="text-xs tabular opacity-80">{formatMoney(reservedIn(t.key), cur)}</span>
              </Link>
            ))}
          </nav>
          {!hasCaja && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4 text-sm">
              <p className="text-muted">
                La <span className="font-medium text-foreground">Caja {currentTab.name}</span> recibe los ingresos de{" "}
                {tabBusinessId ? "este negocio" : "lo personal"} y los reparte según su presupuesto. Se crea sola con el
                primer ingreso.
              </p>
              <ConfirmButton action={createMainPocket.bind(null, tabBusinessId)} variant="secondary" className="h-8 text-xs">
                Crear Caja ahora
              </ConfirmButton>
            </div>
          )}
          {active.length === 0 ? (
            <EmptyState>
              {currentTab.key === "personal"
                ? "Todavía no tienes apartados personales."
                : `Todavía no tienes apartados para ${currentTab.name}.`}{" "}
              Crea uno para separar dinero sin moverlo de tus cuentas.
            </EmptyState>
          ) : (
            <section>
              <SectionTitle>{currentTab.name}</SectionTitle>
              <div className="flex flex-col gap-3">
                {active.map((p) => (
                  <PocketCard
                    key={p.id}
                    pocket={p}
                    businesses={businessOptions}
                    destinations={destinations.filter((d) => d.id !== p.id)}
                  />
                ))}
              </div>
            </section>
          )}
          {archived.length > 0 && (
            <section>
              <SectionTitle>Archivados</SectionTitle>
              <div className="flex flex-col gap-3 opacity-70">
                {archived.map((p) => (
                  <PocketCard key={p.id} pocket={p} businesses={businessOptions} destinations={[]} />
                ))}
              </div>
            </section>
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nuevo apartado</h2>
          <ActionForm key={currentTab.key} action={createPocket} className="flex flex-col gap-3">
            <PocketFields
              businesses={businessOptions}
              defaultBusinessId={currentTab.key === "personal" ? "" : currentTab.key}
            />
            <Field label="Apartar ahora" hint="Opcional: sale de lo disponible para usar">
              <Input name="initialAmount" inputMode="decimal" placeholder="0,00" />
            </Field>
            <SubmitButton>Crear apartado</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function PocketCard({
  pocket: p,
  businesses,
  destinations,
}: {
  pocket: PocketWithBalance;
  businesses: BusinessOption[];
  destinations: TransferDestination[];
}) {
  const currency = p.currencyCode;
  const target = p.targetAmount ? new Decimal(p.targetAmount.toString()) : null;
  const pct = target && target.gt(0) ? Math.min(100, p.balance.div(target).mul(100).toNumber()) : null;
  const today = todayISO();

  return (
    <Card className="relative overflow-hidden">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: p.color }} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            {p.name}
            {p.isMain && <Badge className="bg-accent-soft text-accent">Caja</Badge>}
          </p>
          <p className="text-xs text-muted">
            {p.isMain ? "Recibe los ingresos y los reparte según el presupuesto" : pocketKindLabel(p.kind)} · {currency}
            {p.targetDate && ` · para el ${formatDate(p.targetDate)}`}
          </p>
        </div>
        <div className="flex items-start gap-1">
          <div className="text-right">
            <p className="text-xl font-semibold">
              <Amount value={formatMoney(p.balance, currency)} />
            </p>
            {target && <p className="text-xs text-muted">de {formatMoney(target, currency)}</p>}
          </div>
          {!p.archived && (
            <ConfirmButton
              action={togglePinPocket.bind(null, p.id)}
              variant="ghost"
              className={cn("h-7 px-2 text-xs", p.pinned ? "text-accent" : "text-muted")}
            >
              <span title={p.pinned ? "Quitar del inicio" : "Fijar en el inicio"}>{p.pinned ? "★" : "☆"}</span>
            </ConfirmButton>
          )}
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

      {!p.archived && destinations.length > 0 && p.balance.gt(0) && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-foreground">Pasar a otro apartado</summary>
          <div className="mt-3 text-sm">
            <PocketTransferForm
              action={transferPocketMoney}
              pocket={{ id: p.id, currencyCode: currency, balance: p.balance.toString() }}
              entries={p.movements
                .filter((m) => m.amount.gt(0))
                .map((m) => ({
                  id: m.id,
                  label: `${formatDate(m.date, { day: "2-digit", month: "short" })} · ${m.description || "Entrada"}`,
                  amount: m.amount.toString(),
                }))}
              destinations={destinations}
              today={today}
            />
          </div>
        </details>
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
                  confirm={
                    m.groupId
                      ? "Se eliminará la operación completa (el traspaso o reparto en todos sus apartados). ¿Continuar?"
                      : "¿Eliminar este movimiento del apartado?"
                  }
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
              businesses={businesses}
              currencyLocked={!p.balance.isZero()}
              ownerLocked={p.isMain}
              defaults={{
                name: p.name,
                kind: p.kind,
                currencyCode: currency,
                businessId: p.businessId ?? "",
                targetAmount: target ? target.toFixed(2) : "",
                targetDate: p.targetDate ? toISODate(p.targetDate) : "",
                color: p.color,
              }}
            />
            <SubmitButton className="sm:col-span-2">Guardar cambios</SubmitButton>
          </ActionForm>
          <div className="flex flex-wrap gap-2">
            {!p.isMain && (p.archived || p.balance.isZero()) && (
              <ConfirmButton action={toggleArchivePocket.bind(null, p.id)} variant="secondary" className="h-8 text-xs">
                {p.archived ? "Restaurar" : "Archivar"}
              </ConfirmButton>
            )}
            {(!p.isMain || p.balance.isZero()) && (
              <ConfirmButton
                action={deletePocket.bind(null, p.id)}
                confirm="¿Eliminar el apartado? Su dinero vuelve a estar disponible."
                className="h-8 text-xs"
              >
                Eliminar apartado
              </ConfirmButton>
            )}
          </div>
        </div>
      </details>
    </Card>
  );
}

export default function ApartadosPage(props: PageProps<"/apartados">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApartadosPageContent {...props} />
    </Suspense>
  );
}
