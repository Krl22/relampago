// Ejecuta SQL ad-hoc contra la base de datos del proyecto Supabase vinculado.
//   npm run sql -- "select count(*) from public.orders"
// Lee VITE_SUPABASE_URL (para el project ref) y SUPABASE_DB_PASSWORD del .env.
// Usa el pooler (Supavisor, modo sesión) porque el host directo es solo IPv6.
import { connect } from "./lib/db.mjs";
import { readFileSync } from "node:fs";

//   npm run sql -- --file ruta.sql   -> ejecuta el contenido del archivo
const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const sqlText = fileIdx >= 0 ? readFileSync(args[fileIdx + 1], "utf8") : args.join(" ").trim();
if (!sqlText) {
  console.error('Uso: npm run sql -- "select 1"  |  npm run sql -- --file archivo.sql');
  process.exit(1);
}

const sql = await connect();
try {
  const rows = await sql.unsafe(sqlText);
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error("Error:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
