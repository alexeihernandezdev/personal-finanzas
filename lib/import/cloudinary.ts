import "server-only";
import { createHash } from "node:crypto";

function config() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Falta configurar Cloudinary (CLOUDINARY_*)");
  return { cloudName, apiKey, apiSecret };
}

/** Firma de Cloudinary: parámetros ordenados "a=1&b=2" + secreto, en SHA-1. */
function sign(params: Record<string, string | number>, secret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(payload + secret).digest("hex");
}

/** Carpeta privada de las capturas de un usuario. */
export const importFolder = (userId: string) => `finanzas/imports/${userId}`;

/** Parámetros para que el navegador suba directo a Cloudinary (sin pasar por Vercel). */
export function signedUploadParams(userId: string) {
  const { cloudName, apiKey, apiSecret } = config();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = importFolder(userId);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    apiKey,
    timestamp,
    folder,
    signature: sign({ folder, timestamp }, apiSecret),
  };
}

/** URL de entrega del archivo original. */
export function deliveryUrl(publicId: string, resourceType: "image" | "raw", format: string) {
  const { cloudName } = config();
  const path = publicId.split("/").map(encodeURIComponent).join("/");
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${path}${format ? `.${format}` : ""}`;
}

/** Borra el archivo; los errores se ignoran (Cloudinary puede limpiarse luego a mano). */
export async function destroyUpload(publicId: string, resourceType: "image" | "raw") {
  try {
    const { cloudName, apiKey, apiSecret } = config();
    const timestamp = Math.floor(Date.now() / 1000);
    const body = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: apiKey,
      signature: sign({ public_id: publicId, timestamp }, apiSecret),
    });
    await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, { method: "POST", body });
  } catch {
    // sin efecto en la importación
  }
}
