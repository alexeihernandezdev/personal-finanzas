import { redirect } from "next/navigation";

/** El presupuesto ahora vive en Apartados: cada apartado tiene su % de cada ingreso. */
export default async function PresupuestoPage({ searchParams }: PageProps<"/presupuesto">) {
  const { negocio } = await searchParams;
  redirect(typeof negocio === "string" ? `/apartados?negocio=${encodeURIComponent(negocio)}` : "/apartados");
}
