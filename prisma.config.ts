import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // El CLI (migrate, db push, studio) usa la conexión directa, sin pooler: las migraciones
  // necesitan advisory locks que el pooler no soporta. La app sigue usando DATABASE_URL.
  datasource: {
    url: process.env.DIRECT_URL || env("DATABASE_URL"),
  },
});
