// Conexión a la base de datos del proyecto Supabase vinculado, vía pooler (Supavisor, modo sesión).
// Lee VITE_SUPABASE_URL (project ref) y SUPABASE_DB_PASSWORD del .env. Prueba aws-0 y aws-1.
import postgres from "postgres";
import { readFileSync } from "node:fs";

export function readEnv(path = ".env") {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

export async function connect() {
  const env = readEnv();
  const ref = new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0];
  if (!env.SUPABASE_DB_PASSWORD) throw new Error("Falta SUPABASE_DB_PASSWORD en .env");
  const region = process.env.SUPABASE_POOLER_REGION ?? "us-east-1";
  let lastError;
  for (const host of [`aws-1-${region}.pooler.supabase.com`, `aws-0-${region}.pooler.supabase.com`]) {
    const sql = postgres({
      host,
      port: 5432,
      database: "postgres",
      username: `postgres.${ref}`,
      password: env.SUPABASE_DB_PASSWORD,
      ssl: "require",
      max: 1,
      connect_timeout: 20,
      onnotice: () => {},
    });
    try {
      await sql`select 1`;
      return sql;
    } catch (e) {
      lastError = e;
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw lastError;
}
