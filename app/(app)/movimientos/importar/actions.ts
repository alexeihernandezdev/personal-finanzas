"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/dal";
import { getCollectionCategoryId, getDebtPaymentCategoryId, getFeeCategoryId } from "@/lib/defaults";
import { snapshotRate } from "@/lib/guards";
import { deliveryUrl, destroyUpload, importFolder, signedUploadParams } from "@/lib/import/cloudinary";
import { getExtractJob, startExtractJob } from "@/lib/import/llama";
import { normalizeRows, type ImportRowType, type ParsedRow } from "@/lib/import/normalize";
import { dec, INFLOW_TYPES } from "@/lib/money";
import { AUTO_POCKET, pocketFailure } from "@/lib/pockets";
import { collectedAmount, currentFallbackRate, paidAmount } from "@/lib/queries";
import { getRatesForDates } from "@/lib/rates";
import { exceedsRemaining, insertDebtPayment, insertReceivablePayment } from "@/lib/settlements";
import { impliedRate, insertTransaction, insertTransfer } from "@/lib/transactions";
import { parseISODate, todayISO } from "@/lib/utils";
import { importCommitSchema, type ImportCommit } from "@/lib/validators";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_BYTES = 20 * 1024 * 1024;

/** Firma para que el navegador suba la captura directo a Cloudinary. */
export async function getUploadSignature(): Promise<Result<ReturnType<typeof signedUploadParams>>> {
  const user = await requireUser();
  try {
    return { ok: true, ...signedUploadParams(user.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cloudinary no está configurado" };
  }
}

const startSchema = z.object({
  publicId: z.string().min(1).max(300),
  format: z.string().regex(/^[a-z0-9]{0,10}$/i),
  resourceType: z.enum(["image", "raw"]),
  kind: z.enum(["STATEMENT", "RECEIPT"]),
  hint: z.enum(["AUTO", "EXPENSE", "INCOME", "TRANSFER"]),
  walletId: z.string().min(1),
});
type JobInfo = z.infer<typeof startSchema> & { jobId: string; uid: string };

// El token lleva los datos del job firmados: así nadie consulta jobs ni borra archivos ajenos
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("Falta AUTH_SECRET");
  return s;
}
function signToken(info: JobInfo) {
  const body = Buffer.from(JSON.stringify(info)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function readToken(token: string, uid: string): JobInfo | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const info = JSON.parse(Buffer.from(body, "base64url").toString()) as JobInfo;
  return info.uid === uid ? info : null;
}

/** Descarga la captura de Cloudinary y lanza su extracción en LlamaCloud. */
export async function startExtraction(input: z.input<typeof startSchema>): Promise<Result<{ token: string }>> {
  const user = await requireUser();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const data = parsed.data;
  if (!data.publicId.startsWith(`${importFolder(user.id)}/`)) return { ok: false, error: "Archivo no encontrado" };
  const wallet = await prisma.wallet.findFirst({ where: { id: data.walletId, userId: user.id } });
  if (!wallet) return { ok: false, error: "Cuenta no encontrada" };

  try {
    const res = await fetch(deliveryUrl(data.publicId, data.resourceType, data.format), { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo leer la captura (${res.status})`);
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) throw new Error("El archivo pesa más de 20 MB");
    const filename = `${data.publicId.split("/").pop()}${data.format ? `.${data.format}` : ""}`;
    const jobId = await startExtractJob(blob, filename, data.kind);
    return { ok: true, token: signToken({ ...data, jobId, uid: user.id }) };
  } catch (e) {
    await destroyUpload(data.publicId, data.resourceType);
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo procesar la captura" };
  }
}

export type ExtractedRow = ParsedRow & { duplicate: boolean };

/** Consulta el job; al terminar borra la captura y devuelve las filas normalizadas. */
export async function checkExtraction(
  token: string,
): Promise<Result<{ state: "pending" } | { state: "done"; rows: ExtractedRow[] }>> {
  const user = await requireUser();
  const info = readToken(token, user.id);
  if (!info) return { ok: false, error: "Importación no encontrada" };

  let status;
  try {
    status = await getExtractJob(info.jobId, info.kind);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo consultar la extracción" };
  }
  if (status.state === "pending") return { ok: true, state: "pending" };
  await destroyUpload(info.publicId, info.resourceType);
  if (status.state === "failed") return { ok: false, error: status.error };

  const rows = normalizeRows(status.rows, info.hint, todayISO());
  return { ok: true, state: "done", rows: await markDuplicates(user.id, info.walletId, rows) };
}

const isInflow = (t: string) => (INFLOW_TYPES as readonly string[]).includes(t);
const rowInflow = (t: ImportRowType) => t === "INCOME" || t === "TRANSFER_IN";

/** Marca las filas que ya existen en la cuenta: misma fecha, monto y sentido. */
async function markDuplicates(userId: string, walletId: string, rows: ParsedRow[]): Promise<ExtractedRow[]> {
  if (!rows.length) return [];
  const dates = [...new Set(rows.map((r) => r.date))];
  const existing = await prisma.transaction.findMany({
    where: { userId, walletId, date: { in: dates.map(parseISODate) } },
    select: { date: true, amount: true, type: true },
  });
  const seen = new Set(existing.map((t) => `${t.date.toISOString().slice(0, 10)}|${dec(t.amount).toString()}|${isInflow(t.type)}`));
  return rows.map((r) => ({ ...r, duplicate: seen.has(`${r.date}|${dec(r.amount).toString()}|${rowInflow(r.type)}`) }));
}

/** Tasas VES por USD para varias fechas: la de cada día, o la actual para hoy y fechas futuras. */
export async function getImportRates(dates: string[]): Promise<Record<string, string | null>> {
  const user = await requireUser();
  const valid = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].slice(0, 400);
  return Object.fromEntries((await ratesFor(user.preferredRateSource, valid)).map(([d, r]) => [d, r.rateVesPerUsd]));
}

type Rate = { rateVesPerUsd: string | null; rateSource: "BCV" | "BINANCE" | null };

async function ratesFor(source: "BCV" | "BINANCE", dates: string[]): Promise<[string, Rate][]> {
  const today = todayISO();
  const past = dates.filter((d) => d < today);
  const [history, current] = await Promise.all([
    getRatesForDates(past.map(parseISODate), source),
    dates.some((d) => d >= today) ? snapshotRate(source) : null,
  ]);
  return dates.map((d) => {
    if (d >= today) return [d, current!];
    const rate = history.get(d) ?? null;
    return [d, { rateVesPerUsd: rate?.toString() ?? null, rateSource: rate ? source : null }];
  });
}

/** Guarda los movimientos revisados: ingresos, gastos y transferencias, todo o nada. */
export async function commitImport(payload: ImportCommit): Promise<{ ok: false; error: string } | undefined> {
  const user = await requireUser();
  const parsed = importCommitSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const { items, pockets } = parsed.data;

  const movements = items.filter((i) => i.kind === "movement");
  const transfers = items.filter((i) => i.kind === "transfer");

  // Todo lo que llega del cliente tiene que ser del usuario
  const walletIds = new Set([...movements.map((m) => m.walletId), ...transfers.flatMap((t) => [t.fromWalletId, t.toWalletId])]);
  const categoryIds = new Set(movements.map((m) => m.categoryId).filter((v): v is string => Boolean(v)));
  const businessIds = new Set(movements.map((m) => m.businessId).filter((v): v is string => Boolean(v)));
  const [wallets, categories, businessCount] = await Promise.all([
    prisma.wallet.findMany({ where: { userId: user.id, id: { in: [...walletIds] } }, select: { id: true, name: true, currencyCode: true } }),
    prisma.category.findMany({ where: { userId: user.id, id: { in: [...categoryIds] } }, select: { id: true, kind: true } }),
    prisma.business.count({ where: { userId: user.id, id: { in: [...businessIds] } } }),
  ]);
  if (wallets.length !== walletIds.size || categories.length !== categoryIds.size || businessCount !== businessIds.size) {
    return { ok: false, error: "Cuenta, categoría o negocio inválido" };
  }
  const walletById = new Map(wallets.map((w) => [w.id, w]));
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  if (movements.some((m) => m.categoryId && kindById.get(m.categoryId) !== m.type)) {
    return { ok: false, error: "Hay una categoría que no corresponde al tipo de movimiento" };
  }
  if (transfers.some((t) => t.fromWalletId === t.toWalletId)) return { ok: false, error: "Una transferencia tiene la misma cuenta de origen y destino" };

  const rates = new Map(await ratesFor(user.preferredRateSource, [...new Set(items.map((i) => i.date))]));
  const hasFee = transfers.some((t) => dec(t.fee).gt(0));
  const feeCategoryId = hasFee ? await getFeeCategoryId(user.id) : null;

  // Pagos de deudas y cobros: registros abiertos del usuario, sin pasarse de lo que falta
  const settle = await loadSettlements(user.id, movements, walletById, rates);
  if (!settle.ok) return { ok: false, error: settle.error };

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const m of movements) {
          const settlement = {
            walletId: m.walletId,
            walletCurrency: walletById.get(m.walletId)!.currencyCode,
            amount: m.amount,
            date: m.date,
            pocketId: pockets ? AUTO_POCKET : undefined,
            rate: rates.get(m.date)!,
          };
          if (m.debtId) {
            const d = settle.debts.get(m.debtId)!;
            await insertDebtPayment(tx, user, d, { ...settlement, categoryId: settle.debtCategoryId });
            continue;
          }
          if (m.receivableId) {
            const r = settle.receivables.get(m.receivableId)!;
            await insertReceivablePayment(tx, user, r, { ...settlement, distribute: pockets, categoryId: settle.collectionCategoryId });
            continue;
          }
          await insertTransaction(
            tx,
            user,
            {
              type: m.type,
              walletId: m.walletId,
              amount: m.amount,
              date: m.date,
              categoryId: m.categoryId,
              description: m.description,
              businessId: m.businessId,
              pocketId: pockets ? AUTO_POCKET : undefined,
              distribute: pockets,
            },
            rates.get(m.date)!,
          );
        }
        for (const t of transfers) {
          const from = walletById.get(t.fromWalletId)!;
          const to = walletById.get(t.toWalletId)!;
          await insertTransfer(
            tx,
            user.id,
            { from, to, amountOut: t.amountOut, amountIn: t.amountIn, fee: t.fee, date: t.date, description: t.description, feeCategoryId },
            impliedRate(from.currencyCode, t.amountOut, to.currencyCode, t.amountIn) ?? rates.get(t.date)!,
          );
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (e) {
    const failure = pocketFailure(e);
    return { ok: false, error: failure?.error ?? "No se pudo guardar" };
  }

  revalidatePath("/", "layout");
  redirect(movements.some((m) => !m.categoryId) ? "/movimientos?categoria=sin" : "/movimientos");
}

type Movement = Extract<ImportCommit["items"][number], { kind: "movement" }>;

/**
 * Deudas y cuentas por cobrar a las que se asocian movimientos: deben ser del usuario, estar
 * abiertas y lo asociado a cada una no puede pasar de lo que falta.
 */
async function loadSettlements(
  userId: string,
  movements: Movement[],
  walletById: Map<string, { currencyCode: string }>,
  rates: Map<string, Rate>,
) {
  const debtIds = [...new Set(movements.map((m) => m.debtId).filter((v): v is string => Boolean(v)))];
  const receivableIds = [...new Set(movements.map((m) => m.receivableId).filter((v): v is string => Boolean(v)))];
  const open = { in: ["PENDING" as const, "PARTIAL" as const] };
  const include = { transactions: { include: { wallet: { select: { currencyCode: true } } } } };
  const [debts, receivables, fallback, debtCategoryId, collectionCategoryId] = await Promise.all([
    debtIds.length ? prisma.debt.findMany({ where: { userId, id: { in: debtIds }, status: open }, include }) : [],
    receivableIds.length ? prisma.receivable.findMany({ where: { userId, id: { in: receivableIds }, status: open }, include }) : [],
    debtIds.length || receivableIds.length ? currentFallbackRate() : null,
    debtIds.length ? getDebtPaymentCategoryId(userId) : null,
    receivableIds.length ? getCollectionCategoryId(userId) : null,
  ]);
  if (debts.length !== debtIds.length || receivables.length !== receivableIds.length) {
    return { ok: false as const, error: "Una deuda o cuenta por cobrar no existe o ya está cerrada" };
  }
  const paymentsOf = (pick: (m: Movement) => boolean) =>
    movements.filter(pick).map((m) => ({
      amount: m.amount,
      walletCurrency: walletById.get(m.walletId)!.currencyCode,
      rate: rates.get(m.date)?.rateVesPerUsd ?? null,
    }));
  for (const d of debts) {
    const remaining = dec(d.amount).sub(paidAmount(d, fallback));
    const error = exceedsRemaining(remaining, d.currencyCode, paymentsOf((m) => m.debtId === d.id), "pagar");
    if (error) return { ok: false as const, error: `${d.counterparty}: ${error}` };
  }
  for (const r of receivables) {
    const remaining = dec(r.amount).sub(collectedAmount(r, fallback));
    const error = exceedsRemaining(remaining, r.currencyCode, paymentsOf((m) => m.receivableId === r.id), "cobrar");
    if (error) return { ok: false as const, error: `${r.counterparty}: ${error}` };
  }
  return {
    ok: true as const,
    debts: new Map(debts.map((d) => [d.id, d])),
    receivables: new Map(receivables.map((r) => [r.id, r])),
    debtCategoryId,
    collectionCategoryId,
  };
}
