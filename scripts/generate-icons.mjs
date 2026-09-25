// Genera los PNG de la PWA a partir de public/icon.svg (o de la imagen que pases como argumento).
//   node scripts/generate-icons.mjs            -> usa public/icon.svg
//   node scripts/generate-icons.mjs ruta.png   -> usa esa imagen (ej. una generada con Higgsfield)
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2] ?? "public/icon.svg";
const outDir = "public/icons";
await mkdir(outDir, { recursive: true });

const base = sharp(source).resize(1024, 1024, { fit: "cover" });

const targets = [
  { file: "pwa-192x192.png", size: 192 },
  { file: "pwa-512x512.png", size: 512 },
  { file: "apple-touch-icon-180x180.png", size: 180 },
  { file: "favicon-32x32.png", size: 32 },
  { file: "favicon-16x16.png", size: 16 },
];

for (const { file, size } of targets) {
  await base.clone().resize(size, size).png().toFile(path.join(outDir, file));
}

// Maskable: el sistema recorta un círculo del 80% central, así que el dibujo va con
// margen extra y el fondo rellena toda la lienzo (sin esquinas redondeadas).
const maskableSize = 512;
const inner = Math.round(maskableSize * 0.72);
const innerPng = await base.clone().resize(inner, inner).png().toBuffer();
await sharp({
  create: {
    width: maskableSize,
    height: maskableSize,
    channels: 4,
    background: "#0f48c4",
  },
})
  .composite([{ input: innerPng, gravity: "centre" }])
  .png()
  .toFile(path.join(outDir, "pwa-maskable-512x512.png"));

console.log(`Iconos generados en ${outDir} desde ${source}`);
