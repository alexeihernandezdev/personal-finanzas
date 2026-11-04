// Aplica las migraciones pendientes (prisma migrate deploy) durante el build de Vercel,
// solo en el deploy de producción (push a main). En previews y builds locales no hace nada.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") {
  console.log(`[migrate] VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}: se omiten las migraciones.`);
  process.exit(0);
}

console.log("[migrate] Producción: aplicando migraciones pendientes...");
execSync("npx prisma migrate deploy", { stdio: "inherit" });
