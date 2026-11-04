// Copia los datos de la base local (DATABASE_URL) a producción (PROD_DATABASE_URL).
// Conserva los IDs y usa skipDuplicates: se puede ejecutar varias veces sin duplicar.
//
//   PROD_DATABASE_URL="postgresql://..." npx tsx scripts/migrate-to-prod.ts           # simulación
//   PROD_DATABASE_URL="postgresql://..." npx tsx scripts/migrate-to-prod.ts --apply   # escribe
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.env.PROD_DATABASE_URL;
const apply = process.argv.includes("--apply");

if (!sourceUrl || !targetUrl) {
  console.error("Faltan DATABASE_URL (local) y/o PROD_DATABASE_URL (producción).");
  process.exit(1);
}
if (sourceUrl === targetUrl) {
  console.error("Origen y destino son la misma base. Abortando.");
  process.exit(1);
}

const source = new PrismaClient({ adapter: new PrismaPg({ connectionString: sourceUrl }) });
const target = new PrismaClient({ adapter: new PrismaPg({ connectionString: targetUrl }) });

type Delegate = {
  findMany: (args?: object) => Promise<object[]>;
  createMany: (args: { data: object[]; skipDuplicates: boolean }) => Promise<{ count: number }>;
};

// Orden según las claves foráneas: primero los padres.
const tables = [
  "currency",
  "user",
  "wallet",
  "category",
  "business",
  "recurringExpense",
  "receivable",
  "debt",
  "transaction",
  "transactionSplit",
  "exchangeRate",
] as const;

const CHUNK = 1000;

async function checkUserConflicts() {
  const localUsers = await source.user.findMany({ select: { id: true, email: true } });
  const prodUsers = await target.user.findMany({
    where: { email: { in: localUsers.map((u) => u.email) } },
    select: { id: true, email: true },
  });
  const conflicts = prodUsers.filter((p) => localUsers.find((l) => l.email === p.email)?.id !== p.id);
  if (conflicts.length) {
    console.error(
      "Estos emails ya existen en producción con otro ID (¿te registraste allí?):\n" +
        conflicts.map((c) => `  - ${c.email}`).join("\n") +
        "\nBorra ese usuario en producción (se eliminan sus datos en cascada) y vuelve a ejecutar.",
    );
    process.exit(1);
  }
}

async function main() {
  await checkUserConflicts();
  console.log(apply ? "Copiando a producción…\n" : "SIMULACIÓN (usa --apply para escribir)\n");

  for (const name of tables) {
    const from = source[name] as unknown as Delegate;
    const to = target[name] as unknown as Delegate;
    const rows = await from.findMany();
    let inserted = 0;
    if (apply) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { count } = await to.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
        inserted += count;
      }
    }
    const detail = apply ? `${inserted} nuevas, ${rows.length - inserted} ya existían` : "";
    console.log(`${name.padEnd(18)} ${String(rows.length).padStart(6)} filas  ${detail}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => Promise.all([source.$disconnect(), target.$disconnect()]));
