import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * Verifica la sesión y devuelve el usuario actual. Toda lectura y escritura de datos
 * del usuario pasa por aquí: es la frontera de autorización (no el proxy).
 */
export const requireUser = cache(async () => {
  // Auth.js usa crypto antes de leer las cookies; marcamos la lectura como dinámica primero.
  await connection();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, displayCurrency: true, preferredRateSource: true },
  });
  if (!user) redirect("/login");
  return user;
});

export type CurrentUser = Awaited<ReturnType<typeof requireUser>>;
