import { redirect } from "next/navigation";

/** Las transferencias se registran desde "Nuevo movimiento" y se listan en Movimientos. */
export default function TransferenciasPage() {
  redirect("/movimientos/nuevo?tipo=transferencia");
}
