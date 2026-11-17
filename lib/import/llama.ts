import "server-only";
import type { RawRow } from "@/lib/import/normalize";

const BASE = "https://api.cloud.llamaindex.ai";

export type CaptureKind = "STATEMENT" | "RECEIPT";

function apiKey() {
  const key = process.env.LLAMA_CLOUD_API_KEY;
  if (!key) throw new Error("Falta configurar LLAMA_CLOUD_API_KEY");
  return key;
}

/** `?project_id=` solo si se configuró uno; si no, LlamaCloud usa el proyecto por defecto. */
function withProject(path: string) {
  const project = process.env.LLAMA_CLOUD_PROJECT_ID;
  return `${BASE}${path}${project ? `?project_id=${encodeURIComponent(project)}` : ""}`;
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers }, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LlamaCloud ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

const row = {
  date_text: { type: "string", description: "Fecha exactamente como aparece (p. ej. 17/11/2026, 17 nov, 17-11)." },
  date_iso: { type: "string", description: "La misma fecha en formato YYYY-MM-DD si el año es visible; si no, vacío." },
  description: { type: "string", description: "Concepto o descripción del movimiento, tal como aparece." },
  amount_text: {
    type: "string",
    description:
      "Monto exactamente como aparece, conservando signo (-, +), paréntesis y separadores (p. ej. -1.234,56). No incluyas el saldo.",
  },
  direction: {
    type: "string",
    enum: ["debit", "credit", "unknown"],
    description: "debit si el dinero sale de la cuenta (cargo, débito, pago, envío); credit si entra (abono, crédito, recibido).",
  },
  reference: { type: "string", description: "Número de referencia u operación, si aparece." },
} as const;

const STATEMENT_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      description: "Todos los movimientos visibles, en orden. No incluyas saldos, totales ni encabezados.",
      items: { type: "object", properties: row, required: ["description", "amount_text", "direction"] },
    },
  },
  required: ["transactions"],
};

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    ...row,
    counterparty: { type: "string", description: "Persona o comercio al que se paga o del que se recibe." },
  },
  required: ["amount_text", "direction"],
};

const SYSTEM_PROMPT =
  "Son capturas de pantalla o estados de cuenta de bancos (muchos de Venezuela, con montos como 1.234,56). " +
  "Copia fechas y montos tal como aparecen, sin convertirlos. Ignora saldos disponibles y totales.";

/** Sube el archivo a LlamaCloud y lanza la extracción. Devuelve el id del job. */
export async function startExtractJob(file: Blob, filename: string, kind: CaptureKind) {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("purpose", "extract");
  const uploaded = await call<{ id: string }>(withProject("/api/v1/beta/files"), { method: "POST", body: form });

  const job = await call<{ id: string }>(withProject("/api/v2/extract"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_input: uploaded.id,
      configuration: {
        tier: "agentic",
        data_schema: kind === "STATEMENT" ? STATEMENT_SCHEMA : RECEIPT_SCHEMA,
        extraction_target: "per_doc",
        system_prompt: SYSTEM_PROMPT,
      },
    }),
  });
  return job.id;
}

export type ExtractStatus = { state: "pending" } | { state: "failed"; error: string } | { state: "done"; rows: RawRow[] };

const FAILED = ["FAILED", "ERROR", "CANCELLED", "CANCELED"];

/** Estado del job y, si terminó, las filas extraídas. */
export async function getExtractJob(jobId: string, kind: CaptureKind): Promise<ExtractStatus> {
  const job = await call<{ status?: string; extract_result?: unknown; error?: string; error_message?: string }>(
    withProject(`/api/v2/extract/${encodeURIComponent(jobId)}`),
    { method: "GET" },
  );
  const status = (job.status ?? "").toUpperCase();
  if (FAILED.includes(status)) return { state: "failed", error: job.error_message ?? job.error ?? "La extracción falló" };
  if (status !== "COMPLETED" && status !== "SUCCESS") return { state: "pending" };

  // Con extraction_target per_doc el resultado es un objeto; por si acaso, se aceptan listas
  const results = Array.isArray(job.extract_result) ? job.extract_result : [job.extract_result];
  const rows: RawRow[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const data = ("data" in r && r.data && typeof r.data === "object" ? r.data : r) as Record<string, unknown>;
    if (kind === "STATEMENT") {
      if (Array.isArray(data.transactions)) rows.push(...(data.transactions as RawRow[]));
    } else {
      rows.push(data as RawRow);
    }
  }
  return { state: "done", rows };
}
