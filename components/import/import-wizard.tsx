"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FileImage, Loader2, Upload, X } from "lucide-react";
import {
  checkExtraction,
  commitImport,
  getImportRates,
  getUploadSignature,
  startExtraction,
  type ExtractedRow,
} from "@/app/(app)/movimientos/importar/actions";
import { Badge, Button, Card, Checkbox, Field, Select } from "@/components/ui";
import type { ImportHint } from "@/lib/import/normalize";
import { matchTransfers } from "@/lib/import/match";
import { cn } from "@/lib/utils";
import { buildCommit, pairId, type Business, type Category, type Ledger, type Pair, type ReviewRow, type Wallet } from "./model";
import { PairCard, RowCard, SuggestionCard } from "./review";

type Job = { id: string; name: string; state: "uploading" | "scanning" | "done" | "error"; message?: string };

const HINTS: { value: ImportHint; label: string; hint: string }[] = [
  { value: "AUTO", label: "Automático", hint: "Lo negativo o débito es gasto; lo demás, ingreso" },
  { value: "EXPENSE", label: "Gastos", hint: "Todo es gasto" },
  { value: "INCOME", label: "Ingresos", hint: "Todo es ingreso, salvo lo que salga en negativo" },
  { value: "TRANSFER", label: "Transferencias", hint: "Movimientos entre tus cuentas: se emparejan con la otra captura" },
];

const POLL_MS = 2500;
const MAX_POLLS = 120; // ~5 minutos
const ACCEPT = "image/*,application/pdf";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const nextKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export function ImportWizard({
  wallets,
  categories,
  businesses,
  debts,
  receivables,
}: {
  wallets: Wallet[];
  categories: Category[];
  businesses: Business[];
  debts: Ledger[];
  receivables: Ledger[];
}) {
  // Lote a escanear
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [kind, setKind] = useState<"STATEMENT" | "RECEIPT">("STATEMENT");
  const [hint, setHint] = useState<ImportHint>("AUTO");
  const [businessId, setBusinessId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  // Revisión
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const rejected = useRef(new Set<string>());
  const rates = useRef<Record<string, string | null>>({});
  const [pockets, setPockets] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();

  // Las acciones async leen siempre el último estado
  const rowsRef = useRef(rows);
  const pairsRef = useRef(pairs);
  useEffect(() => {
    rowsRef.current = rows;
    pairsRef.current = pairs;
  });

  const updateJob = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  /** Busca transferencias entre las filas que todavía no están emparejadas ni descartadas. */
  async function rematch(current: ReviewRow[], currentPairs: Pair[]) {
    const used = new Set(currentPairs.flatMap((p) => [p.outKey, p.inKey]));
    const free = current.filter((r) => r.include && !used.has(r.key));
    const dates = [...new Set(free.map((r) => r.date))].filter((d) => !(d in rates.current));
    if (dates.length) Object.assign(rates.current, await getImportRates(dates));
    const currency = (id: string) => wallets.find((w) => w.id === id)?.currencyCode ?? "USD";
    const found = matchTransfers(
      free.map((r) => ({ key: r.key, walletId: r.walletId, currency: currency(r.walletId), type: r.type, amount: r.amount, date: r.date })),
      rates.current,
    ).filter((p) => !rejected.current.has(pairId(p)));
    if (!found.length) return;
    setPairs((prev) => {
      // Otra captura pudo emparejar estas filas mientras tanto
      const taken = new Set(prev.flatMap((p) => [p.outKey, p.inKey]));
      const fresh = found.filter((p) => !taken.has(p.outKey) && !taken.has(p.inKey));
      return [...prev, ...fresh.map((p) => ({ outKey: p.outKey, inKey: p.inKey, fee: p.fee ?? "0", description: "", accepted: !p.suggested }))];
    });
  }

  async function scanFile(file: File, batch: { walletId: string; kind: typeof kind; hint: ImportHint; businessId: string }) {
    const id = nextKey();
    setJobs((js) => [...js, { id, name: file.name, state: "uploading" }]);
    try {
      const sig = await getUploadSignature();
      if (!sig.ok) throw new Error(sig.error);
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("folder", sig.folder);
      form.append("signature", sig.signature);
      const res = await fetch(sig.uploadUrl, { method: "POST", body: form });
      const uploaded = (await res.json()) as { public_id?: string; format?: string; resource_type?: string; error?: { message: string } };
      if (!res.ok || !uploaded.public_id) throw new Error(uploaded.error?.message ?? "No se pudo subir la captura");

      updateJob(id, { state: "scanning" });
      const started = await startExtraction({
        publicId: uploaded.public_id,
        format: uploaded.format ?? "",
        resourceType: uploaded.resource_type === "raw" ? "raw" : "image",
        kind: batch.kind,
        hint: batch.hint,
        walletId: batch.walletId,
      });
      if (!started.ok) throw new Error(started.error);

      let extracted: ExtractedRow[] | null = null;
      for (let i = 0; i < MAX_POLLS && !extracted; i++) {
        await sleep(POLL_MS);
        const status = await checkExtraction(started.token);
        if (!status.ok) throw new Error(status.error);
        if (status.state === "done") extracted = status.rows;
      }
      if (!extracted) throw new Error("La extracción tardó demasiado");

      const added: ReviewRow[] = extracted.map((r) => ({
        key: nextKey(),
        source: file.name,
        include: !r.duplicate,
        duplicate: r.duplicate,
        walletId: batch.walletId,
        type: r.type,
        date: r.date,
        description: r.description,
        amount: r.amount,
        reference: r.reference,
        categoryId: "",
        businessId: batch.businessId,
        debtId: "",
        receivableId: "",
        counterWalletId: "",
        counterAmount: "",
      }));
      const next = [...rowsRef.current, ...added];
      rowsRef.current = next;
      setRows((rs) => [...rs, ...added]);
      updateJob(id, {
        state: "done",
        message: added.length ? `${added.length} ${added.length === 1 ? "movimiento" : "movimientos"}` : "No se encontraron movimientos",
      });
      await rematch(next, pairsRef.current);
    } catch (e) {
      updateJob(id, { state: "error", message: e instanceof Error ? e.message : "Error" });
    }
  }

  function onScan() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (!files.length || !walletId) return;
    const batch = { walletId, kind, hint, businessId };
    // Se escanean en paralelo; Next.js despacha las server actions una a una, pero subir y esperar no bloquea
    void Promise.all(files.map((f) => scanFile(f, batch)));
    if (fileRef.current) fileRef.current.value = "";
  }

  const patchRow = (key: string, patch: Partial<ReviewRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const acceptPair = (p: Pair) => {
    setPairs((ps) => ps.map((x) => (pairId(x) === pairId(p) ? { ...x, accepted: true } : x)));
    patchRow(p.outKey, { type: "TRANSFER_OUT" });
    patchRow(p.inKey, { type: "TRANSFER_IN" });
  };
  const dropPair = (p: Pair) => {
    rejected.current.add(pairId(p));
    setPairs((ps) => ps.filter((x) => pairId(x) !== pairId(p)));
  };
  /** Empareja a mano una transferencia con otra fila (de otra cuenta). */
  const linkRows = (key: string, otherKey: string) => {
    const a = rows.find((r) => r.key === key);
    if (!a) return;
    const out = a.type === "TRANSFER_OUT" ? key : otherKey;
    const inn = out === key ? otherKey : key;
    setPairs((ps) => [
      ...ps.filter((p) => ![p.outKey, p.inKey].some((k) => k === key || k === otherKey)),
      { outKey: out, inKey: inn, fee: "0", description: "", accepted: true },
    ]);
    patchRow(out, { type: "TRANSFER_OUT", counterWalletId: "" });
    patchRow(inn, { type: "TRANSFER_IN", counterWalletId: "" });
  };

  const accepted = pairs.filter((p) => p.accepted);
  const suggestions = pairs.filter((p) => !p.accepted);
  const inAccepted = new Set(accepted.flatMap((p) => [p.outKey, p.inKey]));
  const single = rows.filter((r) => !inAccepted.has(r.key));
  const busy = jobs.some((j) => j.state === "uploading" || j.state === "scanning");
  const included = rows.filter((r) => r.include).length;

  function save() {
    const { payload, problems } = buildCommit(rows, pairs, wallets, pockets, [...debts, ...receivables]);
    setProblems(problems);
    if (problems.length) return;
    startSaving(async () => {
      const result = await commitImport(payload);
      if (result && !result.ok) setProblems([result.error]);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">1. Sube tus capturas</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Cuenta de las capturas">
            <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.currencyCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Qué muestran">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="STATEMENT">Varios movimientos (estado de cuenta)</option>
              <option value="RECEIPT">Un solo movimiento (comprobante)</option>
            </Select>
          </Field>
          <Field label="Son" hint={HINTS.find((h) => h.value === hint)?.hint} className="sm:col-span-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-background p-1 sm:grid-cols-4">
              {HINTS.map((h) => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => setHint(h.value)}
                  className={cn(
                    "min-h-10 rounded-lg py-2 text-sm font-medium transition sm:min-h-0 sm:py-1.5",
                    hint === h.value ? "bg-surface shadow-sm" : "text-muted",
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </Field>
          {businesses.length > 0 && (
            <Field label="Es de">
              <Select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                <option value="">Personal</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Capturas o PDF" className={businesses.length > 0 ? "" : "sm:col-span-2"}>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={onScan}>
            <Upload className="size-4" />
            Escanear
          </Button>
          <p className="text-xs text-muted">
            Para una transferencia entre tus cuentas, sube la captura de cada cuenta (cambiando la cuenta arriba): se emparejan solas.
          </p>
        </div>
        {jobs.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                {j.state === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-positive" />
                ) : j.state === "error" ? (
                  <AlertTriangle className="size-4 shrink-0 text-negative" />
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted" />
                )}
                <FileImage className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 truncate">{j.name}</span>
                <span className={cn("ml-auto shrink-0 text-xs", j.state === "error" ? "text-negative" : "text-muted")}>
                  {j.state === "uploading" ? "Subiendo…" : j.state === "scanning" ? "Escaneando…" : j.message}
                </span>
                {(j.state === "done" || j.state === "error") && (
                  <button type="button" aria-label="Quitar" onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))}>
                    <X className="size-4 text-muted" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {rows.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">2. Revisa</h2>
            <Badge>{included} para guardar</Badge>
            {rows.some((r) => r.duplicate) && <Badge color="warning">{rows.filter((r) => r.duplicate).length} posibles duplicados</Badge>}
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => void rematch(rows, pairs)}>
              Buscar transferencias
            </Button>
          </div>

          {suggestions.map((p) => (
            <SuggestionCard key={pairId(p)} pair={p} rows={rows} wallets={wallets} onAccept={() => acceptPair(p)} onReject={() => dropPair(p)} />
          ))}

          {accepted.map((p) => (
            <PairCard
              key={pairId(p)}
              pair={p}
              rows={rows}
              wallets={wallets}
              onChange={(patch) => setPairs((ps) => ps.map((x) => (pairId(x) === pairId(p) ? { ...x, ...patch } : x)))}
              onToggle={(include) => {
                patchRow(p.outKey, { include });
                patchRow(p.inKey, { include });
              }}
              onSplit={() => dropPair(p)}
            />
          ))}

          {single.map((r) => (
            <RowCard
              key={r.key}
              row={r}
              rows={rows}
              linked={inAccepted}
              wallets={wallets}
              categories={categories}
              businesses={businesses}
              debts={debts}
              receivables={receivables}
              onChange={(patch) => patchRow(r.key, patch)}
              onLink={(other) => linkRows(r.key, other)}
              onRemove={() => {
                setRows((rs) => rs.filter((x) => x.key !== r.key));
                setPairs((ps) => ps.filter((p) => p.outKey !== r.key && p.inKey !== r.key));
              }}
            />
          ))}

          <Card className="flex flex-col gap-3">
            <Checkbox
              label="Llevar a los apartados"
              hint="Los ingresos entran a la Caja de su dueño (y se reparten); los gastos salen de ella. Desmárcalo para movimientos viejos."
              checked={pockets}
              onCheckedChange={setPockets}
            />
            {problems.length > 0 && (
              <ul role="alert" className="flex flex-col gap-1 rounded-lg bg-error-primary px-3 py-2 text-sm text-error-primary">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={save} isLoading={saving} disabled={busy || included === 0}>
                Guardar {included} {included === 1 ? "movimiento" : "movimientos"}
                <ArrowRight className="size-4" />
              </Button>
              {busy && <span className="text-xs text-muted">Espera a que terminen de escanearse las capturas</span>}
              <span className="text-xs text-muted">Lo que quede sin categoría lo podrás categorizar después en Movimientos.</span>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
