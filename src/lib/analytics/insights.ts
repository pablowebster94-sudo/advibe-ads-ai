import { db } from "../db";
import { Row, emptyRow, addRow, totals, fetchRows } from "./kpis";

export type AdPerf = {
  adId: string;
  name: string;
  adsetId: string;
  campaignId: string;
  adAccountId: string;
  t: ReturnType<typeof totals>;
  frequency: number;
  status: string | null;
};

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function adPerformance(accountIds: string[], from: Date, to: Date): Promise<AdPerf[]> {
  const rows = await fetchRows(accountIds, { from, to });
  const by = new Map<string, { row: Row; freqSum: number; days: number; r0: (typeof rows)[number] }>();
  for (const r of rows) {
    const e = by.get(r.adId) ?? { row: emptyRow(), freqSum: 0, days: 0, r0: r };
    e.row = addRow(e.row, r);
    e.freqSum += r.frequency;
    e.days += 1;
    by.set(r.adId, e);
  }
  const ents = await db.metaEntity.findMany({ where: { adAccountId: { in: accountIds }, level: "ad", metaId: { in: [...by.keys()] } } });
  const names = new Map(ents.map((e) => [e.metaId, e]));
  return [...by.entries()].map(([adId, e]) => ({
    adId,
    name: names.get(adId)?.name ?? adId,
    adsetId: e.r0.adsetId,
    campaignId: e.r0.campaignId,
    adAccountId: e.r0.adAccountId,
    t: totals(e.row),
    frequency: e.days ? e.freqSum / e.days : 0,
    status: names.get(adId)?.effectiveStatus ?? null,
  }));
}

/** Ganadores/perdedores contra la mediana de CPA. Solo anuncios con gasto y resultados suficientes. */
export function classify(perf: AdPerf[], minSpend = 5) {
  const withCpa = perf.filter((p) => p.t.spend >= minSpend && p.t.cpa != null);
  const med = median(withCpa.map((p) => p.t.cpa as number));
  const winners = med == null ? [] : withCpa.filter((p) => (p.t.cpa as number) <= med * 0.8).sort((a, b) => (a.t.cpa! - b.t.cpa!));
  const losers = med == null ? [] : withCpa.filter((p) => (p.t.cpa as number) >= med * 1.5).sort((a, b) => (b.t.cpa! - a.t.cpa!));
  const noResults = perf.filter((p) => p.t.spend >= minSpend * 2 && p.t.results === 0);
  return { medianCpa: med, winners, losers, noResults };
}

/** Fatiga: frecuencia >= 3 y CTR cae >= 20% frente a los 7 días anteriores */
export async function fatigue(accountIds: string[]) {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const d7 = new Date(to.getTime() - 6 * 86400000);
  const p7 = new Date(d7.getTime() - 7 * 86400000);
  const [cur, prev] = await Promise.all([
    adPerformance(accountIds, d7, to),
    adPerformance(accountIds, p7, new Date(d7.getTime() - 86400000)),
  ]);
  const prevMap = new Map(prev.map((p) => [p.adId, p]));
  return cur
    .filter((c) => c.frequency >= 3 && c.t.impressions >= 500)
    .map((c) => {
      const p = prevMap.get(c.adId);
      const drop = p?.t.ctr && c.t.ctr != null ? ((p.t.ctr - c.t.ctr) / p.t.ctr) * 100 : null;
      return { ad: c, prevCtr: p?.t.ctr ?? null, ctrDrop: drop };
    })
    .filter((x) => x.ctrDrop != null && x.ctrDrop >= 20);
}
