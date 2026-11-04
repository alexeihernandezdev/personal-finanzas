import "server-only";
import { prisma } from "@/lib/db";

const INCOME = ["Salario", "Ventas", "Freelance", "Intereses", "Otros ingresos"];
const EXPENSE = [
  "Comida",
  "Transporte",
  "Servicios",
  "Alquiler",
  "Salud",
  "Entretenimiento",
  "Educación",
  "Compras",
  "Comisiones",
  "Impuestos",
  "Otros gastos",
];

export async function seedUserDefaults(userId: string) {
  await prisma.category.createMany({
    data: [
      ...INCOME.map((name) => ({ userId, name, kind: "INCOME" as const, color: "#16a34a" })),
      ...EXPENSE.map((name) => ({ userId, name, kind: "EXPENSE" as const, color: "#dc2626" })),
    ],
    skipDuplicates: true,
  });
}

/** Categoría usada para registrar comisiones de transferencias. */
export async function getFeeCategoryId(userId: string) {
  const cat = await prisma.category.upsert({
    where: { userId_kind_name: { userId, kind: "EXPENSE", name: "Comisiones" } },
    update: {},
    create: { userId, kind: "EXPENSE", name: "Comisiones", color: "#dc2626" },
  });
  return cat.id;
}
