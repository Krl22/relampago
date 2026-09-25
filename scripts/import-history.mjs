// Importa el histórico desde los CSV del negocio a la base de datos vinculada.
//
//   node scripts/import-history.mjs --orders "ruta/Form (Respuestas).csv" --pickups "ruta/RECOJOS 2026.csv" --since 2026-06-20 [--dry-run]
//
// - Empresas y direcciones: de TODO el registro de recojos (es la lista de clientes) + remitentes
//   del formulario dentro del período (con su correo).
// - Pedidos: filas del formulario con fecha >= --since (estado 'delivered', origen 'warehouse').
// - Recojos: filas del registro con fecha >= --since (estado 'picked_up', motorizado por nombre;
//   si el nombre coincide con un usuario real, se crea la asignación).
//
// Se conecta con la misma configuración que scripts/db-query.mjs (SUPABASE_DB_PASSWORD en .env).
import { readFileSync } from "node:fs";
import { connect } from "./lib/db.mjs";
import { parse as parseCsv } from "./lib/csv.mjs";
import { parseCoords } from "./lib/coords.mjs";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const ORDERS_CSV = opt("orders");
const PICKUPS_CSV = opt("pickups");
const SINCE = new Date(`${opt("since", "2026-06-20")}T00:00:00-05:00`);
const DRY = args.includes("--dry-run");
if (!ORDERS_CSV || !PICKUPS_CSV) {
  console.error("Uso: node scripts/import-history.mjs --orders <csv> --pickups <csv> [--since YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const norm = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const nz = (s) => (clean(s) ? clean(s) : null);

/** "1/2/2026 13:58:23" (d/m/Y, hora Lima) -> Date */
function parseFormDate(s) {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = "12", mi = "0", se = "0"] = m;
  return new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${se.padStart(2, "0")}-05:00`);
}
/** "02/01" (dd/mm, año 2026) -> Date a mediodía Lima */
function parsePickupDate(s) {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y ? (y.length === 2 ? `20${y}` : y) : "2026";
  return new Date(`${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00-05:00`);
}
const isoDate = (d) => d.toISOString().slice(0, 10);

/** Cantidad de paquetes: entero 1..500; cualquier otra cosa (teléfonos, texto) -> 1 y se conserva el original. */
function parsePackages(raw) {
  const n = parseInt(clean(raw).replace(/\D/g, ""), 10);
  if (Number.isFinite(n) && n >= 1 && n <= 500) return { packages: n, note: null };
  return { packages: 1, note: clean(raw) ? `Cantidad original del formulario: ${clean(raw)}` : null };
}

/** Monto a cobrar: números; teléfonos u otras barbaridades -> 0 y se conserva el original. */
function parseAmount(raw) {
  const s = clean(raw).replace(/[^\d.,]/g, "").replace(",", ".");
  if (!s) return { amount: 0, note: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 20000) return { amount: 0, note: `Monto original del formulario: ${clean(raw)}` };
  return { amount: Math.round(n * 100) / 100, note: null };
}

// Distritos como los escribe la central en el registro de recojos -> nombre canónico
const DISTRICT_ALIASES = {
  sjl: "San Juan de Lurigancho",
  sjm: "San Juan de Miraflores",
  smp: "San Martín de Porres",
  ves: "Villa El Salvador",
  vmt: "Villa María Del Triunfo",
  cercado: "Cercado",
  "cercado de lima": "Cercado",
  lima: "Cercado",
  "la victoria": "La Victoria",
  surco: "Surco",
  "santiago de surco": "Surco",
  chorrillos: "Chorrillos",
  callao: "Callao",
  "san borja": "San Borja",
  "santa anita": "Santa Anita",
  surquillo: "Surquillo",
  "el agustino": "El Agustino",
  "san luis": "San Luis",
  breña: "Breña",
  brena: "Breña",
  lince: "Lince",
  miraflores: "Miraflores",
  "san isidro": "San Isidro",
  "san miguel": "San Miguel",
  "pueblo libre": "Pueblo Libre",
  magdalena: "Magdalena",
  "jesus maria": "Jesus María",
  barranco: "Barranco",
  ate: "Ate",
  comas: "Comas",
  "los olivos": "Los Olivos",
  independencia: "Independencia",
  rimac: "Rímac",
  "la molina": "La Molina",
  "puente piedra": "Puente Piedra",
  carabayllo: "Carabayllo",
  lurin: "Lurín",
  pachacamac: "Pachacamac",
  ventanilla: "Ventanilla",
  lurigancho: "Lurigancho",
  chosica: "Lurigancho",
};
const canonDistrict = (s) => {
  const n = norm(s);
  if (!n) return null;
  return DISTRICT_ALIASES[n] ?? clean(s);
};

/** Servicio inferido de comentarios/destino (heurística; el admin puede corregir). */
function inferService(district, comments) {
  if (/agencia/i.test(district ?? "")) return "agency";
  if (/\bcambio\b/i.test(comments ?? "")) return "exchange";
  if (/\bretorno\b|devoluci/i.test(comments ?? "")) return "return";
  return "delivery";
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const sql = await connect();

// ---------------------------------------------------------------------------
// 1) Leer CSVs
// ---------------------------------------------------------------------------
const formRows = parseCsv(readFileSync(ORDERS_CSV, "utf8")).slice(1); // sin cabecera
const pickupRows = parseCsv(readFileSync(PICKUPS_CSV, "utf8")).slice(1);

const formOrders = formRows
  .map((r) => ({
    created_at: parseFormDate(r[0]),
    email: nz(r[1])?.toLowerCase() ?? null,
    sender: clean(r[2]),
    recipient: clean(r[3]),
    phone: clean(r[4]),
    district: clean(r[5]),
    address: clean(r[6]),
    products: nz(r[7]),
    packagesRaw: r[8],
    amountRaw: r[9],
    comments: nz(r[10]),
  }))
  .filter((o) => o.created_at && o.sender && o.recipient);

const pickupsAll = pickupRows
  .map((r) => ({
    date: parsePickupDate(r[0]),
    nped: clean(r[1]),
    company: clean(r[2]),
    contact: nz(r[3]),
    phone: nz(r[4]),
    district: canonDistrict(r[5]),
    address: clean(r[6]),
    courier: norm(r[7]).replace(/^1/, ""),
    packages: (() => {
      const n = parseInt(clean(r[8]).replace(/\D/g, ""), 10);
      return n >= 1 && n <= 500 ? n : null;
    })(),
    obs: nz(r[9]),
  }))
  .filter((p) => p.date && p.company && p.address && p.courier !== "anulado");

const ordersInPeriod = formOrders.filter((o) => o.created_at >= SINCE).sort((a, b) => a.created_at - b.created_at);
const pickupsInPeriod = pickupsAll.filter((p) => p.date >= SINCE);

// Correo por empresa (el más frecuente en el formulario, cualquier período)
const emailByCompany = new Map();
for (const o of formOrders) {
  if (!o.email) continue;
  const k = norm(o.sender);
  const m = emailByCompany.get(k) ?? new Map();
  m.set(o.email, (m.get(o.email) ?? 0) + 1);
  emailByCompany.set(k, m);
}
const bestEmail = (k) => {
  const m = emailByCompany.get(k);
  if (!m) return null;
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

// Empresas a crear: todas las del registro de recojos + remitentes del período
const companyNames = new Map(); // norm -> nombre "bonito"
for (const p of pickupsAll) if (!companyNames.has(norm(p.company))) companyNames.set(norm(p.company), p.company);
for (const o of ordersInPeriod) if (!companyNames.has(norm(o.sender))) companyNames.set(norm(o.sender), o.sender);

// Direcciones por empresa (registro de recojos completo)
const addressesByCompany = new Map(); // norm company -> Map(norm address -> {…, count})
for (const p of pickupsAll) {
  const ck = norm(p.company);
  const ak = norm(p.address);
  if (!ak) continue;
  const m = addressesByCompany.get(ck) ?? new Map();
  const cur = m.get(ak) ?? { address: p.address, district: p.district, contact: p.contact, phone: p.phone, count: 0, coords: parseCoords(p.address, p.district) };
  cur.count++;
  cur.contact ??= p.contact;
  cur.phone ??= p.phone;
  cur.district ??= p.district;
  m.set(ak, cur);
  addressesByCompany.set(ck, m);
}

console.log("── Resumen ──────────────────────────────────────────");
console.log(`Formulario: ${formRows.length} filas · válidas ${formOrders.length} · en período ${ordersInPeriod.length} (desde ${isoDate(SINCE)})`);
console.log(`Recojos:    ${pickupRows.length} filas · válidas ${pickupsAll.length} · en período ${pickupsInPeriod.length}`);
console.log(`Empresas a asegurar: ${companyNames.size} · con correo: ${[...companyNames.keys()].filter(bestEmail).length}`);
const addrCount = [...addressesByCompany.values()].reduce((n, m) => n + m.size, 0);
const addrWithCoords = [...addressesByCompany.values()].reduce((n, m) => n + [...m.values()].filter((a) => a.coords).length, 0);
console.log(`Direcciones de recojo: ${addrCount} (con coordenadas: ${addrWithCoords})`);
const courierCounts = {};
for (const p of pickupsInPeriod) courierCounts[p.courier] = (courierCounts[p.courier] ?? 0) + 1;
console.log("Motorizados en recojos del período:", courierCounts);
if (DRY) {
  console.log("\n--dry-run: no se escribió nada.");
  await sql.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2) Escribir (todo en una transacción)
// ---------------------------------------------------------------------------
await sql.begin(async (tx) => {
  // Empresas existentes
  const existing = await tx`select id, name, email from public.companies`;
  const companyId = new Map(existing.map((c) => [norm(c.name), c.id]));

  const toCreate = [...companyNames.entries()].filter(([k]) => !companyId.has(k));
  for (let i = 0; i < toCreate.length; i += 200) {
    const batch = toCreate.slice(i, i + 200).map(([k, name]) => ({ name, email: bestEmail(k) }));
    const rows = await tx`insert into public.companies ${tx(batch, "name", "email")} returning id, name`;
    for (const r of rows) companyId.set(norm(r.name), r.id);
  }
  // Correos para empresas que ya existían sin correo
  for (const c of existing) {
    const e = bestEmail(norm(c.name));
    if (!c.email && e) await tx`update public.companies set email = ${e} where id = ${c.id}`;
  }
  console.log(`Empresas: ${toCreate.length} creadas, ${existing.length} existentes`);

  // Direcciones
  const existingAddr = await tx`select company_id, address from public.company_addresses`;
  const addrKey = new Set(existingAddr.map((a) => `${a.company_id}|${norm(a.address)}`));
  const addrRows = [];
  for (const [ck, m] of addressesByCompany) {
    const cid = companyId.get(ck);
    if (!cid) continue;
    const list = [...m.values()].sort((a, b) => b.count - a.count);
    list.forEach((a, idx) => {
      if (addrKey.has(`${cid}|${norm(a.address)}`)) return;
      addrRows.push({
        company_id: cid,
        label: idx === 0 ? "Principal" : null,
        address: a.address,
        district: a.district,
        lat: a.coords?.lat ?? null,
        lng: a.coords?.lng ?? null,
        contact_name: a.contact,
        contact_phone: a.phone,
        notes: null,
        is_default: idx === 0,
      });
    });
  }
  for (let i = 0; i < addrRows.length; i += 200) {
    await tx`insert into public.company_addresses ${tx(addrRows.slice(i, i + 200), "company_id", "label", "address", "district", "lat", "lng", "contact_name", "contact_phone", "notes", "is_default")}`;
  }
  const addrIds = await tx`select id, company_id, address from public.company_addresses`;
  const addrIdByKey = new Map(addrIds.map((a) => [`${a.company_id}|${norm(a.address)}`, a]));
  console.log(`Direcciones: ${addrRows.length} creadas`);

  // Pedidos del período
  const orderRows = ordersInPeriod.map((o) => {
    const { amount, note } = parseAmount(o.amountRaw);
    const { packages, note: pkgNote } = parsePackages(o.packagesRaw);
    const comments = [o.comments, note, pkgNote].filter(Boolean).join("\n") || null;
    return {
      company_id: companyId.get(norm(o.sender)) ?? null,
      sender_name: o.sender,
      sender_email: o.email,
      recipient_name: o.recipient,
      recipient_phone: o.phone || "—",
      destination_district: o.district || "—",
      destination_address: o.address || "—",
      product_details: o.products,
      packages_count: packages,
      amount_to_collect: amount,
      comments,
      status: "delivered",
      origin_type: "warehouse",
      service_type: inferService(o.district, o.comments),
      call_before: /\bllam|avis/i.test(o.comments ?? ""),
      created_at: o.created_at.toISOString(),
      delivered_at: o.created_at.toISOString(),
      updated_at: o.created_at.toISOString(),
    };
  });
  const cols = [
    "company_id", "sender_name", "sender_email", "recipient_name", "recipient_phone", "destination_district", "destination_address",
    "product_details", "packages_count", "amount_to_collect", "comments", "status", "origin_type", "service_type", "call_before",
    "created_at", "delivered_at", "updated_at",
  ];
  for (let i = 0; i < orderRows.length; i += 300) {
    await tx`insert into public.orders ${tx(orderRows.slice(i, i + 300), ...cols)}`;
    process.stdout.write(`\rPedidos: ${Math.min(i + 300, orderRows.length)}/${orderRows.length}`);
  }
  console.log();

  // Recojos del período
  const profiles = await tx`select p.id, p.full_name, u.email from public.profiles p join auth.users u on u.id = p.id where p.is_courier`;
  const courierByName = new Map();
  for (const p of profiles) {
    const first = norm(p.full_name ?? "").split(" ")[0];
    if (first) courierByName.set(first, p.id);
    const emailUser = norm((p.email ?? "").split("@")[0]).split(/[. _-]/)[0];
    if (emailUser) courierByName.set(emailUser, p.id);
  }
  const pickupRowsOut = pickupsInPeriod.map((p) => {
    const cid = companyId.get(norm(p.company)) ?? null;
    const a = cid ? addrIdByKey.get(`${cid}|${norm(p.address)}`) : null;
    const coords = parseCoords(p.address, p.district);
    return {
      company_id: cid,
      company_address_id: a?.id ?? null,
      address: p.address,
      district: p.district,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      contact_name: p.contact,
      contact_phone: p.phone,
      scheduled_date: isoDate(p.date),
      packages_count: p.packages,
      notes: [p.nped ? `Nº ped. ${p.nped}` : null, p.obs].filter(Boolean).join(" · ") || null,
      status: "picked_up",
      legacy_courier_name: p.courier || null,
      created_at: p.date.toISOString(),
      updated_at: p.date.toISOString(),
      _courier_id: courierByName.get(p.courier) ?? null,
    };
  });
  const pcols = ["company_id", "company_address_id", "address", "district", "lat", "lng", "contact_name", "contact_phone", "scheduled_date", "packages_count", "notes", "status", "legacy_courier_name", "created_at", "updated_at"];
  let assigned = 0;
  for (let i = 0; i < pickupRowsOut.length; i += 300) {
    const batch = pickupRowsOut.slice(i, i + 300);
    const inserted = await tx`insert into public.pickups ${tx(batch, ...pcols)} returning id`;
    const assignments = [];
    batch.forEach((p, j) => {
      if (p._courier_id) assignments.push({ pickup_id: inserted[j].id, courier_id: p._courier_id, assigned_at: p.created_at, picked_up_at: p.created_at });
    });
    if (assignments.length) {
      await tx`insert into public.pickup_assignments ${tx(assignments, "pickup_id", "courier_id", "assigned_at", "picked_up_at")}`;
      assigned += assignments.length;
    }
    process.stdout.write(`\rRecojos: ${Math.min(i + 300, pickupRowsOut.length)}/${pickupRowsOut.length}`);
  }
  console.log(`\nAsignaciones a usuarios reales: ${assigned} (motorizados reconocidos: ${[...courierByName.keys()].join(", ")})`);
});

await sql.end();
console.log("Importación terminada.");
