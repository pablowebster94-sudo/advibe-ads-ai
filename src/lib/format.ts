export const nf = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat("es", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function money(n: number | null | undefined, currency = "USD") {
  if (n == null || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${nf2.format(n)} ${currency}`;
  }
}
export function int(n: number | null | undefined) {
  return n == null || !isFinite(n) ? "—" : nf.format(n);
}
export function pct(n: number | null | undefined) {
  return n == null || !isFinite(n) ? "—" : `${nf2.format(n)}%`;
}
export function ratio(n: number | null | undefined) {
  return n == null || !isFinite(n) ? "—" : `${nf2.format(n)}x`;
}
export function delta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}
export function dateISO(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
