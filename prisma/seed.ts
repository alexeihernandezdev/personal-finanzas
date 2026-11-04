import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const currencies = [
    { code: "USD", name: "Dólar estadounidense", symbol: "$", decimals: 2 },
    { code: "VES", name: "Bolívar", symbol: "Bs.", decimals: 2 },
    { code: "USDT", name: "Tether", symbol: "₮", decimals: 2 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }
  console.log("Divisas cargadas");
}

main().finally(() => prisma.$disconnect());
