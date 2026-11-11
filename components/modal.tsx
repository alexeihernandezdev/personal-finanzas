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
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-lg p-1 text-muted transition hover:bg-background hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
