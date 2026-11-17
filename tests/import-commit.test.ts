import { describe, expect, it } from "vitest";
import { buildCommit, type ReviewRow } from "@/components/import/model";

const wallets = [
  { id: "usd1", name: "Zelle", currencyCode: "USD" },
  { id: "usd2", name: "Binance", currencyCode: "USD" },
  { id: "ves", name: "Banco", currencyCode: "VES" },
];

const base: ReviewRow = {
  key: "",
  source: "x.png",
  include: true,
  duplicate: false,
  walletId: "usd1",
  type: "EXPENSE",
  date: "2026-11-10",
  description: "",
  amount: "10",
  reference: null,
  categoryId: "",
  businessId: "",
  debtId: "",
  receivableId: "",
  counterWalletId: "",
  counterAmount: "",
};
const r = (p: Partial<ReviewRow>): ReviewRow => ({ ...base, ...p });

describe("buildCommit", () => {
  it("un par con comisión: lo enviado + la comisión = lo que salió", () => {
    const { payload, problems } = buildCommit(
      [r({ key: "a", type: "TRANSFER_OUT", amount: "100,50" }), r({ key: "b", walletId: "usd2", type: "TRANSFER_IN", amount: "100" })],
      [{ outKey: "a", inKey: "b", fee: "0.5", description: "", accepted: true }],
      wallets,
      true,
    );
    expect(problems).toEqual([]);
    expect(payload.items).toEqual([
      { kind: "transfer", fromWalletId: "usd1", toWalletId: "usd2", amountOut: "100", amountIn: "100", fee: "0.5", date: "2026-11-10", description: "" },
    ]);
  });

  it("las sugerencias no aceptadas se guardan como movimientos sueltos", () => {
    const { payload } = buildCommit(
      [r({ key: "a", amount: "5" }), r({ key: "b", walletId: "usd2", type: "INCOME", amount: "5", categoryId: "c1" })],
      [{ outKey: "a", inKey: "b", fee: "0", description: "", accepted: false }],
      wallets,
      false,
    );
    expect(payload.items.map((i) => i.kind)).toEqual(["movement", "movement"]);
    expect(payload.items[1]).toMatchObject({ type: "INCOME", categoryId: "c1" });
  });

  it("transferencia sin pareja entre divisas pide el otro monto", () => {
    const row = r({ key: "a", walletId: "ves", type: "TRANSFER_OUT", amount: "4.000,00", counterWalletId: "usd1" });
    expect(buildCommit([row], [], wallets, true).problems).toHaveLength(1);
    const { payload, problems } = buildCommit([{ ...row, counterAmount: "10" }], [], wallets, true);
    expect(problems).toEqual([]);
    expect(payload.items[0]).toMatchObject({ fromWalletId: "ves", toWalletId: "usd1", amountOut: "4000.00", amountIn: "10" });
  });

  it("omite las filas excluidas", () => {
    expect(buildCommit([r({ key: "a", include: false })], [], wallets, true).payload.items).toEqual([]);
  });

  it("asocia gastos a deudas e ingresos a cobros, sin pasarse de lo que falta", () => {
    const debts = [{ id: "d1", name: "Ana", loan: false, currencyCode: "USD", remaining: "30" }];
    const rows = [
      r({ key: "a", amount: "20", debtId: "d1", categoryId: "c9" }),
      r({ key: "b", type: "INCOME", amount: "5", receivableId: "r1" }),
      // Un ingreso no puede pagar una deuda: el enlace se ignora
      r({ key: "c", type: "INCOME", amount: "1", debtId: "d1" }),
    ];
    const { payload, problems } = buildCommit(rows, [], wallets, true, debts);
    expect(problems).toEqual([]);
    expect(payload.items[0]).toMatchObject({ debtId: "d1", receivableId: null });
    expect(payload.items[1]).toMatchObject({ debtId: null, receivableId: "r1" });
    expect(payload.items[2]).toMatchObject({ debtId: null, receivableId: null });

    const over = buildCommit([...rows, r({ key: "d", amount: "15", debtId: "d1" })], [], wallets, true, debts);
    expect(over.problems).toEqual(["Ana: solo faltan 30 USD"]);
  });
});
