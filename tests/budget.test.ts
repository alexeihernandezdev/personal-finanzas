import { describe, expect, it } from "vitest";
import { bucketShares, computeBudget, formatPercent, nextDueDate, planFixedReserve } from "@/lib/budget";
import { Decimal } from "@/lib/money";

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

describe("nextDueDate", () => {
  it("si no se pagó este mes, vence este mes (aunque ya haya pasado)", () => {
    expect(nextDueDate(5, "2026-11", false).toISOString().slice(0, 10)).toBe("2026-11-05");
  });
  it("si ya se pagó, el próximo es el del mes siguiente", () => {
    expect(nextDueDate(5, "2026-12", true).toISOString().slice(0, 10)).toBe("2027-01-05");
  });
  it("ajusta el día al último del mes", () => {
    expect(nextDueDate(31, "2027-02", false).toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(nextDueDate(31, "2027-01", true).toISOString().slice(0, 10)).toBe("2027-02-28");
  });
});

const due = (day: number) => new Date(Date.UTC(2026, 10, day));
const expense = (id: string, amount: string, day: number, pocketKey = "fijos") => ({ id, pocketKey, amount, dueDate: due(day) });

describe("planFixedReserve", () => {
  it("con un saldo parcial cubre primero el que vence antes", () => {
    const plan = planFixedReserve([expense("internet", "50", 20), expense("alquiler", "300", 1)], new Map([["fijos", "320"]]));
    expect(plan.items.map((i) => [i.id, i.covered.toFixed(2), i.missing.toFixed(2)])).toEqual([
      ["alquiler", "300.00", "0.00"],
      ["internet", "20.00", "30.00"],
    ]);
    expect(plan.pockets[0].missing.toFixed(2)).toBe("30.00");
  });
  it("suma el colchón a la meta y lo cubre al final", () => {
    const plan = planFixedReserve([expense("alquiler", "300", 1)], new Map([["fijos", "310"]]), "10");
    const p = plan.pockets[0];
    expect(p.target.toFixed(2)).toBe("330.00");
    expect(p.bufferMissing.toFixed(2)).toBe("20.00");
    expect(p.missing.toFixed(2)).toBe("20.00");
  });
  it("cada apartado tiene su propia meta", () => {
    const plan = planFixedReserve(
      [expense("alquiler", "300", 1, "a"), expense("hosting", "40", 3, "b")],
      new Map([["a", "300"]]),
    );
    expect(plan.pockets.map((p) => [p.key, p.missing.toFixed(2)])).toEqual([
      ["a", "0.00"],
      ["b", "40.00"],
    ]);
  });
  it("si el saldo alcanza no falta nada", () => {
    const plan = planFixedReserve([expense("alquiler", "300", 1)], new Map([["fijos", "500"]]), "10");
    expect(plan.pockets[0].missing.isZero()).toBe(true);
    expect(plan.items[0].missing.isZero()).toBe(true);
  });
});

describe("bucketShares", () => {
  it("a fin de mes cada partida recibe su % del ingreso fijo aunque entre por quincenas", () => {
    const buckets = [{ percent: "20" }, { percent: "10" }, { percent: "10" }];
    const shares = bucketShares("1000", "400", buckets);
    // 1ª quincena: 500 → 400 a gastos fijos, sobran 100; 2ª quincena: los fijos ya están cubiertos, sobran 500
    const totals = shares.map((s) => new Decimal(100).add(500).mul(s).div(100));
    expect(totals.map((t) => t.toFixed(2))).toEqual(["200.00", "100.00", "100.00"]);
  });
  it("si las partidas no caben en lo que sobra, se escalan a 100%", () => {
    const shares = bucketShares("1000", "800", [{ percent: "20" }, { percent: "20" }]);
    expect(shares.map((s) => s.toFixed(2))).toEqual(["50.00", "50.00"]);
  });
  it("sin ingresos fijos usa el % configurado", () => {
    expect(bucketShares("0", "0", [{ percent: "20" }]).map((s) => s.toFixed(2))).toEqual(["20.00"]);
  });
});
