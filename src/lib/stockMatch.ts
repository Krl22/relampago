// Reconoce productos del stock del comercio dentro de un texto libre ("2 Astaxantina + sachets",
// "2BonesCare 1HepaCare", "6 × Cápsula BIONAD"…). Se usa en la carga masiva para que esos pedidos
// queden vinculados al stock y se descuenten al entregarse, igual que los del formulario.

export type StockOption = { id: string; product_name: string; available: number };
export type PickedItem = { stock_id: string; quantity: number };
export type StockMatch = { items: PickedItem[]; ambiguous: string[] };
export type StockMatcher = (text: string) => StockMatch;

const MIN_KEY = 3;
const MAX_QTY = 999;
// Medidas de presentación ("1.2kg", "500 ml"): no identifican el producto y confunden la cantidad
const MEASURE = /\d+(?:[.,]\d+)?\s*(?:kg|kgs|gr|grs|g|mg|ml|lt|l|oz|cc)\b/g;
const SEPARATOR = /[,;+/|·\n()[\]]/;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/×/g, " x ")
    .replace(MEASURE, " ");

// Plural simple, aplicado igual al texto y a los nombres ("semillas" = "semilla", "colagenos" = "colageno")
const singular = (t: string) => (t.length >= 4 && t.endsWith("s") && !/\d/.test(t) ? t.slice(0, -1) : t);
const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean).map(singular);

/**
 * Texto en minúsculas sin espacios ni signos (solo letras y números) y los puntos donde había
 * un separador (coma, +, /, paréntesis…), para no tomar la cantidad de otro producto.
 */
function compact(text: string): { s: string; cuts: number[] } {
  const parts = fold(text).split(/([^a-z0-9]+)/);
  let s = "";
  const cuts: number[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (/^[a-z0-9]/.test(p)) s += singular(p);
    else if (SEPARATOR.test(p)) cuts.push(s.length);
  }
  return { s, cuts };
}

/**
 * Prepara el buscador para un stock. Cada producto se reconoce por su nombre completo o por su nombre
 * sin el prefijo de marca/línea que comparte con otros ("Cápsula", "CML", "Inside"…), sin importar
 * espacios, tildes, mayúsculas ni plurales. Si una forma corresponde a dos productos queda como ambigua.
 */
export function stockMatcher(stock: StockOption[]): StockMatcher {
  const named = stock.map((s) => ({ id: s.id, toks: tokens(s.product_name).filter((t) => !/^\d+$/.test(t)) }));
  // Prefijos compartidos por 3+ productos ("capsula", "cml", "shaker regalo"…) = marca o línea
  const prefixCount = new Map<string, number>();
  for (const n of named)
    for (let k = 1; k < n.toks.length; k++) {
      const p = n.toks.slice(0, k).join(" ");
      prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
    }

  const keys = new Map<string, Set<string>>();
  const addKey = (key: string, id: string) => {
    if (key.length < MIN_KEY) return;
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key)!.add(id);
  };
  for (const n of named) {
    addKey(n.toks.join(""), n.id);
    let k = 0;
    while (k < n.toks.length - 1 && (prefixCount.get(n.toks.slice(0, k + 1).join(" ")) ?? 0) >= 3) k++;
    if (k > 0) addKey(n.toks.slice(k).join(""), n.id);
  }
  // Más largas primero: "citratodemagnesio" gana a "magnesio"
  const ordered = [...keys.keys()].sort((a, b) => b.length - a.length);

  return (text: string): StockMatch => {
    const { s, cuts } = compact(text ?? "");
    const taken: { start: number; end: number; ids: Set<string>; key: string }[] = [];
    for (const key of ordered) {
      let from = 0;
      for (let at = s.indexOf(key, from); at >= 0; at = s.indexOf(key, from)) {
        const end = at + key.length;
        if (!taken.some((m) => at < m.end && end > m.start)) taken.push({ start: at, end, ids: keys.get(key)!, key });
        from = at + 1;
      }
    }
    taken.sort((a, b) => a.start - b.start);

    const items: PickedItem[] = [];
    const ambiguous: string[] = [];
    taken.forEach((m, i) => {
      const prevEnd = i > 0 ? taken[i - 1].end : 0;
      const nextStart = i < taken.length - 1 ? taken[i + 1].start : s.length;
      const left = Math.max(prevEnd, ...cuts.filter((c) => c <= m.start));
      const rightCuts = cuts.filter((c) => c >= m.end);
      const right = Math.min(nextStart, ...(rightCuts.length ? rightCuts : [s.length]));
      // Cantidad: el último número antes del producto ("2 x Hepacare", "2Hepacare") o "Hepacare x2"
      const before = s.slice(left, m.start).match(/(\d{1,3})(?!.*\d)/);
      const after = s.slice(m.end, right).match(/^[a-z]{0,3}?x(\d{1,3})/);
      const qty = Math.min(MAX_QTY, Math.max(1, Number(before?.[1] ?? after?.[1] ?? 1)));
      if (m.ids.size > 1) {
        ambiguous.push(m.key);
        return;
      }
      const id = [...m.ids][0];
      if (!items.some((it) => it.stock_id === id)) items.push({ stock_id: id, quantity: qty });
    });
    return { items, ambiguous };
  };
}
