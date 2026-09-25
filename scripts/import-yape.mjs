// Rellena companies.yape_number / yape_holder desde la hoja de entregas (columna "Yape / Plin").
//   node scripts/import-yape.mjs "ruta/Entregas.csv" [--dry-run] [--overwrite]
// Toma, por comercio, la cuenta que más veces aparece. Formatos vistos:
//   "993886378 (Dany Guinea)", "Plin: 923590545 (Rocio Aguirre)", "996148278 (Tiendas Shotty) S.A.C."
import { readFileSync } from "node:fs";
import { connect } from "./lib/db.mjs";
import { parse as parseCsv } from "./lib/csv.mjs";

const file = process.argv[2];
const DRY = process.argv.includes("--dry-run");
const OVERWRITE = process.argv.includes("--overwrite");
const CREATE = process.argv.includes("--create-missing");
if (!file) {
  console.error('Uso: node scripts/import-yape.mjs "Entregas.csv" [--dry-run] [--overwrite]');
  process.exit(1);
}

const norm = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Plin: 923590545 (Rocio Aguirre)" -> { number: "923590545", holder: "Rocio Aguirre (Plin)" } */
function parseAccount(raw) {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  const num = s.match(/9\d{2}\s?\d{3}\s?\d{3}/)?.[0]?.replace(/\s/g, "");
  if (!num) return null;
  const holder = s.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null;
  const isPlin = /plin/i.test(s);
  return { number: num, holder: holder ? (isPlin ? `${holder} (Plin)` : holder) : isPlin ? "(Plin)" : null };
}

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows[0].map((h) => h.trim().toLowerCase());
const iCompany = header.findIndex((h) => h === "comercio");
const iAccount = header.findIndex((h) => h.startsWith("yape"));
if (iCompany < 0 || iAccount < 0) {
  console.error("No encuentro las columnas Comercio / Yape en el CSV");
  process.exit(1);
}

// comercio -> cuenta -> veces
const byCompany = new Map();
const rawName = new Map(); // norm -> nombre como está escrito
for (const r of rows.slice(1)) {
  const c = norm(r[iCompany]);
  if (c && !rawName.has(c)) rawName.set(c, r[iCompany].replace(/\s+/g, " ").trim());
  const acc = parseAccount(r[iAccount]);
  if (!c || !acc) continue;
  const m = byCompany.get(c) ?? new Map();
  const key = acc.number;
  const cur = m.get(key) ?? { ...acc, count: 0 };
  cur.count++;
  if (!cur.holder && acc.holder) cur.holder = acc.holder;
  m.set(key, cur);
  byCompany.set(c, m);
}
const best = new Map([...byCompany].map(([c, m]) => [c, [...m.values()].sort((a, b) => b.count - a.count)[0]]));
console.log(`Comercios con cuenta en el CSV: ${best.size}`);

const sql = await connect();
const companies = await sql`select id, name, yape_number from public.companies`;
const updates = [];
const unmatched = [];
for (const [c, acc] of best) {
  const row = companies.find((x) => norm(x.name) === c);
  if (!row) {
    unmatched.push(c);
    continue;
  }
  if (row.yape_number && !OVERWRITE) continue;
  updates.push({ id: row.id, name: row.name, ...acc });
}
console.log(`A actualizar: ${updates.length} · ya tenían Yape: ${best.size - updates.length - unmatched.length} · sin empresa en la base: ${unmatched.length}`);
if (unmatched.length) console.log("Sin empresa:", unmatched.slice(0, 20).join(", "), unmatched.length > 20 ? "…" : "");
console.log("Muestra:", updates.slice(0, 5).map((u) => `${u.name} -> ${u.number} (${u.holder ?? "sin titular"})`).join(" | "));

if (!DRY) {
  await sql.begin(async (tx) => {
    for (const u of updates) {
      await tx`update public.companies set yape_number = ${u.number}, yape_holder = ${u.holder} where id = ${u.id}`;
    }
    if (CREATE) {
      for (const c of unmatched) {
        const acc = best.get(c);
        await tx`insert into public.companies (name, yape_number, yape_holder) values (${rawName.get(c)}, ${acc.number}, ${acc.holder})`;
      }
      console.log(`Empresas creadas: ${unmatched.length}`);
    }
  });
  console.log("Actualizado.");
} else {
  console.log("--dry-run: no se escribió nada.");
}
await sql.end();
