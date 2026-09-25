// Empresas duplicadas (mismo comercio escrito distinto): propone grupos y los fusiona.
//
//   node scripts/merge-companies.mjs --propose [--min 0.75] [--out grupos.json]
//       Agrupa por nombre normalizado (sin tildes, espacios ni puntuación) y por similitud
//       de trigramas (pg_trgm). Imprime los grupos y los guarda en un JSON editable.
//
//   node scripts/merge-companies.mjs --apply grupos.json [--dry-run] [--backup respaldo.json]
//       Por cada grupo mueve pedidos, recojos, direcciones, stock, liquidaciones y cuentas
//       a la empresa que se conserva ("keep"), completa sus datos vacíos con los de las
//       duplicadas y las borra. Con --dry-run solo muestra lo que haría. Antes de tocar nada
//       guarda un respaldo (filas de las empresas borradas y qué filas se movieron) para poder deshacer.
//
// Formato del JSON: [{ "keep": "<uuid>", "merge": ["<uuid>", ...], "note": "opcional" }, ...]
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "./lib/db.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const sql = await connect();

async function loadCompanies() {
  return sql`
    select c.id, c.name, c.ruc, c.phone, c.email, c.contact_name, c.yape_number, c.yape_holder, c.address, c.district,
           c.invoice_igv, c.t1_rate, c.created_at,
           regexp_replace(lower(unaccent(c.name)), '[^a-z0-9]+', '', 'g') as norm,
           (select count(*)::int from public.orders o where o.company_id = c.id) as orders,
           (select count(*)::int from public.company_addresses a where a.company_id = c.id) as addresses,
           (select count(*)::int from public.stock s where s.company_id = c.id) as stock,
           (select count(*)::int from public.settlements s where s.company_id = c.id) as settlements,
           (select count(*)::int from public.profiles p where p.company_id = c.id) as users
    from public.companies c
    order by c.name`;
}

async function propose() {
  const min = Number(opt("--min", "0.75"));
  await sql`create extension if not exists pg_trgm`;
  await sql`create extension if not exists unaccent`;
  const companies = await loadCompanies();
  const byId = new Map(companies.map((c) => [c.id, c]));
  const pairs = await sql`
    with c as (select id, regexp_replace(lower(unaccent(name)), '[^a-z0-9]+', '', 'g') as norm from public.companies)
    select a.id as a, b.id as b, (a.norm = b.norm) as exact, similarity(a.norm, b.norm) as sim
    from c a join c b on a.id < b.id
    where length(a.norm) >= 3 and length(b.norm) >= 3 and (a.norm = b.norm or similarity(a.norm, b.norm) >= ${min})`;

  // union-find
  const parent = new Map(companies.map((c) => [c.id, c.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const p of pairs) parent.set(find(p.a), find(p.b));
  const groups = new Map();
  for (const c of companies) {
    const root = find(c.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  }
  const weight = (c) => c.orders * 10 + c.addresses + c.stock * 5 + c.settlements * 20 + c.users * 50;
  const out = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((x, y) => weight(y) - weight(x) || new Date(x.created_at) - new Date(y.created_at));
    const keep = members[0];
    out.push({
      keep: keep.id,
      keep_name: keep.name,
      merge: members.slice(1).map((m) => m.id),
      merge_names: members.slice(1).map((m) => `${m.name} (${m.orders} pedidos)`),
      note: pairs.some((p) => members.some((m) => m.id === p.a) && members.some((m) => m.id === p.b) && !p.exact) ? "similares (revisar)" : "mismo nombre",
    });
  }
  out.sort((x, y) => (x.note > y.note ? -1 : 1) || byId.get(y.keep).orders - byId.get(x.keep).orders);
  for (const g of out) console.log(`${g.note.padEnd(20)} ${g.keep_name} (${byId.get(g.keep).orders})  <=  ${g.merge_names.join("  |  ")}`);
  console.log(`\n${out.length} grupos, ${out.reduce((n, g) => n + g.merge.length, 0)} empresas a fusionar`);
  const file = opt("--out", "company-merges.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Guardado en ${file} (edítalo y luego --apply ${file})`);
}

async function apply() {
  const file = opt("--apply");
  const dry = flag("--dry-run");
  const groups = JSON.parse(readFileSync(file, "utf8"));
  const companies = await loadCompanies();
  const byId = new Map(companies.map((c) => [c.id, c]));
  const norm = (s) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  // Respaldo para deshacer: empresas que se borran + filas que cambian de empresa
  if (!dry) {
    const dupIds = groups.flatMap((g) => g.merge).filter((id) => byId.has(id));
    const backup = {
      at: new Date().toISOString(),
      groups,
      companies: await sql`select * from public.companies where id in ${sql(dupIds)}`,
      orders: await sql`select id, company_id, sender_name from public.orders where company_id in ${sql(dupIds)}`,
      pickups: await sql`select id, company_id from public.pickups where company_id in ${sql(dupIds)}`,
      company_addresses: await sql`select * from public.company_addresses where company_id in ${sql(dupIds)}`,
      stock: await sql`select id, company_id from public.stock where company_id in ${sql(dupIds)}`,
      settlements: await sql`select id, company_id from public.settlements where company_id in ${sql(dupIds)}`,
      profiles: await sql`select id, company_id from public.profiles where company_id in ${sql(dupIds)}`,
    };
    const backupFile = opt("--backup", `company-merges.backup-${Date.now()}.json`);
    writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    console.log(`Respaldo guardado en ${backupFile}`);
  }

  for (const g of groups) {
    const keep = byId.get(g.keep);
    if (!keep) {
      console.log(`! keep ${g.keep} no existe, se omite`);
      continue;
    }
    const dups = g.merge.map((id) => byId.get(id)).filter(Boolean);
    if (dups.length === 0) continue;
    console.log(`\n=> ${keep.name}  <=  ${dups.map((d) => `${d.name} [${d.orders} ped, ${d.addresses} dir, ${d.users} cuentas]`).join(" | ")}`);
    if (dry) continue;

    await sql.begin(async (tx) => {
      const ids = dups.map((d) => d.id);
      // Datos vacíos de la conservada se completan con los de las duplicadas
      const fill = {};
      for (const f of ["ruc", "phone", "email", "contact_name", "yape_number", "yape_holder", "address", "district", "t1_rate"]) {
        if (keep[f] == null || keep[f] === "") {
          const src = dups.find((d) => d[f] != null && d[f] !== "");
          if (src) fill[f] = src[f];
        }
      }
      if (!keep.invoice_igv && dups.some((d) => d.invoice_igv)) fill.invoice_igv = true;
      if (Object.keys(fill).length) await tx`update public.companies set ${tx(fill)} where id = ${keep.id}`;

      const o = await tx`update public.orders set company_id = ${keep.id}, sender_name = ${keep.name} where company_id in ${tx(ids)} returning id`;
      const p = await tx`update public.pickups set company_id = ${keep.id} where company_id in ${tx(ids)} returning id`;
      const s = await tx`update public.stock set company_id = ${keep.id} where company_id in ${tx(ids)} returning id`;
      const l = await tx`update public.settlements set company_id = ${keep.id} where company_id in ${tx(ids)} returning id`;
      const u = await tx`update public.profiles set company_id = ${keep.id} where company_id in ${tx(ids)} returning id`;

      // Direcciones: se mueven, sin repetir la misma dirección y con una sola principal
      const existing = await tx`select id, address, is_default from public.company_addresses where company_id = ${keep.id}`;
      const seen = new Set(existing.map((a) => norm(a.address)));
      let hasDefault = existing.some((a) => a.is_default);
      const moving = await tx`select id, address, is_default from public.company_addresses where company_id in ${tx(ids)} order by is_default desc, created_at`;
      let moved = 0;
      for (const a of moving) {
        if (seen.has(norm(a.address))) {
          await tx`delete from public.company_addresses where id = ${a.id}`;
          continue;
        }
        seen.add(norm(a.address));
        const def = a.is_default && !hasDefault;
        if (def) hasDefault = true;
        await tx`update public.company_addresses set company_id = ${keep.id}, is_default = ${def} where id = ${a.id}`;
        moved++;
      }

      await tx`delete from public.companies where id in ${tx(ids)}`;
      console.log(`   pedidos ${o.length}, recojos ${p.length}, stock ${s.length}, liquidaciones ${l.length}, cuentas ${u.length}, direcciones ${moved}; datos completados: ${Object.keys(fill).join(", ") || "—"}`);
    });
  }
  console.log(dry ? "\n(dry-run: no se cambió nada)" : "\nListo.");
}

try {
  if (flag("--propose")) await propose();
  else if (opt("--apply")) await apply();
  else console.log("Uso: --propose [--min 0.75] [--out archivo.json] | --apply archivo.json [--dry-run]");
} finally {
  await sql.end();
}
