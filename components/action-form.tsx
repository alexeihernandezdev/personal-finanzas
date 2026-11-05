"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";
import { buttonClass } from "./ui";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Formulario genérico para Server Actions: muestra errores y limpia el formulario al guardar.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  onSuccess,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  // Guardamos los callbacks en refs para que el efecto dependa solo de `state`:
  // si dependiera de `onSuccess` (nueva función en cada render), cada tecla tras
  // un guardado volvería a disparar el reset y el formulario quedaría bloqueado.
  const onSuccessRef = useRef(onSuccess);
  const resetRef = useRef(resetOnSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    resetRef.current = resetOnSuccess;
  });

  useEffect(() => {
    if (state?.ok) {
      if (resetRef.current) ref.current?.reset();
      onSuccessRef.current?.();
    }
  }, [state]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && (
        <p role="alert" className="col-span-full rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p className="col-span-full rounded-lg bg-positive/10 px-3 py-2 text-sm text-positive">{state.message}</p>
      )}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(buttonClass(variant), className)}>
      {pending ? "Guardando…" : children}
    </button>
  );
}

/** Botón que ejecuta una action simple (borrar, archivar…) con confirmación. */
export function ConfirmButton({
  action,
  children,
  confirm,
  className,
  variant = "danger",
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  confirm?: string;
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <form
      action={async () => {
        await action();
      }}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <SubmitButton variant={variant} className={className}>
        {children}
      </SubmitButton>
    </form>
  );
}
