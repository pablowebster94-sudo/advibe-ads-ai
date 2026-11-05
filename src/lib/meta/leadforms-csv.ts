/** Tipos y utilidades puras de leads (sin red ni base de datos). */
export type Lead = {
  id: string;
  created_time: string;
  ad_id?: string;
  campaign_id?: string;
  field_data: { name: string; values: string[] }[];
};

/** Convierte leads a CSV (columnas = preguntas encontradas). */
export function leadsToCsv(leads: Lead[]): string {
  const cols = [...new Set(leads.flatMap((l) => l.field_data.map((f) => f.name)))];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = leads.map((l) =>
    [l.created_time, ...cols.map((c) => l.field_data.find((f) => f.name === c)?.values.join(" | ") ?? "")].map(esc).join(",")
  );
  return [["fecha", ...cols].map(esc).join(","), ...rows].join("\n");
}
