"use client";

import { getLocalTimeZone, today } from "@internationalized/date";
import { Calendar as CalendarIcon, ChevronDown } from "@untitledui/icons";
import { useDateFormatter } from "react-aria";
import type { DatePickerProps as AriaDatePickerProps, DateValue } from "react-aria-components";
import {
    Button as AriaButton,
    DatePicker as AriaDatePicker,
    Dialog as AriaDialog,
    Group as AriaGroup,
    Popover as AriaPopover,
} from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { Calendar } from "./calendar";

const highlightedDates = [today(getLocalTimeZone())];

interface DatePickerProps extends AriaDatePickerProps<DateValue> {
    /** Texto del disparador cuando no hay fecha. */
    placeholder?: string;
    /** Clases del contenedor (ancho, columnas…). */
    className?: string;
}

/**
 * Selector de fecha de Untitled UI con el disparador con aspecto de campo. No guarda estado propio:
 * React Aria lo maneja. Con `name` se envía en el formulario como "YYYY-MM-DD".
 */
export const DatePicker = ({ placeholder = "Elegir fecha", className, name, ...props }: DatePickerProps) => {
    const formatter = useDateFormatter({ day: "numeric", month: "short", year: "numeric" });

    return (
        <AriaDatePicker shouldCloseOnSelect={false} {...props} className={cx("min-w-0", className)}>
            {({ state, isDisabled }) => (
                <>
                    {/* React Aria solo envía la fecha desde los segmentos del campo, que aquí no se usan */}
                    {name && <input type="hidden" name={name} value={state.value?.toString() ?? ""} />}
                    <AriaGroup className="w-full">
                        <AriaButton
                            className={({ isFocusVisible, isPressed }) =>
                                cx(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-lg bg-primary px-3 py-2 text-left text-md shadow-xs ring-1 ring-primary outline-hidden transition duration-100 ease-linear ring-inset max-sm:py-2.5",
                                    (isFocusVisible || isPressed || state.isOpen) && "ring-2 ring-brand",
                                    isDisabled && "cursor-not-allowed opacity-50",
                                )
                            }
                        >
                            <CalendarIcon aria-hidden="true" className="size-5 shrink-0 text-fg-quaternary" />
                            <span className={cx("flex-1 truncate", state.value ? "font-medium text-primary" : "text-placeholder")}>
                                {state.value ? formatter.format(state.value.toDate(getLocalTimeZone())) : placeholder}
                            </span>
                            <ChevronDown aria-hidden="true" className="size-4 shrink-0 stroke-[2.25px] text-fg-quaternary" />
                        </AriaButton>
                    </AriaGroup>
                    <AriaPopover
                        offset={8}
                        placement="bottom start"
                        className={({ isEntering, isExiting }) =>
                            cx(
                                "origin-(--trigger-anchor-point) will-change-transform",
                                isEntering &&
                                    "duration-150 ease-out animate-in fade-in placement-right:slide-in-from-left-0.5 placement-top:slide-in-from-bottom-0.5 placement-bottom:slide-in-from-top-0.5",
                                isExiting &&
                                    "duration-100 ease-in animate-out fade-out placement-right:slide-out-to-left-0.5 placement-top:slide-out-to-bottom-0.5 placement-bottom:slide-out-to-top-0.5",
                            )
                        }
                    >
                        <AriaDialog aria-label="Elegir fecha" className="rounded-2xl bg-primary shadow-xl ring ring-secondary_alt outline-hidden">
                            {({ close }) => (
                                <>
                                    <div className="flex px-4 py-4 sm:px-6 sm:py-5">
                                        <Calendar highlightedDates={highlightedDates} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 border-t border-secondary p-4">
                                        <Button
                                            size="md"
                                            color="secondary"
                                            onClick={() => {
                                                state.setValue(null);
                                                close();
                                            }}
                                        >
                                            Borrar
                                        </Button>
                                        <Button size="md" color="primary" onClick={close}>
                                            Listo
                                        </Button>
                                    </div>
                                </>
                            )}
                        </AriaDialog>
                    </AriaPopover>
                </>
            )}
        </AriaDatePicker>
    );
};
