import { refreshRates } from "@/lib/rates";
import { processAutoPayments } from "@/lib/recurring";

// Vercel Cron llama a esta ruta con `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const result = await refreshRates();
  // Con la tasa del día ya guardada, registra los gastos fijos automáticos que vencen hoy
  const autoPayments = await processAutoPayments().catch(() => null);
  return Response.json({ ...result, autoPayments }, { status: result.saved.length ? 200 : 502 });
}
