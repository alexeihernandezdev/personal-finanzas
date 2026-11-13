"use client";

import { Children, createContext, isValidElement, useContext, useMemo, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { parseDate } from "@internationalized/date";
import { Header, ListBoxSection, type Key } from "react-aria-components";
import { DatePicker } from "@/components/application/date-picker/date-picker";
import { Select as UntitledSelect } from "@/components/base/select/select";
import { cn } from "@/lib/utils";

/** Etiqueta del `Field` que envuelve al control: da nombre accesible a los que no son inputs nativos. */
const FieldLabel = createContext<string | undefined>(undefined);

/** Campo con etiqueta y ayuda, con la tipografía de Untitled UI. El `<label>` envuelve al control. */
export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-sm font-medium text-secondary">{label}</span>
      <FieldLabel.Provider value={label}>{children}</FieldLabel.Provider>
      {hint && <span className="text-sm text-tertiary">{hint}</span>}
    </label>
  );
}

type Option = { value: string; label: string; disabled?: boolean };
type Group = { label: string | null; options: Option[] };

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : ""))
    .join("");

/** Convierte los `<option>` y `<optgroup>` hijos (como en un `<select>` nativo) en grupos de opciones. */
function readOptions(children: ReactNode): Group[] {
  const groups: Group[] = [];
  let loose: Group | null = null;
  const visit = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const el = child as ReactElement<{ value?: string | number; children?: ReactNode; label?: string; disabled?: boolean }>;
      if (el.type === "option") {
        if (!loose) groups.push((loose = { label: null, options: [] }));
        const label = text(el.props.children);
        loose.options.push({ value: String(el.props.value ?? label), label, disabled: el.props.disabled });
      } else if (el.type === "optgroup") {
        loose = null;
        groups.push({
          label: el.props.label ?? "",
          options: Children.toArray(el.props.children)
            .filter(isValidElement)
            .map((o) => {
              const p = (o as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>).props;
              const label = text(p.children);
              return { value: String(p.value ?? label), label, disabled: p.disabled };
            }),
        });
      } else {
        // Fragmentos u otros envoltorios
        visit(el.props.children);
      }
    });
  };
  visit(children);
  return groups;
}

export type SelectFieldProps = {
  name?: string;
  value?: string | number;
  defaultValue?: string | number | readonly string[];
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * Select de Untitled UI con la API de un `<select>` nativo: opciones como hijos, `name` para el
 * formulario y `onChange` con `event.target.value`.
 */
export function SelectField({
  name,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  title,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const fieldLabel = useContext(FieldLabel);
  const groups = useMemo(() => readOptions(children), [children]);
  const all = groups.flatMap((g) => g.options);
  // Como un <select> nativo: sin valor explícito queda elegida la primera opción
  const fallback = all[0]?.value ?? null;
  const controlled = value !== undefined;
  const initial = defaultValue !== undefined ? String(defaultValue) : fallback;

  const handleChange = (key: Key | null) => {
    const next = key == null ? "" : String(key);
    onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  const item = (o: Option) => <UntitledSelect.Item key={o.value} id={o.value} label={o.label || " "} isDisabled={o.disabled} />;

  return (
    <UntitledSelect
      name={name}
      aria-label={rest["aria-label"] ?? fieldLabel ?? title ?? "Seleccionar"}
      size="md"
      placeholder="Seleccionar"
      isRequired={required}
      isDisabled={disabled}
      {...(controlled ? { selectedKey: String(value) } : { defaultSelectedKey: initial })}
      onSelectionChange={handleChange}
      className={cn("min-w-0", className)}
      popoverClassName="min-w-56"
    >
      {groups.map((g, i) =>
        g.label === null ? (
          g.options.map(item)
        ) : (
          <ListBoxSection key={`g${i}`} className="border-t border-secondary pt-1 first:border-t-0 first:pt-0">
            <Header className="px-3.5 pt-2 pb-1 text-xs font-semibold text-tertiary">{g.label}</Header>
            {g.options.map(item)}
          </ListBoxSection>
        ),
      )}
    </UntitledSelect>
  );
}

const safeDate = (v: unknown) => {
  try {
    return typeof v === "string" && v ? parseDate(v) : null;
  } catch {
    return null;
  }
};

/** Fecha con el DatePicker de Untitled UI; se envía como "YYYY-MM-DD", igual que un input nativo. */
export function DateField({
  name,
  defaultValue,
  required,
  disabled,
  title,
  className,
  ...rest
}: {
  name?: string;
  defaultValue?: unknown;
  required?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const fieldLabel = useContext(FieldLabel);
  return (
    <DatePicker
      name={name}
      aria-label={rest["aria-label"] ?? fieldLabel ?? title ?? "Fecha"}
      defaultValue={safeDate(defaultValue)}
      isRequired={required}
      isDisabled={disabled}
      className={className}
    />
  );
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Mes ("YYYY-MM") con el Select de Untitled UI: desde un año antes hasta dos años después. */
export function MonthField({ name, defaultValue, className, ...rest }: { name?: string; defaultValue?: unknown; className?: string; "aria-label"?: string }) {
  const value = typeof defaultValue === "string" && /^\d{4}-\d{2}$/.test(defaultValue) ? defaultValue : null;
  const now = new Date();
  const base = value ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1 : now.getFullYear() * 12 + now.getMonth();
  const options = Array.from({ length: 37 }, (_, i) => {
    const n = base - 12 + i;
    const y = Math.floor(n / 12);
    const m = n % 12;
    return { value: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} de ${y}` };
  });
  return (
    <SelectField name={name} defaultValue={value ?? options[12].value} className={className} aria-label={rest["aria-label"]}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectField>
  );
}
