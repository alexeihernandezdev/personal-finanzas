"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";

/** Idioma de los componentes de Untitled UI / React Aria (calendario, fechas, listas). */
export function Providers({ children }: { children: ReactNode }) {
  return <I18nProvider locale="es-VE">{children}</I18nProvider>;
}
