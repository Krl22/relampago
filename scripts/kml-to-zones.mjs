// Convierte el mapa de cobertura de Google My Maps (KML) en src/data/tariffZones.json.
//   node scripts/kml-to-zones.mjs            -> descarga el mapa público y regenera el JSON
//   node scripts/kml-to-zones.mjs ruta.kml   -> desde un archivo local
//
// La tarifa de cada polígono sale del color con que está pintado en el mapa
// (así no depende de cómo esté escrito el nombre).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const MAP_ID = "19D4V8ASeo7aRw83jGwonD8BI7imllcA";
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MAP_ID}&forcekml=1`;

// color del estilo -> tarifa
const COLOR_TARIFF = {
  "0288D1": { tariff: "T1", amount: 10 }, // azul: Tarifa 1
  "7CB342": { tariff: "T1", amount: 10 }, // verde claro: Centro de Lima / Gamarra (T1)
  "558B2F": { tariff: "T2", amount: 13 }, // verde oscuro: s/13
  "1A237E": { tariff: "T3", amount: 16 }, // azul oscuro: s/16
  "000000": { tariff: "T4", amount: 19 }, // negro: s/19
  A52714: { flag: "zona_roja" }, // rojo: zona roja
  E65100: { flag: "sin_acceso" }, // naranja: sin acceso
};

const src = process.argv[2];
const xml = src ? readFileSync(src, "utf8") : await (await fetch(KML_URL)).text();

const placemarks = [...xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map((m) => m[1]);
const zones = [];
for (const pm of placemarks) {
  const name = (pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const style = pm.match(/<styleUrl>#poly-([0-9A-F]{6})/i)?.[1]?.toUpperCase();
  const outer = pm.match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/)?.[1];
  if (!outer) continue;
  const ring = outer
    .trim()
    .split(/\s+/)
    .map((t) => t.split(",").map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
  const meta = COLOR_TARIFF[style] ?? {};
  if (!meta.tariff && !meta.flag) {
    // "Zona Cobertura" (negro semitransparente) y cualquier estilo no mapeado: solo informativo
    if (/cobertura/i.test(name)) zones.push({ name, kind: "coverage", ring });
    else console.warn(`Sin tarifa para "${name}" (estilo ${style})`);
    continue;
  }
  zones.push({ name, kind: meta.flag ? "flag" : "tariff", tariff: meta.tariff ?? null, amount: meta.amount ?? null, flag: meta.flag ?? null, ring });
}

mkdirSync("src/data", { recursive: true });
writeFileSync(
  "src/data/tariffZones.json",
  JSON.stringify({ source: KML_URL, generated_at: new Date().toISOString(), zones }, null, 0) + "\n",
);
const summary = {};
for (const z of zones) summary[z.tariff ?? z.flag ?? z.kind] = (summary[z.tariff ?? z.flag ?? z.kind] ?? 0) + 1;
console.log(`zonas: ${zones.length}`, summary);
