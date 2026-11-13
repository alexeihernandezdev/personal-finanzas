import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Tipografía de Untitled UI (styles/theme.css la lee de --font-inter)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finanzas",
  description: "Lleva tus cuentas, ingresos, gastos y tasas en un solo lugar",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
};

// El modo oscuro de Untitled UI va por la clase `.dark-mode`: se sincroniza con el sistema antes de
// pintar para que no parpadee.
const darkModeScript = `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function s(){document.documentElement.classList.toggle("dark-mode",m.matches)}s();m.addEventListener("change",s)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
