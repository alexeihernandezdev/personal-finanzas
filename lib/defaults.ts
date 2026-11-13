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

/** Categoría del sistema (la crea si falta): comisiones de transferencias, cobros, pagos de deudas… */
export async function getSystemCategoryId(userId: string, kind: "INCOME" | "EXPENSE", name: string) {
  const cat = await prisma.category.upsert({
    where: { userId_kind_name: { userId, kind, name } },
    update: {},
    create: { userId, kind, name, color: kind === "INCOME" ? "#16a34a" : "#dc2626" },
  });
  return cat.id;
}

/** Categoría usada para registrar comisiones de transferencias. */
export function getFeeCategoryId(userId: string) {
  return getSystemCategoryId(userId, "EXPENSE", "Comisiones");
}

/** Categoría de los cobros de cuentas por cobrar. */
export function getCollectionCategoryId(userId: string) {
  return getSystemCategoryId(userId, "INCOME", "Cobros");
}

/** Categoría de los pagos de deudas por compras o facturas. */
export function getDebtPaymentCategoryId(userId: string) {
  return getSystemCategoryId(userId, "EXPENSE", "Pagos de deudas");
}
