import { sortCx } from "@/utils/cx";

// Separado de button.tsx (cliente) para poder aplicar estos estilos a enlaces desde Server Components.
export const styles = sortCx({
    common: {
        root: [
            "group relative inline-flex h-max cursor-pointer items-center justify-center whitespace-nowrap outline-brand transition duration-100 ease-linear before:absolute focus-visible:outline-2 focus-visible:outline-offset-2",
            // When button is used within `InputGroup`
            "in-data-input-wrapper:shadow-xs in-data-input-wrapper:focus:!z-50 in-data-input-wrapper:in-data-leading:-mr-px in-data-input-wrapper:in-data-leading:rounded-r-none in-data-input-wrapper:in-data-leading:before:rounded-r-none in-data-input-wrapper:in-data-trailing:-ml-px in-data-input-wrapper:in-data-trailing:rounded-l-none in-data-input-wrapper:in-data-trailing:before:rounded-l-none",
            // Disabled styles
            "disabled:cursor-not-allowed disabled:opacity-50 in-data-input-wrapper:disabled:opacity-100",
            // Same as `icon` but for SSR icons that cannot be passed to the client as functions.
            "*:data-icon:pointer-events-none *:data-icon:size-5 *:data-icon:shrink-0 *:data-icon:transition-inherit-all",
        ].join(" "),
        icon: "pointer-events-none size-5 shrink-0 transition-inherit-all",
    },
    sizes: {
        xs: {
            root: [
                "gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold before:rounded-[7px] data-icon-only:p-2",
                "in-data-input-wrapper:px-3.5 in-data-input-wrapper:py-2.5 in-data-input-wrapper:data-icon-only:p-2.5",
                "*:data-icon:size-4 *:data-icon:stroke-[2.25px]",
            ].join(" "),
            linkRoot: "gap-1 *:data-text:underline-offset-3",
        },
        sm: {
            root: [
                "gap-1 rounded-lg px-3 py-2 text-sm font-semibold before:rounded-[7px] data-icon-only:p-2",
                "in-data-input-wrapper:px-3.5 in-data-input-wrapper:py-2.5 in-data-input-wrapper:data-icon-only:p-2.5",
            ].join(" "),
            linkRoot: "gap-1 *:data-text:underline-offset-3",
        },
        md: {
            root: [
                "gap-1 rounded-lg px-3.5 py-2.5 text-sm font-semibold before:rounded-[7px] data-icon-only:p-2.5",
                "in-data-input-wrapper:gap-1.5 in-data-input-wrapper:px-4 in-data-input-wrapper:text-md in-data-input-wrapper:data-icon-only:p-3",
            ].join(" "),
            linkRoot: "gap-1 *:data-text:underline-offset-4",
        },
        lg: {
            root: "gap-1.5 rounded-lg px-4 py-2.5 text-md font-semibold before:rounded-[7px] data-icon-only:p-3",
            linkRoot: "gap-1.5 *:data-text:underline-offset-4",
        },
        xl: {
            root: "gap-1.5 rounded-lg px-4.5 py-3 text-md font-semibold before:rounded-[7px] data-icon-only:p-3.5",
            linkRoot: "gap-1.5 *:data-text:underline-offset-4",
        },
    },

    colors: {
        primary: {
            root: [
                "bg-brand-solid text-white shadow-xs-skeuomorphic ring-1 ring-transparent ring-inset hover:bg-brand-solid_hover data-loading:bg-brand-solid_hover",
                // Inner border gradient
                "before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%",
                // Icon styles
                "*:data-icon:text-white/60 hover:*:data-icon:text-white/70",
            ].join(" "),
        },
        secondary: {
            root: [
                "bg-primary text-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset hover:bg-primary_hover hover:text-secondary_hover data-loading:bg-primary_hover",
                // Icon styles
                "*:data-icon:text-fg-quaternary hover:*:data-icon:text-fg-quaternary_hover",
            ].join(" "),
        },
        tertiary: {
            root: [
                "text-tertiary hover:bg-primary_hover hover:text-tertiary_hover data-loading:bg-primary_hover",
                // Icon styles
                "*:data-icon:text-fg-quaternary hover:*:data-icon:text-fg-quaternary_hover",
            ].join(" "),
        },
        "link-color": {
            root: [
                "justify-normal rounded p-0! text-brand-secondary hover:text-brand-secondary_hover",
                // Inner text underline
                "*:data-text:underline *:data-text:decoration-transparent hover:*:data-text:decoration-fg-brand-secondary_alt",
                // Icon styles
                "*:data-icon:text-fg-brand-secondary_alt hover:*:data-icon:text-fg-brand-secondary_hover",
            ].join(" "),
        },
        "link-gray": {
            root: [
                "justify-normal rounded p-0! text-tertiary hover:text-tertiary_hover",
                // Inner text underline
                "*:data-text:underline *:data-text:decoration-transparent hover:*:data-text:decoration-fg-quaternary",
                // Icon styles
                "*:data-icon:text-fg-quaternary hover:*:data-icon:text-fg-quaternary_hover",
            ].join(" "),
        },
        "primary-destructive": {
            root: [
                "bg-error-solid text-white shadow-xs-skeuomorphic ring-1 ring-transparent outline-error ring-inset hover:bg-error-solid_hover data-loading:bg-error-solid_hover",
                // Inner border gradient
                "before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%",
                // Icon styles
                "*:data-icon:text-white/60 hover:*:data-icon:text-white/70",
            ].join(" "),
        },
        "secondary-destructive": {
            root: [
                "bg-primary text-error-primary shadow-xs-skeuomorphic ring-1 ring-error_subtle outline-error ring-inset hover:bg-error-primary hover:text-error-primary_hover data-loading:bg-error-primary",
                // Icon styles
                "*:data-icon:text-fg-error-secondary hover:*:data-icon:text-fg-error-primary",
            ].join(" "),
        },
        "tertiary-destructive": {
            root: [
                "text-error-primary outline-error hover:bg-error-primary hover:text-error-primary_hover data-loading:bg-error-primary",
                // Icon styles
                "*:data-icon:text-fg-error-secondary hover:*:data-icon:text-fg-error-primary",
            ].join(" "),
        },
        "link-destructive": {
            root: [
                "justify-normal rounded p-0! text-error-primary outline-error hover:text-error-primary_hover",
                // Inner text underline
                "*:data-text:underline *:data-text:decoration-transparent *:data-text:underline-offset-2 hover:*:data-text:decoration-current",
                // Icon styles
                "*:data-icon:text-fg-error-secondary hover:*:data-icon:text-fg-error-primary",
            ].join(" "),
        },
    },
});
