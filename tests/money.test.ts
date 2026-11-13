import { describe, expect, it } from "vitest";
import { convert, formatMoney, signedAmount } from "@/lib/money";

describe("convert", () => {
  it("convierte VES a USD y viceversa", () => {
    expect(convert("8892.55", "VES", "USD", "889.255").toFixed(2)).toBe("10.00");
    expect(convert("10", "USD", "VES", "889.255").toFixed(2)).toBe("8892.55");
  });
  it("trata USDT como USD", () => {
    expect(convert("5", "USDT", "USD", null).toString()).toBe("5");
    expect(convert("5", "USDT", "VES", "100").toString()).toBe("500");
  });
  it("falla sin tasa", () => {
    expect(() => convert("1", "VES", "USD", null)).toThrow();
  });
  it("no pierde precisión con decimales", () => {
    expect(convert("0.1", "USD", "VES", "0.2").toString()).toBe("0.02");
  });
});

describe("signedAmount / formatMoney", () => {
  it("da signo según el tipo", () => {
    expect(signedAmount("INCOME", "5").toString()).toBe("5");
    expect(signedAmount("TRANSFER_OUT", "5").toString()).toBe("-5");
    expect(signedAmount("LOAN_REPAYMENT", "5").toString()).toBe("5");
  });
  it("formatea en es-VE", () => {
    expect(formatMoney("1234.5", "VES")).toBe("Bs. 1.234,50");
    expect(formatMoney("-3", "USD")).toBe("-$ 3,00");
    expect(formatMoney("3", "USD", { sign: true })).toBe("+$ 3,00");
  });
});
