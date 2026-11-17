import { describe, expect, it } from "vitest";
import { normalizeRows, parseRowDate, parseSignedAmount, rowType } from "@/lib/import/normalize";

const TODAY = "2026-11-17";

describe("parseSignedAmount", () => {
  it.each([
    ["-1.234,56", "1234.56", "-"],
    ["1.234,56-", "1234.56", "-"],
    ["(20,00)", "20.00", "-"],
    ["−15,50", "15.50", "-"],
    ["Bs. -1.000,00", "1000.00", "-"],
    ["+ $ 5", "5", "+"],
    ["1,234.56", "1234.56", null],
    ["USD 20.00", "20.00", null],
  ])("%s", (text, amount, sign) => expect(parseSignedAmount(text)).toEqual({ amount, sign }));
  it("rechaza ceros y texto", () => {
    expect(parseSignedAmount("0,00")).toBeNull();
    expect(parseSignedAmount("abc")).toBeNull();
    expect(parseSignedAmount("")).toBeNull();
  });
});

describe("parseRowDate", () => {
  it.each([
    ["17/11/2026", "2026-11-17"],
    ["17-11-26", "2026-11-17"],
    ["2026-11-17", "2026-11-17"],
    ["2026/11/03", "2026-11-03"],
    ["05/11", "2026-11-05"],
    ["17 nov", "2026-11-17"],
    ["3 de noviembre de 2025", "2025-11-03"],
    ["17/11/2026 14:32", "2026-11-17"],
  ])("%s -> %s", (text, iso) => expect(parseRowDate(text, TODAY)).toBe(iso));
  it("sin año y en el futuro: el año anterior", () => {
    expect(parseRowDate("20/12", TODAY)).toBe("2025-12-20");
  });
  it("rechaza fechas imposibles", () => {
    expect(parseRowDate("31/02/2026", TODAY)).toBeNull();
    expect(parseRowDate("hoy", TODAY)).toBeNull();
  });
});

describe("rowType", () => {
  it("lo negativo siempre es gasto", () => {
    expect(rowType("-", "credit", "INCOME")).toBe("EXPENSE");
    expect(rowType("-", null, "AUTO")).toBe("EXPENSE");
  });
  it("en positivos manda el sentido del lote", () => {
    expect(rowType(null, "credit", "EXPENSE")).toBe("EXPENSE");
    expect(rowType(null, "debit", "INCOME")).toBe("INCOME");
  });
  it("en automático usa débito/crédito", () => {
    expect(rowType(null, "debit", "AUTO")).toBe("EXPENSE");
    expect(rowType(null, "credit", "AUTO")).toBe("INCOME");
    expect(rowType(null, "unknown", "AUTO")).toBe("INCOME");
    expect(rowType("+", "debit", "AUTO")).toBe("INCOME");
  });
  it("transferencias", () => {
    expect(rowType("-", null, "TRANSFER")).toBe("TRANSFER_OUT");
    expect(rowType(null, "credit", "TRANSFER")).toBe("TRANSFER_IN");
  });
});

describe("normalizeRows", () => {
  it("descarta filas sin monto y une la contraparte", () => {
    const rows = normalizeRows(
      [
        { date_text: "17/11", description: "Pago móvil", amount_text: "-150,00", direction: "debit", counterparty: "Juan" },
        { date_text: "17/11", description: "Saldo", amount_text: "" },
      ],
      "AUTO",
      TODAY,
    );
    expect(rows).toEqual([{ date: "2026-11-17", description: "Pago móvil · Juan", amount: "150.00", type: "EXPENSE", reference: null }]);
  });
  it("sin fecha legible usa hoy", () => {
    expect(normalizeRows([{ amount_text: "10" }], "INCOME", TODAY)[0].date).toBe(TODAY);
  });
});
