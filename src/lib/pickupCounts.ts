export function pickupCounts(expected: number | null, received = 0) {
  return {
    expected,
    received,
    remaining: expected == null ? null : Math.max(0, expected - received),
    partial: received > 0 && expected != null && received < expected,
  };
}

export function receivedTotalError(value: string, previous: number) {
  if (!/^\d+$/.test(value)) return "Indica una cantidad entera de paquetes (puede ser 0).";
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count > 10000) return "La cantidad debe estar entre 0 y 10000.";
  if (count < previous) return `Ya registraste ${previous} paquetes. Indica el total acumulado, no solo los nuevos.`;
  return null;
}
