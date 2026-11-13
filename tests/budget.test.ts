import { describe, expect, it } from "vitest";
import { computeBudget, formatPercent, isDueInMonth, nextDueMonth, planDistribution } from "@/lib/budget";

const pocket = (name: string, percent: string) => ({ id: name, name, percent, color: "#000000" });

describe("computeBudget", () => {
  it("calcula el porcentaje de gastos fijos y lo que queda libre", () => {
    const b = computeBudget("1000", "450", [pocket("Ahorro", "20"), pocket("Diversión", "10")]);
    expect(b.fixedPercent.toFixed(2)).toBe("45.00");
    expect(b.pockets.map((x) => x.amount.toFixed(2))).toEqual(["200.00", "100.00"]);
    expect(b.assignedPercent.toFixed(2)).toBe("30.00");
    expect(b.free.toFixed(2)).toBe("250.00");
    expect(b.freePercent.toFixed(2)).toBe("25.00");
    expect(b.overBudget).toBe(false);
  });
  it("suma el colchón como porcentaje de los gastos fijos", () => {
    const b = computeBudget("1000", "400", [pocket("Ahorro", "20")], "10");
    expect(b.buffer.toFixed(2)).toBe("40.00");
    expect(b.bufferIncomePercent.toFixed(2)).toBe("4.00");
    expect(b.free.toFixed(2)).toBe("360.00");
    expect(b.freePercent.toFixed(2)).toBe("36.00");
  });
  it("detecta cuando se asigna más de lo que entra", () => {
    const b = computeBudget("1000", "800", [pocket("Ahorro", "30")]);
    expect(b.free.toFixed(2)).toBe("-100.00");
    expect(b.freePercent.toFixed(2)).toBe("-10.00");
    expect(b.overBudget).toBe(true);
  });
  it("sin ingresos no divide entre cero", () => {
    const b = computeBudget("0", "100", [pocket("Ahorro", "20")]);
    expect(b.fixedPercent.toString()).toBe("0");
    expect(b.freePercent.toString()).toBe("0");
    expect(b.overBudget).toBe(true);
  });
});

describe("formatPercent", () => {
  it("usa coma decimal y un decimal como máximo", () => {
    expect(formatPercent("12.345")).toBe("12,3%");
    expect(formatPercent("20")).toBe("20%");
  });
});

describe("gastos fijos no mensuales", () => {
  const anual = { intervalMonths: 12, startMonth: "2026-03" };
  const trimestral = { intervalMonths: 3, startMonth: "2026-11" };
  it("vence solo en los meses que le tocan", () => {
    expect(isDueInMonth(anual, "2027-03")).toBe(true);
    expect(isDueInMonth(anual, "2026-11")).toBe(false);
    expect(isDueInMonth(trimestral, "2027-02")).toBe(true);
    expect(isDueInMonth(trimestral, "2027-01")).toBe(false);
    // Antes de su mes de inicio no vence
    expect(isDueInMonth(trimestral, "2026-08")).toBe(false);
    expect(isDueInMonth({ intervalMonths: 1, startMonth: null }, "2026-08")).toBe(true);
  });
  it("calcula el próximo mes de pago", () => {
    expect(nextDueMonth(anual, "2026-11")).toBe("2027-03");
    expect(nextDueMonth(trimestral, "2026-11")).toBe("2026-11");
    expect(nextDueMonth(trimestral, "2026-12")).toBe("2027-02");
    expect(nextDueMonth({ intervalMonths: 6, startMonth: "2027-05" }, "2026-11")).toBe("2027-05");
  });
});

describe("planDistribution", () => {
  const amounts = (r: ReturnType<typeof planDistribution>) => ({
    fixed: r.fixed.toFixed(2),
    parts: r.parts.map((p) => p.toFixed(2)),
    free: r.free.toFixed(2),
  });

  it("con ingreso fijo, los gastos fijos se llevan su % real y cada apartado el suyo", () => {
    // Ingreso fijo 1000, gastos fijos 450 → 45% de cada ingreso
    const r = planDistribution("1000", { planIncome: "1000", planFixed: "450", percents: ["20", "10", "10"] });
    expect(amounts(r)).toEqual({ fixed: "450.00", parts: ["200.00", "100.00", "100.00"], free: "150.00" });
  });

  it("es proporcional aunque el ingreso llegue por partes", () => {
    const r = planDistribution("500", { planIncome: "1000", planFixed: "450", percents: ["20"] });
    expect(amounts(r)).toEqual({ fixed: "225.00", parts: ["100.00"], free: "175.00" });
  });

  it("sin ingreso fijo, los gastos fijos se llevan lo que les falta del mes", () => {
    const r = planDistribution("300", { planIncome: "0", planFixed: "450", fixedMissing: "120", percents: ["10"] });
    expect(amounts(r)).toEqual({ fixed: "120.00", parts: ["30.00"], free: "150.00" });
  });

  it("si los apartados no caben, se reducen en proporción", () => {
    const r = planDistribution("1000", { planIncome: "1000", planFixed: "800", percents: ["20", "20"] });
    expect(amounts(r)).toEqual({ fixed: "800.00", parts: ["100.00", "100.00"], free: "0.00" });
  });

  it("los gastos fijos nunca se llevan más que el ingreso", () => {
    const r = planDistribution("100", { planIncome: "100", planFixed: "300", percents: ["10"] });
    expect(amounts(r)).toEqual({ fixed: "100.00", parts: ["0.00"], free: "0.00" });
  });
});
