import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Badge as UntitledBadge } from "@/components/base/badges/badges";
import { Button as UntitledButton } from "@/components/base/buttons/button";
import { styles as buttonStyles } from "@/components/base/buttons/button-styles";
import { Checkbox as UntitledCheckbox } from "@/components/base/checkbox/checkbox";
import { InputBase, type InputBaseProps } from "@/components/base/input/input";
import { DateField, MonthField, SelectField, type SelectFieldProps } from "@/components/form-controls";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-pretty text-muted">{description}</p>}
      </div>
      {/* En móvil las acciones ocupan el ancho: botones grandes y fáciles de tocar */}
      {actions && <div className="flex flex-wrap gap-2 *:flex-1 sm:*:flex-none">{actions}</div>}
    </div>
  );
}

/** Selector entre páginas hermanas (p. ej. Gastos fijos | Ingresos fijos): una sola sección del menú. */
export function SectionSwitch({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Ver" className="mb-4 grid max-w-md grid-cols-2 gap-1 rounded-xl bg-background p-1 sm:mb-5">
      {items.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center justify-center rounded-lg px-3 text-sm font-medium transition sm:min-h-9",
              active ? "bg-surface shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const FIXED_SECTIONS = [
  { href: "/gastos-fijos", label: "Gastos fijos" },
  { href: "/ingresos-fijos", label: "Ingresos fijos" },
];

export const PENDING_SECTIONS = [
  { href: "/por-cobrar", label: "Me deben" },
  { href: "/deudas", label: "Debo" },
];

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("mb-3 text-xs font-semibold uppercase tracking-wider text-muted", className)}>{children}</h2>;
}

/** Título de sección con un enlace a la derecha ("Ver todos", "Administrar"…) con área táctil cómoda. */
export function SectionHeader({ title, href, linkLabel }: { title: ReactNode; href: string; linkLabel: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <SectionTitle className="mb-0">{title}</SectionTitle>
      <Link
        href={href}
        className="-mr-2 inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-accent hover:bg-accent-soft"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

/** Pie de una tarjeta con un enlace a la página completa. */
export function CardFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center border-t border-border px-4 text-sm font-medium text-accent hover:bg-background"
    >
      {children}
    </Link>
  );
}

/**
 * Pestañas de dueño (Personal y cada negocio). En móvil se desplazan en horizontal en vez de
 * partirse en varias líneas.
 */
export function OwnerTabs({
  tabs,
  current,
  href,
  label,
  className,
}: {
  tabs: { key: string; name: string; extra?: ReactNode }[];
  current: string;
  href: (key: string) => string;
  label: string;
  className?: string;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav
      aria-label={label}
      className={cn("no-scrollbar -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:mb-6 sm:flex-wrap sm:px-0", className)}
    >
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
              active
                ? "border-transparent bg-foreground font-medium text-background"
                : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {t.name}
            {t.extra && <span className="text-xs tabular opacity-75">{t.extra}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tarjeta de cifra (resumen arriba de cada página). */
export function StatCard({
  label,
  value,
  children,
  className,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  children?: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("mt-1 truncate text-xl font-semibold tracking-tight tabular sm:text-2xl", valueClassName)}>{value}</p>
      {children}
    </Card>
  );
}

// ─── Botones, campos y etiquetas: componentes de Untitled UI (components/base) ──────────────────

const BUTTON_COLORS = {
  primary: "primary",
  secondary: "secondary",
  ghost: "tertiary",
  danger: "tertiary-destructive",
} as const;

type ButtonVariant = keyof typeof BUTTON_COLORS;

/** Clases del botón de Untitled UI, para dárselas a un `<Link>` o a un `<summary>`. */
export function buttonClass(variant: ButtonVariant = "primary", className?: string) {
  return cn(
    buttonStyles.common.root,
    buttonStyles.sizes.md.root,
    buttonStyles.colors[BUTTON_COLORS[variant]].root,
    // Área táctil de 44px en el móvil
    "max-sm:min-h-11 select-none",
    className,
  );
}

export function Button({
  variant = "primary",
  type = "submit",
  onClick,
  disabled,
  isLoading,
  className,
  children,
  ...props
}: {
  variant?: ButtonVariant;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
  children?: ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <UntitledButton
      {...props}
      // Como un <button> nativo: dentro de un formulario envía, salvo que se diga lo contrario
      type={type}
      size="md"
      color={BUTTON_COLORS[variant]}
      onPress={onClick}
      isDisabled={disabled}
      isLoading={isLoading}
      showTextWhileLoading
      className={cn("max-sm:min-h-11 select-none", className)}
    >
      {children}
    </UntitledButton>
  );
}

/**
 * Reparte las clases recibidas entre el contenedor (posición, ancho…) y el control (texto, relleno…),
 * porque los campos de Untitled UI separan ambos.
 */
function splitFieldClasses(className?: string) {
  const outer: string[] = [];
  const inner: string[] = [];
  for (const c of (className ?? "").split(/\s+/).filter(Boolean)) {
    const utility = c.slice(c.lastIndexOf(":") + 1);
    if (/^(text-|font-|tabular|p[xytrbl]?-|h-|placeholder)/.test(utility)) inner.push(c);
    else outer.push(c);
  }
  return { outer: outer.join(" "), inner: inner.join(" ") };
}

type InputProps = Omit<ComponentProps<"input">, "size"> & { className?: string };

export function Input({ className, required, disabled, type = "text", ...props }: InputProps) {
  // El selector de color no tiene versión en Untitled UI: se usa el nativo con su mismo estilo
  if (type === "color") {
    return (
      <input
        type="color"
        disabled={disabled}
        className={cn(
          "h-10 w-full cursor-pointer rounded-lg bg-primary p-1 shadow-xs ring-1 ring-primary ring-inset max-sm:h-11",
          className,
        )}
        {...props}
      />
    );
  }
  const { outer, inner } = splitFieldClasses(className);
  // Fechas y meses: DatePicker y Select de Untitled UI en vez de los controles nativos
  if (type === "date") {
    return <DateField name={props.name} defaultValue={props.defaultValue} required={required} disabled={disabled} title={props.title} className={outer} />;
  }
  if (type === "month") {
    return <MonthField name={props.name} defaultValue={props.defaultValue} className={outer} />;
  }
  return (
    <InputBase
      {...(props as Omit<InputBaseProps, "size">)}
      type={type}
      size="md"
      isRequired={required}
      isDisabled={disabled}
      wrapperClassName={cn("min-w-0", outer)}
      inputClassName={cn("max-sm:py-2.5", inner)}
    />
  );
}

/** Select de Untitled UI (lista propia, no la nativa) con la API de un `<select>`: `<option>` y `<optgroup>` como hijos. */
export function Select({ className, ...props }: SelectFieldProps) {
  // El tamaño y el relleno los fija Untitled UI; aquí solo cuentan las clases de posición y ancho
  return <SelectField {...props} className={splitFieldClasses(className).outer} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-16 w-full rounded-lg bg-primary px-3.5 py-3 text-md text-primary shadow-xs ring-1 ring-primary outline-hidden transition duration-100 ease-linear ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand",
        className,
      )}
      {...props}
    />
  );
}

export { Field } from "@/components/form-controls";

/** Casilla de Untitled UI. Con `name` se envía en el formulario como una nativa ("on" si está marcada). */
export function Checkbox({
  label,
  hint,
  name,
  defaultChecked,
  checked,
  onCheckedChange,
  title,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  name?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  title?: string;
  className?: string;
}) {
  return (
    <span title={title} className={cn("flex min-h-10 items-center sm:min-h-0", className)}>
      <UntitledCheckbox
        name={name}
        value="on"
        size="sm"
        label={label}
        hint={hint}
        defaultSelected={defaultChecked}
        isSelected={checked}
        onChange={onCheckedChange}
      />
    </span>
  );
}

type BadgeColor = "gray" | "brand" | "success" | "error" | "warning";

export function Badge({
  children,
  color = "gray",
  className,
}: {
  children: ReactNode;
  color?: BadgeColor;
  className?: string;
}) {
  return (
    <UntitledBadge type="pill-color" size="sm" color={color} className={cn("gap-1", className)}>
      {children}
    </UntitledBadge>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center text-sm text-pretty text-muted">
      {children}
    </p>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-border/60", className)} />;
}

export function Amount({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const negative = value.startsWith("-");
  const positive = value.startsWith("+");
  return (
    <span className={cn("tabular whitespace-nowrap", negative && "text-negative", positive && "text-positive", className)}>
      {value}
    </span>
  );
}
