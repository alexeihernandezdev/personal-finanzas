import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fecha "YYYY-MM-DD" de hoy en hora de Venezuela. */
export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
}

/** Las columnas @db.Date vuelven como medianoche UTC; formateamos en UTC para no correr el día. */
export function formatDate(date: Date, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("es-VE", { ...opts, timeZone: "UTC" }).format(date);
}

export function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseISODate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Rango [inicio, fin) de un mes "YYYY-MM" en UTC. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function formatMonth(month: string) {
  const { start } = monthRange(month);
  const label = new Intl.DateTimeFormat("es-VE", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
