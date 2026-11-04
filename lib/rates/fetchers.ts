import "server-only";
import { Agent } from "undici";
import { parseBcvHtml, parseBinanceP2P, parseDolarApi } from "./parse";

const TIMEOUT = 15_000;

export async function fetchBcvRate(): Promise<number> {
  try {
    const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", {
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const rate = parseDolarApi(await res.json());
    if (rate) return rate;
  } catch {
    // seguimos con el respaldo
  }
  // Respaldo: la web del BCV suele tener la cadena de certificados incompleta,
  // por eso solo para este dominio se desactiva la verificación TLS.
  const res = await fetch("https://www.bcv.org.ve/", {
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
    // @ts-expect-error `dispatcher` es una opción de undici aceptada por el fetch de Node
    dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
  });
  const rate = parseBcvHtml(await res.text());
  if (!rate) throw new Error("No se pudo obtener la tasa BCV");
  return rate;
}

export async function fetchBinanceRate(tradeType: "BUY" | "SELL"): Promise<number> {
  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset: "USDT",
      fiat: "VES",
      tradeType,
      page: 1,
      rows: 10,
      payTypes: [],
      publisherType: null,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  const rate = parseBinanceP2P(await res.json());
  if (!rate) throw new Error(`No se pudo obtener la tasa Binance ${tradeType}`);
  return rate;
}
