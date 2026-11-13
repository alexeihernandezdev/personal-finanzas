"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Modal sobre `<dialog>` nativo (foco, Escape y fondo los maneja el navegador). El contenido solo se
 * monta mientras está abierto, así cada apertura arranca con los valores actuales.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
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
      // Hoja inferior en móvil (al alcance del pulgar); centrado desde sm
      className="sheet mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-none rounded-t-3xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50 sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-sm sm:rounded-2xl"
    >
      {open && (
        <div className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
          <div className="mx-auto -mt-2 mb-3 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold sm:text-base">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="-mr-2 flex size-10 items-center justify-center rounded-full text-muted transition hover:bg-background hover:text-foreground sm:size-8"
            >
              <X className="size-5 sm:size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
