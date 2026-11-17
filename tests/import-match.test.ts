import { describe, expect, it } from "vitest";
import { matchTransfers, type MatchRow } from "@/lib/import/match";

const row = (key: string, walletId: string, currency: string, type: MatchRow["type"], amount: string, date: string): MatchRow => ({
  key,
  walletId,
  currency,
  type,
  amount,
  date,
});

describe("matchTransfers", () => {
  it("empareja el mismo monto entre cuentas de la misma divisa", () => {
    const pairs = matchTransfers(
      [row("a", "w1", "USD", "TRANSFER_OUT", "100", "2026-11-10"), row("b", "w2", "USD", "TRANSFER_IN", "100", "2026-11-11")],
      {},
    );
    expect(pairs).toEqual([{ outKey: "a", inKey: "b", fee: null, suggested: false }]);
  });

  it("no empareja en la misma cuenta ni a más de 3 días", () => {
    expect(
      matchTransfers(
        [
          row("a", "w1", "USD", "TRANSFER_OUT", "100", "2026-11-10"),
          row("b", "w1", "USD", "TRANSFER_IN", "100", "2026-11-10"),
          row("c", "w2", "USD", "TRANSFER_IN", "100", "2026-11-14"),
        ],
        {},
      ),
    ).toEqual([]);
  });

  it("toma una diferencia pequeña como comisión", () => {
    const [pair] = matchTransfers(
      [row("a", "w1", "USD", "TRANSFER_OUT", "100.50", "2026-11-10"), row("b", "w2", "USD", "TRANSFER_IN", "100", "2026-11-10")],
      {},
    );
    expect(pair.fee).toBe("0.5");
  });

  it("entre VES y USD usa la tasa del día con tolerancia", () => {
    const pairs = matchTransfers(
      [row("a", "w1", "VES", "TRANSFER_OUT", "4000", "2026-11-10"), row("b", "w2", "USD", "TRANSFER_IN", "9.8", "2026-11-10")],
      { "2026-11-10": "400" },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].fee).toBeNull();
    expect(
      matchTransfers(
        [row("a", "w1", "VES", "TRANSFER_OUT", "4000", "2026-11-10"), row("b", "w2", "USD", "TRANSFER_IN", "9", "2026-11-10")],
        { "2026-11-10": "400" },
      ),
    ).toEqual([]);
  });

  it("sugiere gastos/ingresos que coinciden y no usa una fila dos veces", () => {
    const pairs = matchTransfers(
      [
        row("a", "w1", "USD", "EXPENSE", "50", "2026-11-10"),
        row("b", "w2", "USD", "INCOME", "50", "2026-11-12"),
        row("c", "w3", "USD", "TRANSFER_IN", "50", "2026-11-10"),
      ],
      {},
    );
    expect(pairs).toEqual([{ outKey: "a", inKey: "c", fee: null, suggested: true }]);
  });

  it("prefiere pares en que ambas filas son transferencias", () => {
    const pairs = matchTransfers(
      [
        row("a", "w1", "USD", "TRANSFER_OUT", "20", "2026-11-10"),
        row("b", "w2", "USD", "INCOME", "20", "2026-11-10"),
        row("c", "w3", "USD", "TRANSFER_IN", "20", "2026-11-12"),
      ],
      {},
    );
    expect(pairs).toEqual([{ outKey: "a", inKey: "c", fee: null, suggested: false }]);
  });
});
