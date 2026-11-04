import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { MobileNav, NavLinks } from "@/components/nav";
import { Skeleton } from "@/components/ui";
import { logoutAction } from "../(auth)/actions";
import { UserMenu } from "./user-menu";

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-accent font-bold text-white dark:text-black">F</div>
      <span className="font-semibold">Finanzas</span>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface p-3 md:flex">
        <div className="pt-2">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <Suspense fallback={<Skeleton className="h-12" />}>
          <UserMenu />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <MobileNav />
            <form action={logoutAction}>
              <button className="rounded-lg p-2 text-muted hover:bg-background" title="Cerrar sesión">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
