import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/dal";
import { logoutAction } from "../(auth)/actions";

export async function UserMenu() {
  const user = await requireUser();
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.name ?? "Usuario"}</p>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>
      <form action={logoutAction}>
        <button
          className="flex size-10 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground md:size-8"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
