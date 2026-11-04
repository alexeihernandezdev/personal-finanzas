import { z } from "zod";

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

export function fail(error: string): ActionState {
  return { ok: false, error };
}

export function zodError(error: z.ZodError): ActionState {
  const first = error.issues[0];
  return { ok: false, error: first?.message ?? "Datos inválidos" };
}

/** Convierte FormData en objeto; los campos vacíos pasan a undefined. */
export function formObject(formData: FormData) {
  const obj: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) obj[key] = value.trim() === "" ? undefined : value.trim();
  }
  return obj;
}
