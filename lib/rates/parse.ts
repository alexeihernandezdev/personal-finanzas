// Parsers puros (sin red) para poder probarlos con fixtures.
import * as cheerio from "cheerio";

export function parseDolarApi(json: unknown): number | null {
  const promedio = (json as { promedio?: unknown })?.promedio;
  const n = typeof promedio === "string" ? Number(promedio) : promedio;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Extrae la tasa USD de la portada de bcv.org.ve (formato "889,25530000"). */
export function parseBcvHtml(html: string): number | null {
  const $ = cheerio.load(html);
  const raw = $("#dolar strong").first().text().trim();
  if (!raw) return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mediana de los precios de los anuncios P2P de Binance. */
export function parseBinanceP2P(json: unknown): number | null {
  const data = (json as { data?: { adv?: { price?: string } }[] })?.data;
  if (!Array.isArray(data)) return null;
  const prices = data
    .map((d) => Number(d.adv?.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
}
