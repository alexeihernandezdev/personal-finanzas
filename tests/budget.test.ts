import { describe, expect, it } from "vitest";
import { computeBudget, formatPercent } from "@/lib/budget";

const bucket = (name: string, percent: string) => ({ id: name, name, percent, color: "#000000" });

describe("computeBudget", () => {
  it("calcula el porcentaje de gastos fijos y lo que queda libre", () => {
    const b = computeBudget("1000", "450", [bucket("Ahorro", "20"), bucket("Diversión", "10")]);
    expect(b.fixedPercent.toFixed(2)).toBe("45.00");
    expect(b.buckets.map((x) => x.amount.toFixed(2))).toEqual(["200.00", "100.00"]);
    expect(b.assignedPercent.toFixed(2)).toBe("30.00");
    expect(b.free.toFixed(2)).toBe("250.00");
    expect(b.freePercent.toFixed(2)).toBe("25.00");
    expect(b.overBudget).toBe(false);
  });
  it("suma el colchón como porcentaje de los gastos fijos", () => {
    const b = computeBudget("1000", "400", [bucket("Ahorro", "20")], "10");
    expect(b.buffer.toFixed(2)).toBe("40.00");
    expect(b.bufferIncomePercent.toFixed(2)).toBe("4.00");
    expect(b.free.toFixed(2)).toBe("360.00");
    expect(b.freePercent.toFixed(2)).toBe("36.00");
  });
  it("detecta cuando se asigna más de lo que entra", () => {
    const b = computeBudget("1000", "800", [bucket("Ahorro", "30")]);
    expect(b.free.toFixed(2)).toBe("-100.00");
    expect(b.freePercent.toFixed(2)).toBe("-10.00");
    expect(b.overBudget).toBe(true);
  });
  it("sin ingresos no divide entre cero", () => {
    const b = computeBudget("0", "100", [bucket("Ahorro", "20")]);
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
