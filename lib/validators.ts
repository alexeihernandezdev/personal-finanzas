import { z } from "zod";

/**
 * Acepta "1234.56", "1234,56", "1.234,56" o "1,234.56" y devuelve un string decimal normalizado.
 */
export function normalizeAmount(raw: string): string | null {
  let s = raw.replace(/\s|\$|Bs\.?/gi, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // el último separador es el decimal
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  }
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

export const amount = (label = "El monto") =>
  z
    .string({ error: `${label} es obligatorio` })
    .transform((v, ctx) => {
      const n = normalizeAmount(v);
      if (n === null || Number(n) <= 0) {
        ctx.addIssue({ code: "custom", message: `${label} debe ser un número mayor que 0` });
        return z.NEVER;
      }
      return n;
    });

export const optionalAmount = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return "0";
    const n = normalizeAmount(v.replace(/^-/, ""));
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Monto inválido" });
      return z.NEVER;
    }
    return v.trim().startsWith("-") ? `-${n}` : n;
  });

export const isoDate = z.string({ error: "La fecha es obligatoria" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const optionalId = z.string().optional();
export const currencyCode = z.enum(["USD", "VES", "USDT"], { error: "Divisa inválida" });

export const walletSchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(60),
  type: z.enum(["BANK", "PAYPAL", "BINANCE", "CASH", "OTHER"]),
  currencyCode,
  initialBalance: optionalAmount,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const categorySchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(60),
  kind: z.enum(["INCOME", "EXPENSE"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const businessSchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const splitSchema = z.object({
  businessId: z.string().nullable(),
  amount: amount("El monto de la división"),
});

export const transactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  walletId: z.string({ error: "Elige una cuenta" }),
  amount: amount(),
  date: isoDate,
  categoryId: optionalId,
  description: z.string().max(200).optional(),
  splits: z.array(splitSchema).default([]),
  // Apartado al que entra / del que sale: "auto" = Caja de cada dueño, vacío = ninguno
  pocketId: optionalId,
  // Repartir según el presupuesto lo que entra a una Caja
  distribute: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export const transferSchema = z.object({
  fromWalletId: z.string({ error: "Elige la cuenta de origen" }),
  toWalletId: z.string({ error: "Elige la cuenta de destino" }),
  amountOut: amount("El monto enviado"),
  amountIn: z.string().optional(),
  fee: optionalAmount,
  date: isoDate,
  description: z.string().max(200).optional(),
});

export const recurringSchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(80),
  amount: amount(),
  currencyCode,
  dayOfMonth: z.coerce.number().int().min(1, "Día entre 1 y 31").max(31, "Día entre 1 y 31"),
  walletId: optionalId,
  categoryId: optionalId,
  businessId: optionalId,
  // Apartado del que se paga: id, FIXED_RESERVE (el de "Gastos fijos" de su dueño) o vacío (la Caja)
  pocketId: optionalId,
  autoPay: z
    .string()
    .optional()
    .transform((v) => v === "on"),
}).refine((d) => !d.autoPay || d.walletId, {
  message: "Los pagos automáticos necesitan una cuenta habitual",
  path: ["walletId"],
});

export const recurringIncomeSchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(80),
  amount: amount(),
  currencyCode,
  dayOfMonth: z.coerce.number().int().min(1, "Día entre 1 y 31").max(31, "Día entre 1 y 31"),
  walletId: optionalId,
  categoryId: optionalId,
  businessId: optionalId,
});

export const budgetBucketSchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(60),
  percent: z
    .string({ error: "El porcentaje es obligatorio" })
    .transform((v, ctx) => {
      const n = normalizeAmount(v.replace("%", ""));
      if (n === null || Number(n) <= 0 || Number(n) > 100) {
        ctx.addIssue({ code: "custom", message: "El porcentaje debe estar entre 0 y 100" });
        return z.NEVER;
      }
      return n;
    }),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  pocketId: optionalId,
});

export const fixedBufferSchema = z.object({
  percent: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return "0";
      const n = normalizeAmount(v.replace("%", ""));
      if (n === null || Number(n) > 100) {
        ctx.addIssue({ code: "custom", message: "El colchón debe estar entre 0 y 100%" });
        return z.NEVER;
      }
      return n;
    }),
});

export const receivableSchema = z.object({
  kind: z.enum(["RECEIVABLE", "LOAN_GIVEN"]),
  counterparty: z.string({ error: "¿Quién te debe?" }).min(1).max(80),
  description: z.string().max(200).optional(),
  amount: amount(),
  currencyCode,
  expectedDate: isoDate.optional(),
  businessId: optionalId,
  // Solo préstamos: cuenta desde la que sale el dinero y apartado del que sale
  walletId: optionalId,
  pocketId: optionalId,
  date: isoDate.optional(),
});

export const paymentSchema = z.object({
  receivableId: z.string(),
  walletId: z.string({ error: "Elige la cuenta donde entra el dinero" }),
  amount: amount(),
  date: isoDate,
  // Apartado al que entra ("auto" = Caja del dueño; vacío = ninguno)
  pocketId: optionalId,
  distribute: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export const debtSchema = z.object({
  kind: z.enum(["PAYABLE", "LOAN_RECEIVED"]),
  counterparty: z.string({ error: "¿A quién le debes?" }).min(1).max(80),
  description: z.string().max(200).optional(),
  amount: amount(),
  currencyCode,
  dueDate: isoDate.optional(),
  businessId: optionalId,
  // Solo préstamos recibidos: cuenta y apartado a los que entra el dinero
  walletId: optionalId,
  pocketId: optionalId,
  date: isoDate.optional(),
});

export const debtPaymentSchema = z.object({
  debtId: z.string(),
  walletId: z.string({ error: "Elige la cuenta de la que sale el dinero" }),
  amount: amount(),
  date: isoDate,
  // Apartado del que sale ("auto" = Caja del dueño; vacío = ninguno)
  pocketId: optionalId,
});

export const debtTransactionEditSchema = z.object({
  walletId: z.string({ error: "Elige una cuenta" }),
  amount: amount(),
  date: isoDate,
});

export const pocketSchema = z.object({
  name: z.string({ error: "Escribe un nombre" }).min(1).max(60),
  kind: z.enum(["SAVINGS", "GOAL", "EMERGENCY", "RESERVE"]),
  currencyCode,
  businessId: optionalId,
  targetAmount: amount("La meta").optional(),
  targetDate: isoDate.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Solo al crear: monto que se aparta de entrada
  initialAmount: amount("El monto inicial").optional(),
});

export const pocketMovementSchema = z.object({
  pocketId: z.string(),
  direction: z.enum(["IN", "OUT"]),
  amount: amount(),
  date: isoDate,
  description: z.string().max(200).optional(),
});

export const pocketTransferSchema = z
  .object({
    fromPocketId: z.string(),
    toPocketId: z.string({ error: "Elige a qué apartado pasa" }).min(1, "Elige a qué apartado pasa"),
    mode: z.enum(["amount", "percent"]),
    // "balance" = % sobre el saldo; si no, id del movimiento de entrada sobre el que se calcula
    base: z.string().default("balance"),
    value: amount("El valor"),
    date: isoDate,
    description: z.string().max(200).optional(),
    distribute: z
      .string()
      .optional()
      .transform((v) => v === "on"),
  })
  .refine((d) => d.mode === "amount" || Number(d.value) <= 100, {
    message: "El porcentaje debe estar entre 0 y 100",
    path: ["value"],
  })
  .refine((d) => d.fromPocketId !== d.toPocketId, { message: "Elige otro apartado", path: ["toPocketId"] });
