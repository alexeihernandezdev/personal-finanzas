import { Suspense } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { BottomNav, NavLinks } from "@/components/nav";
import { Skeleton } from "@/components/ui";
import { UserMenu } from "./user-menu";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg px-1 md:px-3">
      <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-teal-500 font-bold text-white shadow-sm dark:to-teal-300 dark:text-black">
        F
      </div>
      <span className="font-semibold tracking-tight">Finanzas</span>
    </Link>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  const userMenu = (
    <Suspense fallback={<Skeleton className="h-12" />}>
      <UserMenu />
    </Suspense>
  );
  return (
    <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface p-3 md:flex">
        <div className="pt-2">
          <Brand />
        </div>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <NavLinks />
        </div>
        {userMenu}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-border bg-surface/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
          <Brand />
          <Link
            href="/ajustes"
            aria-label="Ajustes"
            className="-mr-2 flex size-10 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
          >
            <Settings className="size-5" />
          </Link>
        </header>
        <main className="pb-bottom-nav mx-auto w-full max-w-6xl flex-1 px-4 pt-5 md:px-8 md:pt-8">{children}</main>
      </div>
      <BottomNav footer={userMenu} />
    </div>
  );
}
