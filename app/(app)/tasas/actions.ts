"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import type { ActionState } from "@/lib/action";
import { refreshRates } from "@/lib/rates";

export async function refreshRatesAction(): Promise<ActionState> {
  await requireUser();
  const { saved, errors } = await refreshRates();
  revalidatePath("/", "layout");
  if (!saved.length) return { ok: false, error: "No se pudo consultar ninguna fuente. Intenta más tarde." };
  return {
    ok: true,
    message: errors.length ? `Actualizadas parcialmente (falló: ${errors.map((e) => e.kind).join(", ")})` : "Tasas actualizadas",
  };
}
