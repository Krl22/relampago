// Comprime fotos antes de subirlas (pruebas de entrega). Una foto de celular pesa ~1 MB o más;
// reducida a 1600 px en el lado mayor y en JPEG de buena calidad queda en ~150–250 KB y se
// sigue viendo nítida en cualquier pantalla. Si algo falla (formato que el navegador no puede
// leer, como HEIC fuera de Safari) se sube la foto original para no bloquear la entrega.

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.8;

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    // "from-image" respeta la orientación EXIF (fotos verticales del celular)
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

export async function compressImage(file: File, { maxSide = PHOTO_MAX_SIDE, quality = PHOTO_QUALITY } = {}): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Fondo blanco: un PNG con transparencia no queda negro al pasar a JPEG
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch (error) {
    console.warn("No se pudo comprimir la foto; se sube la original.", error);
    return file;
  } finally {
    decoded?.release();
  }
}
