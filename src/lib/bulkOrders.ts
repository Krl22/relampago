// Carga masiva de pedidos del comercio: plantilla Excel, lectura de .xlsx / .csv / filas pegadas
// desde Excel o Google Sheets, y validación fila por fila antes de enviar.
import type { District } from "./districts";
import { matchDistrict } from "./districts";

export const BULK_COLUMNS = [
  { key: "recipient_name", header: "Destinatario", width: 26, required: true, synonyms: ["destinatario", "nombre", "cliente", "nombre del destinatario", "nombre cliente", "nombre y apellido"] },
  { key: "recipient_phone", header: "Teléfono", width: 14, required: true, synonyms: ["telefono", "celular", "tel", "telf", "whatsapp", "telefono del destinatario", "numero"] },
  { key: "district", header: "Distrito", width: 26, required: true, synonyms: ["distrito", "distrito del destinatario"] },
  { key: "delivery_address", header: "Dirección (con referencias)", width: 42, required: true, synonyms: ["direccion", "direccion con referencias", "direccion del destinatario", "domicilio", "direccion de entrega"] },
  { key: "product_details", header: "Detalle del producto", width: 30, required: true, synonyms: ["detalle", "detalle del producto", "detalle de productos", "producto", "productos", "descripcion", "contenido"] },
  { key: "packages_count", header: "Paquetes", width: 10, required: false, synonyms: ["paquetes", "cantidad", "cant", "bultos", "cantidad de paquetes"] },
  { key: "amount_to_collect", header: "Monto a cobrar", width: 15, required: false, synonyms: ["monto", "monto a cobrar", "cobrar", "importe", "precio", "total", "monto cobrar"] },
  { key: "comments", header: "Comentarios", width: 32, required: false, synonyms: ["comentarios", "comentario", "observaciones", "observacion", "notas", "indicaciones"] },
  { key: "agency_destination", header: "Ciudad destino (solo agencias)", width: 24, required: false, synonyms: ["ciudad", "ciudad destino", "destino", "ciudad de destino"] },
  { key: "recipient_dni", header: "DNI (solo agencias)", width: 16, required: false, synonyms: ["dni", "documento", "dni del destinatario"] },
] as const;

export type BulkKey = (typeof BULK_COLUMNS)[number]["key"];
export type BulkRow = { id: number; line: number; values: Record<BulkKey, string> };
export type RowCheck = { errors: Partial<Record<BulkKey, string>>; district: District | null; packages: number; amount: number };

export const MAX_BULK_ROWS = 300;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\(.*?\)|\*/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const emptyValues = (): Record<BulkKey, string> =>
  Object.fromEntries(BULK_COLUMNS.map((c) => [c.key, ""])) as Record<BulkKey, string>;

/** Texto separado por tabulaciones (pegado de Excel), punto y coma o comas; respeta comillas. */
export function parseDelimited(text: string): string[][] {
  // Sin BOM (Excel lo agrega al guardar CSV en UTF-8) y con saltos de línea normales
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  const firstLine = clean.split("\n", 1)[0] ?? "";
  const sep = firstLine.includes("\t") ? "\t" : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Primera hoja de un .xlsx como matriz de textos (la librería se carga solo aquí). */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Pedidos") ?? wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, BULK_COLUMNS.length); c++) cells.push(cellText(row.getCell(c).value));
    out.push(cells);
  });
  return out;
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
    if (o.result != null) return cellText(o.result);
    if (o.text != null) return cellText(o.text);
    return "";
  }
  return String(v).trim();
}

/**
 * Convierte la matriz en filas. Si la primera fila trae encabezados reconocibles se usan
 * (en cualquier orden); si no, se asume el orden de la plantilla.
 */
export function matrixToRows(matrix: string[][]): BulkRow[] {
  const rows = matrix.filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return [];
  const header = rows[0].map(norm);
  const colIndex = new Map<BulkKey, number>();
  header.forEach((h, i) => {
    const col = BULK_COLUMNS.find((c) => (c.synonyms as readonly string[]).includes(h) || norm(c.header) === h);
    if (col && !colIndex.has(col.key)) colIndex.set(col.key, i);
  });
  const hasHeader = colIndex.size >= 2;
  const body = hasHeader ? rows.slice(1) : rows;
  return body.map((r, i) => {
    const values = emptyValues();
    BULK_COLUMNS.forEach((c, pos) => {
      const idx = hasHeader ? colIndex.get(c.key) : pos;
      values[c.key] = idx != null ? (r[idx] ?? "").trim() : "";
    });
    return { id: i + 1, line: i + (hasHeader ? 2 : 1), values };
  });
}

const toNumber = (s: string) => {
  const t = s.replace(/s\/\.?/i, "").replace(/\s/g, "");
  if (t === "") return NaN;
  // "45,50" -> 45.50 ; "1,250.00" -> 1250.00
  const n = /,\d{1,2}$/.test(t) && !t.includes(".") ? Number(t.replace(",", ".")) : Number(t.replace(/,/g, ""));
  return n;
};

export function checkRow(row: BulkRow, catalog: District[]): RowCheck {
  const v = row.values;
  const errors: RowCheck["errors"] = {};
  if (v.recipient_name.trim().length < 2) errors.recipient_name = "Falta el destinatario";
  const phone = v.recipient_phone.replace(/\D/g, "");
  if (phone.length < 6 || phone.length > 15) errors.recipient_phone = "Solo números, de 6 a 15 dígitos";
  const district = matchDistrict(v.district, catalog);
  if (!district) errors.district = v.district ? `“${v.district}” no es un distrito de la lista` : "Falta el distrito";
  if (v.delivery_address.trim().length < 5) errors.delivery_address = "Falta la dirección";
  if (v.product_details.trim().length < 2) errors.product_details = "Falta el detalle";
  const packages = v.packages_count.trim() === "" ? 1 : toNumber(v.packages_count);
  if (!Number.isInteger(packages) || packages < 1 || packages > 500) errors.packages_count = "Entre 1 y 500";
  const amount = v.amount_to_collect.trim() === "" ? 0 : toNumber(v.amount_to_collect);
  if (!Number.isFinite(amount) || amount < 0 || amount > 20000) errors.amount_to_collect = "Monto inválido";
  if (district?.kind === "agency" && v.agency_destination.trim().length < 2) errors.agency_destination = "¿A qué ciudad va?";
  return { errors, district, packages, amount };
}

/** Payload de submit_order para una fila válida. */
export function rowPayload(row: BulkRow, check: RowCheck, origin: { type: "warehouse" | "pickup"; addressId: string | null }) {
  const v = row.values;
  const agency = check.district?.kind === "agency";
  return {
    recipient_name: v.recipient_name.trim(),
    recipient_phone: v.recipient_phone.replace(/\D/g, ""),
    destination_district: check.district?.name ?? v.district,
    destination_address: v.delivery_address.trim(),
    product_details: v.product_details.trim(),
    packages_count: String(check.packages),
    amount_to_collect: String(check.amount),
    service_type: agency ? "agency" : "delivery",
    agency_name: agency && check.district && /^agencia\s+/i.test(check.district.name) ? check.district.name.replace(/^agencia\s+/i, "") : null,
    agency_destination: agency ? v.agency_destination.trim() || null : null,
    recipient_dni: agency ? v.recipient_dni.trim() || null : null,
    comments: v.comments.trim() || null,
    origin_type: origin.type,
    pickup: origin.type === "pickup" ? { address_id: origin.addressId } : null,
  };
}

/** Plantilla .xlsx con el distrito como lista desplegable. */
export async function downloadTemplate(catalog: District[]) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Relámpago Courier";

  const ws = wb.addWorksheet("Pedidos", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = BULK_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F48C4" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.getColumn("recipient_phone").numFmt = "@";
  ws.getColumn("recipient_dni").numFmt = "@";

  // Lista de distritos en una hoja oculta
  const list = wb.addWorksheet("Distritos", { state: "veryHidden" });
  catalog.forEach((d, i) => (list.getCell(`A${i + 1}`).value = d.name));
  const last = MAX_BULK_ROWS + 1;
  const col = (key: BulkKey) => String.fromCharCode(65 + BULK_COLUMNS.findIndex((c) => c.key === key));
  for (let r = 2; r <= last; r++) {
    ws.getCell(`${col("district")}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Distritos!$A$1:$A$${catalog.length}`],
      showErrorMessage: true,
      errorTitle: "Distrito",
      error: "Elige un distrito de la lista.",
    };
    ws.getCell(`${col("packages_count")}${r}`).dataValidation = {
      type: "whole",
      operator: "between",
      allowBlank: true,
      formulae: [1, 500],
      showErrorMessage: true,
      error: "Número de paquetes entre 1 y 500.",
    };
    ws.getCell(`${col("amount_to_collect")}${r}`).dataValidation = {
      type: "decimal",
      operator: "between",
      allowBlank: true,
      formulae: [0, 20000],
      showErrorMessage: true,
      error: "Monto en soles (0 si no hay cobro).",
    };
  }

  const help = wb.addWorksheet("Instrucciones");
  help.getColumn(1).width = 110;
  [
    "Cómo llenar la plantilla",
    "",
    "• Un pedido por fila, en la hoja «Pedidos». Los campos con * son obligatorios.",
    "• Distrito: elígelo de la lista desplegable. Si es envío a provincia, elige la agencia y llena «Ciudad destino».",
    "• Paquetes: vacío = 1. Monto a cobrar: vacío o 0 si no hay cobro.",
    "• Si los paquetes salen del almacén o se recogen, lo eliges en el portal al subir el archivo.",
    `• Máximo ${MAX_BULK_ROWS} pedidos por archivo. Revisarás todo antes de enviarlo.`,
  ].forEach((t, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 14 };
  });

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-pedidos-relampago.xlsx";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
