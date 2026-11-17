import { normalizeAmount } from "@/lib/validators";

/** Sentido que el usuario indica para un lote de capturas. */
export type ImportHint = "AUTO" | "EXPENSE" | "INCOME" | "TRANSFER";
export type ImportRowType = "INCOME" | "EXPENSE" | "TRANSFER_OUT" | "TRANSFER_IN";

/** Fila tal como la devuelve el extractor. */
export type RawRow = {
  date_text?: string | null;
  date_iso?: string | null;
  description?: string | null;
  amount_text?: string | null;
  direction?: string | null;
  reference?: string | null;
  counterparty?: string | null;
};

export type ParsedRow = {
  date: string;
  description: string;
  /** Siempre positivo, normalizado ("1234.56") */
  amount: string;
  type: ImportRowType;
  reference: string | null;
};

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Año de 2 cifras → 20xx. */
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * Convierte la fecha de una captura a "YYYY-MM-DD". Acepta día primero (como en Venezuela):
 * "17/11/2026", "17-11-26", "17/11", "17 nov", "17 de noviembre de 2026", e ISO "2026-11-17".
 * Sin año usa el de `today`; si así queda en el futuro, el año anterior.
 */
export function parseRowDate(text: string | null | undefined, today: string): string | null {
  if (!text) return null;
  const s = text.trim().toLowerCase();
  const [ty] = today.split("-").map(Number);
  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;

  let match = s.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = match[3] ? fullYear(Number(match[3])) : null;
  } else if ((match = s.match(/(\d{1,2})\s*(?:de\s+)?([a-zé]{3,})\.?(?:\s*(?:de\s+)?(\d{2,4}))?/))) {
    d = Number(match[1]);
    m = MONTHS[match[2].slice(0, 3)] ?? null;
    y = match[3] ? fullYear(Number(match[3])) : null;
  }
  if (!d || !m) return null;
  const explicitYear = y !== null;
  y ??= ty;
  if (!validDate(y, m, d)) return null;
  let iso = `${y}-${pad(m)}-${pad(d)}`;
  if (!explicitYear && iso > today) iso = `${y - 1}-${pad(m)}-${pad(d)}`;
  return iso;
}

/** Monto positivo y signo de un texto como "-1.234,56", "(20,00)", "1.234,56-", "+ $ 5". */
export function parseSignedAmount(text: string | null | undefined): { amount: string; sign: "-" | "+" | null } | null {
  if (!text) return null;
  let s = text.trim().replace(/[−–—]/g, "-");
  let sign: "-" | "+" | null = null;
  if (/^\(.*\)$/.test(s)) {
    sign = "-";
    s = s.slice(1, -1);
  }
  // Letras sueltas (Bs, USD, VES, D/C…) y espacios fuera
  s = s.replace(/[a-z]+\.?/gi, "").replace(/\s/g, "");
  if (s.startsWith("-") || s.endsWith("-")) sign = "-";
  else if (s.startsWith("+")) sign = "+";
  s = s.replace(/^[-+]+|[-+]+$/g, "").replace(/[^\d.,]/g, "");
  const n = normalizeAmount(s);
  if (!n || Number(n) <= 0) return null;
  return { amount: n, sign };
}

/**
 * Decide si una fila sale o entra de la cuenta:
 * - negativo (o débito marcado con signo) → sale, siempre: es un gasto
 * - el sentido del lote manda en los positivos (Gasto / Ingreso)
 * - en Automático y Transferencias se usa la columna débito/crédito; si no se sabe, entra
 */
export function rowType(sign: "-" | "+" | null, direction: string | null | undefined, hint: ImportHint): ImportRowType {
  const dir = (direction ?? "").toLowerCase();
  let out: boolean;
  if (sign === "-") out = true;
  else if (hint === "EXPENSE") out = true;
  else if (hint === "INCOME") out = false;
  else if (sign === "+") out = false;
  else out = dir === "debit";
  if (hint === "TRANSFER") return out ? "TRANSFER_OUT" : "TRANSFER_IN";
  return out ? "EXPENSE" : "INCOME";
}

/** Convierte las filas del extractor en filas listas para revisar; descarta las que no tienen monto. */
export function normalizeRows(raw: RawRow[], hint: ImportHint, today: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const r of raw) {
    const parsed = parseSignedAmount(r.amount_text);
    if (!parsed) continue;
    const date = parseRowDate(r.date_text, today) ?? parseRowDate(r.date_iso, today) ?? today;
    const description = [r.description, r.counterparty && !r.description?.includes(r.counterparty) ? r.counterparty : null]
      .filter(Boolean)
      .join(" · ")
      .trim()
      .slice(0, 200);
    rows.push({
      date,
      description,
      amount: parsed.amount,
      type: rowType(parsed.sign, r.direction, hint),
      reference: r.reference?.trim() || null,
    });
  }
  return rows;
}
