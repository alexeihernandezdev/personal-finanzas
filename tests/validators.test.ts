import { describe, expect, it } from "vitest";
import { normalizeAmount, transactionSchema } from "@/lib/validators";

describe("normalizeAmount", () => {
  it.each([
    ["1234.56", "1234.56"],
    ["1234,56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["Bs. 1.000,00", "1000.00"],
    ["$ 20", "20"],
    ["1.234", "1234"],
    ["1.234.567", "1234567"],
    ["0.500", "0.500"],
    ["12.5", "12.5"],
  ])("%s -> %s", (input, out) => expect(normalizeAmount(input)).toBe(out));
  it("rechaza texto", () => {
    expect(normalizeAmount("abc")).toBeNull();
    expect(normalizeAmount("")).toBeNull();
  });
});

describe("transactionSchema", () => {
  it("rechaza montos en cero", () => {
    const r = transactionSchema.safeParse({ type: "EXPENSE", walletId: "w", amount: "0", date: "2026-11-01" });
    expect(r.success).toBe(false);
  });
  it("acepta un movimiento de un negocio", () => {
    const r = transactionSchema.safeParse({
      type: "INCOME",
      walletId: "w",
      amount: "100,00",
      date: "2026-11-01",
      businessId: "b1",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe("100.00");
  });
});
