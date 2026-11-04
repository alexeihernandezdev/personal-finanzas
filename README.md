# Finanzas

App para llevar finanzas personales y de emprendimientos: cuentas en USD, VES y USDT, ingresos y gastos con categorías, división entre negocios, transferencias (también entre divisas), gastos fijos, cuentas por cobrar, préstamos y tasas BCV y Binance P2P.

Stack: Next.js 16 (App Router, Cache Components), Prisma 7 + PostgreSQL, Auth.js v5, Tailwind 4 y Recharts.

## Desarrollo local

```bash
cp .env.example .env          # y ajusta los valores
docker compose up -d          # Postgres en localhost:5433
npm install                   # genera el cliente de Prisma
npx prisma migrate dev        # crea las tablas
npx prisma db seed            # carga las divisas (USD, VES, USDT)
npm run dev
```

Abre http://localhost:3000 y crea una cuenta. Cada usuario solo ve sus propios datos.

Para el `.env` local con el `docker-compose.yml` incluido:

```
DATABASE_URL="postgresql://finanzas:finanzas@localhost:5433/finanzas"
AUTH_SECRET="..."      # npx auth secret
CRON_SECRET="..."
```

El login con Google es opcional: se activa solo si defines `AUTH_GOOGLE_ID` y `AUTH_GOOGLE_SECRET`.

## Scripts

- `npm run dev`: servidor de desarrollo
- `npm test`: pruebas unitarias (conversiones, validaciones, parsers de tasas)
- `npm run lint`: ESLint
- `npm run build`: genera Prisma Client y compila para producción

## Cómo funciona

- **Saldos**: se calculan como saldo inicial + entradas − salidas. Cada cuenta tiene una sola divisa.
- **Tipos de movimiento**: ingreso, gasto, transferencia (dos movimientos enlazados), préstamo otorgado y devolución. Las transferencias y los préstamos mueven saldo, pero **no cuentan** como ingreso ni gasto en los reportes.
- **Negocios**: un ingreso o gasto se puede asignar a un negocio o repartir entre varios por % o por monto. Lo que no se asigna cuenta como "Personal".
- **Tasas**: el BCV sale de dolarapi.com (con respaldo en bcv.org.ve) y Binance de la mediana de los 10 primeros anuncios P2P USDT/VES. Cada movimiento guarda la tasa del día, así los reportes en USD no cambian después. La tasa de referencia (BCV o Binance) y la moneda de los totales se eligen en Ajustes.
- **Gastos fijos**: cada mes se muestran como pendientes o pagados. Al marcarlos pagados se crea el gasto.
- **Por cobrar**: registra dinero que te van a pagar y préstamos que hiciste, con cobros parciales.

## Deploy en Vercel

1. Crea una base Postgres (por ejemplo Neon, desde el Marketplace de Vercel).
2. Configura en Vercel las variables `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` y, si quieres, las de Google.
3. Aplica las migraciones contra la base de producción: `npx prisma migrate deploy && npx prisma db seed`.
4. `vercel.json` programa `/api/cron/rates` una vez al día, que es el límite del plan Hobby. Además, la app refresca las tasas cuando tienen más de una hora al abrir el inicio o la página de tasas, y en Tasas hay un botón para actualizarlas a mano.
