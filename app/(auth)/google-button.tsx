import { googleEnabled } from "@/auth";
import { Button } from "@/components/ui";
import { googleSignInAction } from "./actions";

export function GoogleButton() {
  if (!googleEnabled) return null;
  return (
    <form action={googleSignInAction} className="mt-3">
      <Button variant="secondary" className="w-full">
        Continuar con Google
      </Button>
    </form>
  );
}
