"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { seedUserDefaults } from "@/lib/defaults";
import { fail, formObject, zodError, type ActionState } from "@/lib/action";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return fail("Email o contraseña incorrectos");
    throw error;
  }
}

const registerSchema = z.object({
  name: z.string({ error: "Escribe tu nombre" }).min(1, "Escribe tu nombre").max(80),
  email: z.email("Email inválido").transform((e) => e.toLowerCase()),
  password: z.string({ error: "Escribe una contraseña" }).min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodError(parsed.error);
  const { name, email, password } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return fail("Ya existe una cuenta con ese email");

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10) },
  });
  await seedUserDefaults(user.id);

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return fail("Cuenta creada, pero no se pudo iniciar sesión");
    throw error;
  }
}

export async function googleSignInAction() {
  await signIn("google", { redirectTo: "/" });
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
