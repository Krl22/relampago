import assert from "node:assert/strict";
import { test } from "node:test";
import { stockMatcher } from "../../src/lib/stockMatch.ts";

// Nombres reales del stock de un comercio (marcas/líneas como prefijo)
const names = [
  "Cápsula BIONAD", "Cápsula CAPSIFEM", "Cápsula CITRATO DE MAGNESIO", "Cápsula CITRATO DE POTASIO", "Cápsula HGH", "Cápsula OSTEOCARE",
  "CML BONESCARE", "CML CALCI - D", "CML COMPLEJO B", "CML HEALTHCARE", "CML HEARTCARE", "CML HEPACARE", "CML MAGNESIO",
  "Inside ASTAXANTINA", "Inside GLICINA", "Inside I - CITRATO DE MAGNESIO", "Inside I - CITRATO DE POTASIO", "Inside SEMILLA DE CALABAZA",
  "Proteína Hydra 1.2kg", "Proteína Nutri Rise 1.2kg CHOCOLATE", "Proteína Nutri Rise 1.2kg VAINILLA", "Proteína Whey 1.2 Kg",
  "Shaker / regalos CML VARIADOS", "Shaker / regalos SACHETS", "Shaker / regalos WNH MORADO",
  "WNH BCAA", "WNH COLAGENO", "WNH CREATINA",
];
const match = stockMatcher(names.map((n) => ({ id: n, product_name: n, available: 100 })));
const picked = (text) => match(text).items.map((it) => `${it.quantity} ${it.stock_id}`);

test("reconoce los detalles que escriben los comercios en la carga masiva", () => {
  assert.deepEqual(picked("2 Astaxantina + sachets de regalo"), ["2 Inside ASTAXANTINA", "1 Shaker / regalos SACHETS"]);
  assert.deepEqual(picked("1 hepa care"), ["1 CML HEPACARE"]);
  assert.deepEqual(picked("2HepaCare"), ["2 CML HEPACARE"]);
  assert.deepEqual(picked("Hepacare x3"), ["3 CML HEPACARE"]);
  assert.deepEqual(picked("1 hgh"), ["1 Cápsula HGH"]);
  assert.deepEqual(picked("2 Semillas de calabaza"), ["2 Inside SEMILLA DE CALABAZA"]);
  assert.deepEqual(picked("1 nutririse vainilla"), ["1 Proteína Nutri Rise 1.2kg VAINILLA"]);
  assert.deepEqual(picked("Proteína whey 1.2kg"), ["1 Proteína Whey 1.2 Kg"]);
  assert.deepEqual(picked("2 citrato de magnesio"), ["2 Cápsula CITRATO DE MAGNESIO"]);
  assert.deepEqual(picked("2 colagenos hidrolizados (no colageno)"), ["2 WNH COLAGENO"]);
  assert.deepEqual(picked("2BonesCare 1HealthCare 1Heartcare 1ComplejoB 1CalciD+mg 1HepaCare"), [
    "2 CML BONESCARE", "1 CML HEALTHCARE", "1 CML HEARTCARE", "1 CML COMPLEJO B", "1 CML CALCI - D", "1 CML HEPACARE",
  ]);
  assert.deepEqual(picked("6 × Cápsula BIONAD, 1 × Cápsula CAPSIFEM"), ["6 Cápsula BIONAD", "1 Cápsula CAPSIFEM"]);
});

test("no inventa productos que no están en el stock", () => {
  assert.deepEqual(picked("zapatillas talla 40"), []);
  assert.deepEqual(picked(""), []);
});

test("si el texto calza con dos productos lo deja para que el comercio elija", () => {
  const m = stockMatcher([
    { id: "a", product_name: "Polo rojo M", available: 5 },
    { id: "b", product_name: "Polo rojo L", available: 5 },
    { id: "c", product_name: "Polo azul M", available: 5 },
    { id: "d", product_name: "Polo verde M", available: 5 },
  ]);
  assert.deepEqual(m("2 polos rojo L").items, [{ stock_id: "b", quantity: 2 }]);
  assert.deepEqual(m("1 rojo").items, []);
});
