import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { formatMonth, shiftMonth } from "@/lib/utils";

export function MonthNav({
  month,
  basePath,
  param = "mes",
  query = "",
}: {
  month: string;
  basePath: string;
  param?: string;
  /** Otros parámetros que se conservan al cambiar de mes (p. ej. "negocio=abc") */
  query?: string;
}) {
  const extra = query ? `&${query}` : "";
  return (
    <div className="flex items-center gap-1">
      <Link href={`${basePath}?${param}=${shiftMonth(month, -1)}${extra}`} className={buttonClass("secondary", "px-2")}>
        <ChevronLeft className="size-4" />
      </Link>
      <span className="min-w-36 text-center text-sm font-medium">{formatMonth(month)}</span>
      <Link href={`${basePath}?${param}=${shiftMonth(month, 1)}${extra}`} className={buttonClass("secondary", "px-2")}>
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}

export function parseMonthParam(value: unknown, fallback: string) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? value : fallback;
}
