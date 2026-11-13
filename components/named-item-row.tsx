import { ActionForm, ConfirmButton, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

/** Fila editable (nombre + color) con botón de archivar. Se usa en categorías y negocios. */
export function NamedItemRow({
  item,
  rename,
  toggleArchive,
}: {
  item: { id: string; name: string; color: string; archived: boolean };
  rename: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  toggleArchive: () => Promise<void>;
}) {
  return (
    <li className={cn("flex items-center gap-2 px-4 py-2", item.archived && "opacity-60")}>
      <ActionForm action={rename} resetOnSuccess={false} className="flex flex-1 items-center gap-2">
        <Input name="color" type="color" defaultValue={item.color} className="w-10 shrink-0 p-1" />
        <Input name="name" defaultValue={item.name} className="flex-1" required />
        <SubmitButton variant="ghost" className="h-10 px-3 text-sm sm:h-8 sm:text-xs">
          Guardar
        </SubmitButton>
      </ActionForm>
      <ConfirmButton action={toggleArchive} variant="ghost" className="h-10 px-3 text-sm text-muted sm:h-8 sm:text-xs">
        {item.archived ? "Restaurar" : "Archivar"}
      </ConfirmButton>
    </li>
  );
}
