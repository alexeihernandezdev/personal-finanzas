import { describe, expect, it } from "vitest";
import { parseBcvHtml, parseBinanceP2P, parseDolarApi } from "@/lib/rates/parse";

describe("parsers de tasas", () => {
  it("dolarapi", () => {
    expect(parseDolarApi({ fuente: "oficial", promedio: 889.2553 })).toBe(889.2553);
    expect(parseDolarApi({ promedio: null })).toBeNull();
  });
  it("html del BCV", () => {
    const html = `<div id="dolar"><div><span>USD</span><strong> 889,25530000 </strong></div></div>`;
    expect(parseBcvHtml(html)).toBeCloseTo(889.2553);
    expect(parseBcvHtml("<html></html>")).toBeNull();
  });
  it("binance usa la mediana", () => {
    const json = { data: [{ adv: { price: "980.5" } }, { adv: { price: "990" } }, { adv: { price: "2000" } }] };
    expect(parseBinanceP2P(json)).toBe(990);
    expect(parseBinanceP2P({ data: [] })).toBeNull();
  });
});
