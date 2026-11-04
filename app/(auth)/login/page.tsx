import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { loginAction } from "../actions";
import { GoogleButton } from "../google-button";

export default function LoginPage() {
  return (
    <Card>
      <h2 className="mb-4 font-semibold">Iniciar sesión</h2>
      <ActionForm action={loginAction} resetOnSuccess={false} className="flex flex-col gap-4">
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Contraseña">
          <Input name="password" type="password" required autoComplete="current-password" />
        </Field>
        <SubmitButton className="w-full">Entrar</SubmitButton>
      </ActionForm>
      <GoogleButton />
      <p className="mt-4 text-center text-sm text-muted">
        ¿No tienes cuenta?{" "}
        <Link href="/registro" className="font-medium text-accent hover:underline">
          Regístrate
        </Link>
      </p>
    </Card>
  );
}
