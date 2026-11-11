"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  HandCoins,
  LayoutDashboard,
  ListOrdered,
  PiggyBank,
  Receipt,
  Settings,
  Store,
  Tags,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/cuentas", label: "Cuentas", icon: Wallet },
  { href: "/apartados", label: "Apartados", icon: PiggyBank },
  { href: "/movimientos", label: "Movimientos", icon: ListOrdered },
  { href: "/transferencias", label: "Transferencias", icon: ArrowLeftRight },
  { href: "/gastos-fijos", label: "Gastos fijos", icon: CalendarClock },
  { href: "/por-cobrar", label: "Por cobrar", icon: HandCoins },
  { href: "/deudas", label: "Deudas", icon: Receipt },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/tasas", label: "Tasas", icon: TrendingUp },
  { href: "/categorias", label: "Categorías", icon: Tags },
  { href: "/negocios", label: "Negocios", icon: Store },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  // usePathname() es dato de la URL: con Cache Components necesita su propio Suspense
  return (
    <Suspense fallback={<Links pathname={null} />}>
      <ActiveLinks onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <Links pathname={usePathname()} onNavigate={onNavigate} />;
}

function Links({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
              active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-background hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  return (
    <details className="group relative md:hidden">
      <summary className="flex cursor-pointer list-none items-center rounded-lg border border-border px-3 py-1.5 text-sm">
        Menú
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg">
        <NavLinks
          onNavigate={() => document.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"))}
        />
      </div>
    </details>
  );
}
