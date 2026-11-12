import { Select } from "@/components/ui";
import type { PocketChoice } from "@/components/transaction-form";

/** Valor del selector: la Caja del dueño del movimiento (igual que en lib/pockets). */
const AUTO_POCKET = "auto";

type Props = {
  pockets: Pick<PocketChoice, "id" | "name" | "currencyCode" | "ownerName">[];
  /** "in": el dinero entra al apartado; "out": sale de él */
  direction: "in" | "out";
  className?: string;
  title?: string;
  /** Apartado elegido de entrada; por defecto la Caja (automático) */
  defaultValue?: string;
};

/** Selector compacto del apartado del que sale (o al que entra) el dinero de un movimiento. */
export function PocketPicker({ pockets, direction, className, title, defaultValue = AUTO_POCKET }: Props) {
  const owners = [...new Set(pockets.map((p) => p.ownerName))];
  return (
    <Select
      name="pocketId"
      defaultValue={defaultValue}
      className={className}
      title={title ?? (direction === "in" ? "Apartado al que entra el dinero" : "Apartado del que sale el dinero")}
    >
      <option value={AUTO_POCKET}>{direction === "in" ? "A la Caja (automático)" : "De la Caja (automático)"}</option>
      <option value="">Ningún apartado</option>
      {owners.map((owner) => (
        <optgroup key={owner} label={owner}>
          {pockets
            .filter((p) => p.ownerName === owner)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.currencyCode}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}
