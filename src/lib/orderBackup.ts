import type { Database, Json } from "../types/database";
import { STATUS_META } from "./orderMeta";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type OrderBackup = {
  schema_version: number;
  exported_at: string;
  scope: string;
  photos: string;
  orders: Row<"orders">[];
  deliveries: Row<"deliveries">[];
  order_events: Row<"order_events">[];
  order_items: Row<"order_items">[];
  stock_movements: Row<"stock_movements">[];
  pickups: Row<"pickups">[];
  companies: { id: string; name: string }[];
  couriers: { id: string; full_name: string | null }[];
};

export function parseOrderBackup(data: Json): OrderBackup {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.schema_version !== 1) {
    throw new Error("El respaldo recibido no es válido.");
  }
  for (const key of ["orders", "deliveries", "order_events", "order_items", "stock_movements", "pickups", "companies", "couriers"]) {
    if (!Array.isArray(data[key])) throw new Error(`Faltan datos en el respaldo: ${key}.`);
  }
  return data as unknown as OrderBackup;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadOrderBackup(backup: OrderBackup, format: "json" | "xlsx") {
  const filename = `relampago-pedidos-${backup.exported_at.replace(/[:.]/g, "-")}`;
  if (format === "json") {
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), `${filename}.json`);
    return;
  }
  // Load the existing spreadsheet library only when Excel is requested.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Relámpago Courier";
  workbook.created = new Date(backup.exported_at);
  const companies = new Map(backup.companies.map((c) => [c.id, c.name]));
  const couriers = new Map(backup.couriers.map((c) => [c.id, c.full_name]));
  const pedidos = workbook.addWorksheet("Pedidos", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = ["ID", "Nº", "Fecha de registro", "Fecha de entrega", "Comercio", "Origen", "Destinatario", "Teléfono", "Dirección", "Distrito", "Detalles", "Paquetes", "Estado", "Motorizado", "Tarifa", "Recarga (S/)", "Monto servicio (S/)", "A cobrar (S/)", "Cobrado (S/)", "Método pago", "Comentarios", "Notas"];
  pedidos.addRow(headers);
  for (const o of backup.orders) {
    pedidos.addRow([o.id, o.order_number, o.created_at ? new Date(o.created_at) : null, new Date(`${o.scheduled_date}T12:00:00Z`),
      companies.get(o.company_id ?? "") ?? o.company_id, o.origin_type === "pickup" ? "Recojo" : "Almacén",
      o.recipient_name, o.recipient_phone, o.destination_address, o.destination_district, o.product_details,
      o.packages_count, STATUS_META[o.status]?.label ?? o.status, couriers.get(o.assigned_courier ?? "") ?? o.assigned_courier,
      o.tariff, o.surcharge, o.total_amount, o.amount_to_collect, o.amount_collected, o.payment_method, o.comments, o.delivery_notes]);
  }
  pedidos.getColumn(3).numFmt = "dd/mm/yyyy hh:mm";
  pedidos.getColumn(4).numFmt = "dd/mm/yyyy";
  for (const col of [16, 17, 18, 19]) pedidos.getColumn(col).numFmt = '"S/ "0.00';
  for (const [name, rows] of [
    ["Entregas", backup.deliveries], ["Historial", backup.order_events], ["Items", backup.order_items],
    ["Movimientos stock", backup.stock_movements], ["Recojos", backup.pickups],
  ] as const) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    const keys = Object.keys(rows[0] ?? {});
    if (!keys.length) { sheet.addRow(["Sin registros"]); continue; }
    sheet.addRow(keys);
    for (const row of rows) sheet.addRow(keys.map((key) => {
      const value = (row as Record<string, unknown>)[key];
      return value != null && typeof value === "object" ? JSON.stringify(value) : value;
    }));
  }
  const info = workbook.addWorksheet("Información");
  info.addRows([
    ["Exportado", backup.exported_at], ["Pedidos", backup.orders.length],
    ["Alcance", backup.scope === "all_orders" ? "Todos los pedidos" : "Pedidos seleccionados"],
    ["Fotos", "Se incluyen enlaces; no se descargan archivos de imagen."],
    ["Respaldo", "Para conservar todos los campos originales, descarga también el JSON."],
  ]);
  for (const sheet of workbook.worksheets) {
    sheet.columns.forEach((column, index) => { column.width = index === 0 ? 38 : 23; });
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1247B8" } };
    sheet.getRow(1).height = 34;
    sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };
    if (sheet !== info && sheet.rowCount > 1) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
  }
  info.getColumn(2).width = 85;
  const bytes = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([new Uint8Array(bytes as ArrayBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}
