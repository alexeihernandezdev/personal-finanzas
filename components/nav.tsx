"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  CalendarClock,
  ChartPie,
  HandCoins,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  PiggyBank,
  Plus,
  Receipt,
  Settings,
  Store,
  Tags,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Día a día",
    items: [
      { href: "/", label: "Inicio", icon: LayoutDashboard },
      { href: "/movimientos", label: "Movimientos", icon: ListOrdered },
      { href: "/transferencias", label: "Transferencias", icon: ArrowLeftRight },
      { href: "/cuentas", label: "Cuentas", icon: Wallet },
      { href: "/apartados", label: "Apartados", icon: PiggyBank },
    ],
  },
  {
    title: "Planificación",
    items: [
      { href: "/presupuesto", label: "Presupuesto", icon: ChartPie },
      { href: "/ingresos-fijos", label: "Ingresos fijos", icon: Banknote },
      { href: "/gastos-fijos", label: "Gastos fijos", icon: CalendarClock },
      { href: "/por-cobrar", label: "Por cobrar", icon: HandCoins },
      { href: "/deudas", label: "Deudas", icon: Receipt },
    ],
  },
  {
    title: "Análisis y ajustes",
    items: [
      { href: "/reportes", label: "Reportes", icon: BarChart3 },
      { href: "/tasas", label: "Tasas", icon: TrendingUp },
      { href: "/categorias", label: "Categorías", icon: Tags },
      { href: "/negocios", label: "Negocios", icon: Store },
      { href: "/ajustes", label: "Ajustes", icon: Settings },
    ],
  },
];

export const NAV = NAV_GROUPS.flatMap((g) => g.items);

const isActive = (pathname: string | null, href: string) =>
  pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));

// usePathname() es dato de la URL: con Cache Components necesita su propio Suspense
function WithPathname({ children }: { children: (pathname: string | null) => ReactNode }) {
  return (
    <Suspense fallback={children(null)}>
      <ReadPathname>{children}</ReadPathname>
    </Suspense>
  );
}

function ReadPathname({ children }: { children: (pathname: string | null) => ReactNode }) {
  return children(usePathname());
}

/** Menú lateral (escritorio). */
export function NavLinks() {
  return (
    <WithPathname>
      {(pathname) => (
        <nav className="flex flex-col gap-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{group.title}</p>
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-muted hover:bg-background hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      )}
    </WithPathname>
  );
}

const TABS: NavItem[] = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/movimientos", label: "Movimientos", icon: ListOrdered },
  { href: "/cuentas", label: "Cuentas", icon: Wallet },
];

/** Barra inferior (móvil): accesos principales, botón para registrar y "Más" con el resto. */
export function BottomNav({ footer }: { footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <WithPathname>
      {(pathname) => {
        const inTabs = TABS.some((t) => isActive(pathname, t.href)) || pathname === "/movimientos/nuevo";
        return (
          <>
            <nav
              aria-label="Navegación principal"
              className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
            >
              <div className="mx-auto grid h-(--bottom-nav) max-w-md grid-cols-5 items-center px-1">
                <TabLink item={TABS[0]} active={isActive(pathname, TABS[0].href)} />
                <TabLink
                  item={TABS[1]}
                  active={isActive(pathname, TABS[1].href) && pathname !== "/movimientos/nuevo"}
                />
                <div className="flex justify-center">
                  <Link
                    href="/movimientos/nuevo"
                    aria-label="Nuevo movimiento"
                    className="flex size-12 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/30 transition active:scale-95 dark:text-black"
                  >
                    <Plus className="size-6" strokeWidth={2.5} />
                  </Link>
                </div>
                <TabLink item={TABS[2]} active={isActive(pathname, TABS[2].href)} />
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-haspopup="dialog"
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    !inTabs && pathname !== null ? "text-accent" : "text-muted",
                  )}
                >
                  <LayoutGrid className="size-5" />
                  Más
                </button>
              </div>
            </nav>
            <MoreSheet open={open} onClose={() => setOpen(false)} pathname={pathname} footer={footer} />
          </>
        );
      }}
    </WithPathname>
  );
}

function TabLink({ item: { href, label, icon: Icon }, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
        active ? "text-accent" : "text-muted",
      )}
    >
      <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
      {label}
    </Link>
  );
}

function MoreSheet({
  open,
  onClose,
  pathname,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string | null;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Todas las secciones"
      className="sheet mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-3xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      {open && (
        <div className="px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Secciones</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex size-10 items-center justify-center rounded-full text-muted hover:bg-background"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{group.title}</p>
                <div className="grid grid-cols-3 gap-2">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-18 flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-2.5 text-center text-xs font-medium transition-colors",
                          active
                            ? "border-accent/30 bg-accent-soft text-accent"
                            : "border-border bg-background/60 text-foreground active:bg-border/50",
                        )}
                      >
                        <Icon className="size-5" />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {footer && <div className="mt-4 border-t border-border pt-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
