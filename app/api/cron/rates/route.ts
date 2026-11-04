import { refreshRates } from "@/lib/rates";

// Vercel Cron llama a esta ruta con `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const result = await refreshRates();
  return Response.json(result, { status: result.saved.length ? 200 : 502 });
}
