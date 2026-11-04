import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/dal";
import { logoutAction } from "../(auth)/actions";

export async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{user.name ?? "Usuario"}</p>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>
      <form action={logoutAction}>
        <button className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground" title="Cerrar sesión">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
