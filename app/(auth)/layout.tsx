export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white dark:text-black">
            F
          </div>
          <h1 className="text-xl font-semibold">Finanzas</h1>
          <p className="text-sm text-muted">Cuentas, gastos y tasas en un solo lugar</p>
        </div>
        {children}
      </div>
    </main>
  );
}
