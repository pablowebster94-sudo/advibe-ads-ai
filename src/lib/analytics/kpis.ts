import { db } from "../db";

export type Totals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
  results: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
};

export type Row = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
};

export const emptyRow = (): Row => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, conversations: 0, leads: 0, purchases: 0, purchaseValue: 0 });

export function addRow(a: Row, b: Row): Row {
  return {
    spend: a.spend + b.spend,
    impressions: a.impressions + b.impressions,
    // reach diario no es aditivo entre días; se suma como aproximación y se etiqueta así en la UI
    reach: a.reach + b.reach,
    clicks: a.clicks + b.clicks,
    conversations: a.conversations + b.conversations,
    leads: a.leads + b.leads,
    purchases: a.purchases + b.purchases,
    purchaseValue: a.purchaseValue + b.purchaseValue,
  };
}

export function totals(r: Row): Totals {
  const results = r.conversations + r.leads + r.purchases;
  return {
    ...r,
    results,
    ctr: r.impressions ? (r.clicks / r.impressions) * 100 : null,
    cpc: r.clicks ? r.spend / r.clicks : null,
    cpm: r.impressions ? (r.spend / r.impressions) * 1000 : null,
    cpa: results ? r.spend / results : null,
    roas: r.spend && r.purchaseValue ? r.purchaseValue / r.spend : null,
  };
}

export type Period = { from: Date; to: Date };

export function periodFromDays(days: number): { cur: Period; prev: Period } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { cur: { from, to }, prev: { from: prevFrom, to: prevTo } };
}

/** adAccountIds permitidos: siempre derivados de la organización de la sesión */
export async function orgAccountIds(orgId: string, clientId?: string): Promise<string[]> {
  if (clientId) {
    const links = await db.clientMetaLink.findMany({ where: { clientId, client: { orgId } } });
    return links.map((l) => l.adAccountId);
  }
  const accs = await db.metaAdAccount.findMany({ where: { connection: { orgId } }, select: { id: true } });
  return accs.map((a) => a.id);
}

export async function fetchRows(accountIds: string[], p: Period) {
  if (!accountIds.length) return [];
  return db.insightSnapshot.findMany({ where: { adAccountId: { in: accountIds }, date: { gte: p.from, lte: p.to } } });
}

export function sumRows(rows: Row[]): Row {
  return rows.reduce(addRow, emptyRow());
}

export function groupBy<T extends Row & Record<string, any>>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, addRow(m.get(k) ?? emptyRow(), r));
  }
  return m;
}
