import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { registerAction } from "../actions";
import { GoogleButton } from "../google-button";

export default function RegisterPage() {
  return (
    <Card>
      <h2 className="mb-4 font-semibold">Crear cuenta</h2>
      <ActionForm action={registerAction} resetOnSuccess={false} className="flex flex-col gap-4">
        <Field label="Nombre">
          <Input name="name" required autoComplete="name" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </Field>
        <SubmitButton className="w-full">Crear cuenta</SubmitButton>
      </ActionForm>
      <GoogleButton />
      <p className="mt-4 text-center text-sm text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Inicia sesión
        </Link>
      </p>
    </Card>
  );
}
