import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Secciones que se fusionaron con otras (la query, p. ej. ?negocio=, se conserva)
  async redirects() {
    return [
      { source: "/presupuesto", destination: "/apartados", permanent: false },
      { source: "/transferencias", destination: "/movimientos/nuevo?tipo=transferencia", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
